import asyncio
import json
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import project_index, repos
from app.db.models import Base, Repository
from app.db.session import get_db
from app.mcp import memory_server
from app.services import project_indexing
from app.services.team_resources import apply, cli
from app.services.team_resources.index_client import ensure_index
from app.services.team_resources.manifest import (
    DEFAULT_DOCS_DIR,
    MANIFEST_PATH,
    docs_dir,
)
from app.services.team_resources.plan import SyncConflict, build_plan
from app.services.team_resources.source import load_snapshot

SKILL = ".agents/skills/pr-review/SKILL.md"
MIRROR = "docs/team-shared/api/migration.md"


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "-c",
            "core.autocrlf=false",
            "-c",
            "core.hooksPath=.git/no-hooks",
            "-c",
            "user.name=RepoLens Test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgSign=false",
            *args,
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=10,
    ).stdout.strip()


def _write(root: Path, path: str, content: str) -> None:
    file = root / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(content.encode())


def _commit(root: Path, message: str) -> str:
    _git(root, "add", "--all")
    _git(root, "commit", "-qm", message)
    return _git(root, "rev-parse", "HEAD")


@pytest.fixture
def projects(tmp_path):
    source = tmp_path / "team"
    target = tmp_path / "project"
    for root in (source, target):
        root.mkdir()
        _git(root, "init", "-q")
    _write(
        source,
        "skills/pr-review/SKILL.md",
        "---\nname: pr-review\ndescription: Review PRs\n---\n\n"
        "Use [checklist](references/checklist.md).\n",
    )
    _write(source, "skills/pr-review/references/checklist.md", "Check API.\n")
    _write(source, "rules/api.md", "Preserve the API.\n")
    _write(source, "agentsmd/review.md", "Group findings by severity.\n")
    _write(source, "docs/api/migration.md", "# Migration\n\nOriginal.\n")
    _write(target, "AGENTS.md", "# Existing\r\n\r\nKeep this exact.")
    _commit(source, "add team resources")
    return source, target


def _plan(source: Path, target: Path):
    return build_plan(
        source, target, load_snapshot(source), docs_dir(DEFAULT_DOCS_DIR)
    )


def test_preview_uses_committed_git_and_leaves_target_untouched(projects):
    source, target = projects
    _write(source, "docs/api/migration.md", "Uncommitted edit.")
    _write(source, "docs/untracked.md", "Untracked.")
    command = (
        Path(__file__).resolve().parents[3] / "scripts/sync_team_resources.py"
    )
    result = subprocess.run(
        [
            sys.executable,
            str(command),
            "--source",
            str(source),
            "--target",
            str(target),
            "--preview",
        ],
        capture_output=True,
        encoding="utf-8",
        check=True,
        timeout=20,
    )
    assert _git(source, "rev-parse", "HEAD") in result.stdout
    assert MIRROR in result.stdout
    assert "untracked.md" not in result.stdout
    assert not (target / ".repolens").exists()
    assert not (target / SKILL).exists()


def test_apply_pins_snapshot_and_avoids_rewriting_complete_sync(projects):
    source, target = projects
    plan = _plan(source, target)
    _write(source, "docs/api/migration.md", "Updated after preview.\n")
    other_commit = _commit(source, "advance the source")
    manifest = apply.apply_plan(target, plan)
    assert manifest.applied_commit != other_commit
    assert (target / MIRROR).read_bytes() == b"# Migration\n\nOriginal.\n"
    assert (target / SKILL).is_file()
    assert _git(target, "check-ignore", MANIFEST_PATH.as_posix())
    assert (
        (target / "AGENTS.md")
        .read_bytes()
        .startswith(b"# Existing\r\n\r\nKeep this exact.\r\n")
    )
    second = apply.apply_plan(target, _plan(source, target))
    assert second.team_docs_digest != manifest.team_docs_digest
    assert (target / MIRROR).read_text() == "Updated after preview.\n"
    repeated = _plan(source, target)
    assert not repeated.needs_write
    assert apply.apply_plan(target, repeated) == second


