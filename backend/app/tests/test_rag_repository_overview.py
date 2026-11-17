import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import Base, Repository
from app.services.rag.answer_gate import (
    evaluate_answer_gate,
    gate_response_message,
    is_repository_overview_query,
)
from app.services.rag.knowledge_base import retrieve_knowledge
from app.services.rag.qa import answer_question


@pytest.mark.parametrize(
    "query",
    [
        "这个项目是干什么的",
        "当前仓库是做什么的？",
        "介绍一下这个项目",
        "本项目的核心功能是什么？",
    ],
)
def test_overview_has_clear_scope_when_repository_is_selected(query):
    items = [
        {
            "id": "a",
            "source_id": "one",
            "score": 0.95,
            "snippet": "项目用于研究热点，生成有来源的报告。",
        },
        {
            "id": "b",
            "source_id": "two",
            "score": 0.9,
            "snippet": "项目包含对话、资料库和 Web 工具。",
        },
    ]
    assert is_repository_overview_query(query)
    assert (
        evaluate_answer_gate(
            query, items, repository_name="cwatch-agent", score_threshold=0.8
        )["decision"]
        == "answer"
    )


def test_overview_does_not_relax_evidence_threshold_or_unscoped_ambiguity():
    query = "这个项目是干什么的"
    item = {
        "id": "a",
        "source_id": "one",
        "score": 0.7,
        "snippet": "项目介绍。",
    }
    assert (
        evaluate_answer_gate(
            query, [item], repository_name="cwatch-agent", score_threshold=0.8
        )["decision"]
        == "insufficient_evidence"
    )
    unscoped_items = [
        {**item, "score": 0.95},
        {**item, "id": "b", "source_id": "two", "score": 0.9},
    ]
    assert (
        evaluate_answer_gate(query, unscoped_items)["decision"]
        == "ask_clarification"
    )
    assert not is_repository_overview_query("这个项目部署失败怎么办")
    assert not is_repository_overview_query("这个怎么办")


@pytest.mark.asyncio
async def test_overview_uses_repo_recall_and_original_query(
    monkeypatch,
):
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        repo = Repository(
            owner="local", name="cwatch-agent", full_name="local/cwatch-agent"
        )
        db.add(repo)
        db.commit()
        query = "这个项目是干什么的"
        expanded = "cwatch-agent 项目的用途、定位和核心功能是什么？"

        def embed(text, **kwargs):
            assert text == expanded
            return [0.1]

        def search(_db, _repo, text, **kwargs):
            assert _repo == repo.id
            assert text == expanded
            return [
                {
                    "id": "a",
                    "source_id": str(uuid.uuid4()),
                    "source_type": "project_doc",
                    "title": "Cwatch",
                    "snippet": "Cwatch 是一个本地 Agent 工作台。",
                    "_raw_content": "Cwatch 是一个本地 Agent 工作台。",
                    "score": 0.95,
                }
            ]

        async def rerank(text, items, _config, _limit):
            assert text == query
            return items

        monkeypatch.setattr(
            "app.services.rag.knowledge_base.embed_knowledge_query", embed
        )
        monkeypatch.setattr(
            "app.services.rag.knowledge_base.search_similar_documents", search
        )
        monkeypatch.setattr(
            "app.services.rag.knowledge_base._qwen_rerank", rerank
        )
        items, trace, _ = await retrieve_knowledge(db, repo.id, query)
        assert items
        assert trace["retrieval_query"] == expanded
        assert trace["repository_name"] == repo.name
        assert trace["answer_gate"]["decision"] == "answer"


@pytest.mark.asyncio
async def test_overview_keeps_evidence_and_cites_sources(
    monkeypatch,
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        repo = Repository(
            owner="local", name="cwatch-agent", full_name="local/cwatch-agent"
        )
        db.add(repo)
        db.commit()

        def search(*args, **kwargs):
            return [
                {
                    "id": str(uuid.uuid4()),
                    "source_id": str(uuid.uuid4()),
                    "source_type": "project_doc",
                    "title": "Cwatch · Web 操作界面",
                    ("snippet"): (
                        "Cwatch 是本地 Agent 任务工作台，支持任务、审批和"
                        "报告。"
                    ),
                    ("_raw_content"): (
                        "Cwatch 是本地 Agent 任务工作台，支持任务、审批和"
                        "报告。"
                    ),
                    "score": 0.9,
                }
            ]

        async def rerank(_query, items, _config, _limit):
            return [{**items[0], "score": 0.5741}]

        class LLM:
            async def chat_text(self, _system, user_message):
                assert "这个项目是干什么的" in user_message
                assert "本地 Agent 任务工作台" in user_message
                assert "[资料 1]" in user_message
                return (
                    "Cwatch 是本地 Agent 任务工作台，支持任务、审批和报告。[1]"
                )

        monkeypatch.setattr(
            "app.services.rag.knowledge_base.embed_knowledge_query",
            lambda *a, **kw: [0.1],
        )
        monkeypatch.setattr(
            "app.services.rag.knowledge_base.search_similar_documents", search
        )
        monkeypatch.setattr(
            "app.services.rag.knowledge_base._qwen_rerank", rerank
        )
        result = await answer_question(
            db, repo.id, "这个项目是干什么的", llm=LLM()
        )
        assert result["retrieval_config"]["score_threshold"] == 0.5
        assert result["generation_mode"] == "llm"
        assert result["retrieval_count"] == 1
        assert "[1]" in result["answer"]

        async def weak_rerank(_query, items, _config, _limit):
            return [{**items[0], "score": 0.1}]

        monkeypatch.setattr(
            "app.services.rag.knowledge_base._qwen_rerank", weak_rerank
        )
        refused = await answer_question(
            db, repo.id, "这个项目是干什么的", llm=LLM()
        )
        assert refused["generation_mode"] == "no_evidence"
        assert refused["retrieval_count"] == 0
        assert refused["answer_gate"]["top_candidate_score"] == 0.1
        assert "未达到当前门槛 0.50" in refused["answer"]


def test_threshold_rejection_reports_candidates_instead_of_missing_documents():
    message = gate_response_message(
        {
            "decision": "insufficient_evidence",
            "reason": "候选证据均未达到回答门槛",
            "candidate_count": 5,
            "top_candidate_score": 0.5869,
            "score_threshold": 0.8,
        }
    )
    assert "5 条候选资料" in message
    assert "0.59" in message and "0.80" in message
    assert "资料不足" not in message
