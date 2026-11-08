import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
from uuid import UUID

from app.core.config import settings
from app.db.models import KnowledgeSourceDocument, Repository
from app.db.session import Base, SessionLocal, engine
from app.services.evals.ragas_runner import run_rag_quality_eval
from app.services.evals.suites import load_eval_suite
from app.services.rag.document_processing import process_knowledge_document
from app.services.rag.knowledge_base import get_or_create_config

HANDBOOK = Path(__file__).resolve().parents[1] / "docs" / "examples" / "rag_employee_handbook.md"
TOP_K = 3


def seed_handbook() -> tuple[UUID, str]:
    data = HANDBOOK.read_bytes()
    checksum = hashlib.sha256(data).hexdigest()
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        repo = Repository(owner="repolens-ci", name="handbook", full_name="repolens-ci/handbook")
        db.add(repo)
        db.flush()
        config = get_or_create_config(db, repo.id, commit=False)
        config.top_k = TOP_K
        config.rerank_provider = "heuristic"
        config.score_threshold_enabled = False
        document = KnowledgeSourceDocument(
            repo_id=repo.id,
            name=HANDBOOK.name,
            content_type="text/markdown",
            checksum=checksum,
            file_size=len(data),
            stored_path=str(HANDBOOK),
        )
        db.add(document)
        db.flush()
        repo_id, document_id = repo.id, document.id
        db.commit()

    process_knowledge_document(document_id)
    with SessionLocal() as db:
        document = db.get(KnowledgeSourceDocument, document_id)
        if document is None or document.status != "completed":
            detail = document.error_message if document else "source record missing"
            raise RuntimeError(f"Could not index the CI handbook: {detail}")
    return repo_id, checksum


async def evaluate(repo_id: UUID, checksum: str) -> dict:
    with SessionLocal() as db:
        suite = load_eval_suite(db, repo_id, "ci-handbook")
        return await run_rag_quality_eval(
            db,
            str(repo_id),
            cases=suite.cases,
            limit=TOP_K,
            run_judge=True,
            evaluation_set={**suite.metadata, "corpus_sha256": checksum},
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Run RAGAS against the fixed CI handbook suite.")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if not settings.llm_api_key:
        parser.error("Set the LLM_API_KEY repository secret before running the evaluation.")
    if engine.url.get_backend_name() != "sqlite":
        parser.error("Use a fresh SQLite database for the CI evaluation.")

    repo_id, checksum = seed_handbook()
    result = asyncio.run(evaluate(repo_id, checksum))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    status = result["status"]
    hard_gate = result["hard_gate"]
    summary = [
        "## RAGAS handbook evaluation",
        "",
        f"**{status}** · Hard rules passed {hard_gate['passed_cases']}/{hard_gate['total_cases']}",
        "",
        "| Metric | Score | Threshold | Scored cases |",
        "| --- | ---: | ---: | ---: |",
    ]
    for name, metric in result["ragas"]["metrics"].items():
        score = metric["score"]
        if score is not None:
            summary.append(f"| {name} | {score:.4f} | {metric['threshold']:.2f} | {metric['scored_cases']} |")
    if status == "error":
        summary.extend(["", "Evaluation did not complete. See the RAGAS diagnostics in the JSON artifact."])
    summary_text = "\n".join(summary) + "\n"
    print(summary_text, end="")
    if summary_path := os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(summary_path).open("a", encoding="utf-8") as handle:
            handle.write(summary_text)
    return 0 if status == "passed" else 1 if status == "failed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