def test_conflicts_block_writes_and_recheck_targets_after_preview(projects):
    source, target = projects
    initial = _plan(source, target)
    _write(target, SKILL, "Personal skill.")
    assert SKILL in _plan(source, target).conflicts
    with pytest.raises(SyncConflict, match="预览后"):
        apply.apply_plan(target, initial)
    assert (target / SKILL).read_text() == "Personal skill."
    assert not (target / MIRROR).exists()


def test_rules_scope_change_and_withdrawal_preserve_local_guidance(projects):
    source, target = projects
    local = (target / "AGENTS.md").read_bytes()
    apply.apply_plan(target, _plan(source, target))
    _write(source, "rules/api.md", "---\npaths: [backend/**]\n---\nScoped\n")
    (source / "agentsmd/review.md").unlink()
    (source / "docs/api/migration.md").unlink()
    _commit(source, "withdraw resources and scope rule")
    snapshot = load_snapshot(source)
    plan = build_plan(source, target, snapshot, docs_dir(DEFAULT_DOCS_DIR))
    assert "rules/api.md" in snapshot.unsupported
    assert plan.manifest.team_docs_digest is not None
    assert set(plan.previous.files) - set(plan.manifest.files) == {
        "AGENTS.md",
        MIRROR,
    }
    apply.apply_plan(target, plan)
    assert (target / "AGENTS.md").read_bytes() == local
    assert not (target / MIRROR).exists()


def test_incomplete_file_application_can_restore_known_writes(
    projects, monkeypatch
):
    source, target = projects
    plan = _plan(source, target)
    writer = apply._write

    def interrupt_at_commit(root, path, data):
        if path == MANIFEST_PATH.as_posix():
            raise OSError("simulated manifest failure")
        writer(root, path, data)

    monkeypatch.setattr(apply, "_write", interrupt_at_commit)
    with pytest.raises(OSError, match="simulated"):
        apply.apply_plan(target, plan)
    interrupted_skill = (target / SKILL).read_bytes()
    journal = apply.pending_journal(target)
    assert journal is not None
    _write(target, SKILL, "User changed interrupted output.")
    with pytest.raises(SyncConflict, match="恢复期间"):
        apply.recover(target, journal)
    assert (target / MIRROR).is_file()

    (target / SKILL).write_bytes(interrupted_skill)
    apply.recover(target, journal)
    assert apply.pending_journal(target) is None
    assert not (target / SKILL).exists()
    assert not (target / MIRROR).exists()
    assert (
        target / "AGENTS.md"
    ).read_bytes() == b"# Existing\r\n\r\nKeep this exact."


def test_cli_reports_index_failure_without_undoing_applied_files(
    projects, monkeypatch, capsys
):
    source, target = projects
    monkeypatch.setattr(cli, "_confirm", lambda _text: True)

    def fail_index(_client, _root, _digest):
        raise ValueError("index temporarily unavailable")

    monkeypatch.setattr(cli, "ensure_index", fail_index)
    argv = ["--source", str(source), "--target", str(target)]
    assert cli.main(argv) == 5
    assert (target / MIRROR).is_file()
    assert "文档索引待重试" in capsys.readouterr().err
    monkeypatch.setattr(cli, "ensure_index", lambda *_args: None)
    assert cli.main(argv) == 0
    assert "文件无变化" in capsys.readouterr().out


@pytest.fixture
def index_service(projects, monkeypatch):
    _, target = projects
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    with session_factory() as db:
        repo = Repository(
            owner="repolens",
            name="sync-target",
            full_name="repolens/sync-target",
            local_path=str(target),
            checkout_mode="local",
        )
        db.add(repo)
        db.commit()
        repo_id = repo.id

    def test_db():
        with session_factory() as db:
            yield db

    app = FastAPI()
    app.include_router(repos.router, prefix="/api/repos")
    app.include_router(project_index.router, prefix="/api/repos")
    app.dependency_overrides[get_db] = test_db
    monkeypatch.setattr(project_indexing, "SessionLocal", session_factory)
    monkeypatch.setattr(memory_server, "SessionLocal", session_factory)
    monkeypatch.setenv(memory_server.RECALL_BINDING_ENV, str(repo_id))
    with TestClient(app) as client:
        yield client, repo_id, session_factory
    engine.dispose()


def _call_recall(repo_id: uuid.UUID, query: str) -> dict:
    return asyncio.run(
        memory_server.handle_request(
            {
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "recall",
                    "arguments": {"repo_id": str(repo_id), "query": query},
                },
            }
        )
    )


def _recall(repo_id: uuid.UUID, query: str) -> list[dict]:
    result = _call_recall(repo_id, query)["result"]
    return json.loads(result["content"][0]["text"])["results"]


def test_http_index_and_recall_publish_verified_source_versions(
    projects, index_service
):
    source, target = projects
    client, repo_id, _ = index_service
    _write(target, "docs/local.md", "# Original\n\nOriginal local note.\n")
    first = apply.apply_plan(target, _plan(source, target))
    assert ensure_index(client, target, first.team_docs_digest) == repo_id
    result = _recall(repo_id, "Original")
    assert len(result) == 1
    assert result[0]["source_path"] == "docs/api/migration.md"
    assert result[0]["source_commit"] == first.applied_commit
    rejected = _call_recall(uuid.uuid4(), "Original")["error"]
    assert rejected["code"] == -32602
    assert "不匹配" in rejected["message"]

    _write(source, "docs/api/migration.md", "# Migration\n\nReplacement.\n")
    _commit(source, "replace team document")
    second = apply.apply_plan(target, _plan(source, target))
    _write(
        target,
        ".repolens/index.yml",
        "project_docs:\n  mode: allowlist\n  include: [docs/local.md]\n",
    )
    with pytest.raises(ValueError, match=MIRROR):
        ensure_index(client, target, second.team_docs_digest)
    assert _recall(repo_id, "Original") == result
    assert _recall(repo_id, "Replacement") == []

    (target / ".repolens/index.yml").unlink()
    assert ensure_index(client, target, second.team_docs_digest) == repo_id
    assert _recall(repo_id, "Original") == []
    assert _recall(repo_id, "Replacement")[0]["source_commit"] == (
        second.applied_commit
    )

    (source / "docs/api/migration.md").unlink()
    _commit(source, "retire team document")
    third = apply.apply_plan(target, _plan(source, target))
    assert ensure_index(client, target, third.team_docs_digest) == repo_id
    assert _recall(repo_id, "Replacement") == []
    assert (target / "docs/local.md").is_file()


def test_midscan_sync_cannot_publish_an_old_document_snapshot(
    projects, index_service, monkeypatch
):
    source, target = projects
    client, repo_id, sessions = index_service
    first = apply.apply_plan(target, _plan(source, target))
    ensure_index(client, target, first.team_docs_digest)
    build_payloads = project_indexing._payloads_for_candidates

    def update_during_scan(*args):
        result = build_payloads(*args)
        _write(source, "docs/api/migration.md", "# New\n\nReplacement.\n")
        _commit(source, "update during scan")
        apply.apply_plan(target, _plan(source, target))
        return result

    monkeypatch.setattr(
        project_indexing, "_payloads_for_candidates", update_during_scan
    )
    with sessions() as db:
        repo = db.get(Repository, repo_id)
        state = project_indexing.scan_project_index(db, repo)
    assert state["status"] == "failed"
    assert state["summary_json"]["team_docs_digest"] == first.team_docs_digest
    assert _recall(repo_id, "Replacement") == []
