import os
import subprocess
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import Base, Repository
from app.schemas.rag import RAGAnswerResponse
from app.services.rag.qa import answer_question
from app.services.rag.repository_facts import (
    is_latest_commit_question,
    read_latest_local_commit,
)


@pytest.fixture
def checkout(tmp_path):
    subprocess.run(
        ["git", "init", "-q", "--initial-branch=main", str(tmp_path)],
        check=True,
    )
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "Test Author",
        "GIT_COMMITTER_NAME": "Test Committer",
        "GIT_AUTHOR_EMAIL": "author@example.test",
        "GIT_COMMITTER_EMAIL": "committer@example.test",
        "GIT_AUTHOR_DATE": "2026-10-01T01:02:03+00:00",
        "GIT_COMMITTER_DATE": "2026-10-02T02:03:04+00:00",
    }
    subprocess.run(
        [
            "git",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "first commit",
        ],
        cwd=tmp_path,
        env=env,
        check=True,
    )
    env["GIT_COMMITTER_DATE"] = "2026-11-10T10:20:30+00:00"
    subprocess.run(
        [
            "git",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "latest commit",
        ],
        cwd=tmp_path,
        env=env,
        check=True,
    )
    return tmp_path


@pytest.mark.parametrize(
    "question",
    [
        "最近一次commit是什么时候",
        "最新提交时间",
        "上次提交是什么时候？",
        "When was the last commit?",
        "show the latest commit",
    ],
)
def test_latest_commit_intent(question):
    assert is_latest_commit_question(question)


@pytest.mark.parametrize(
    "question",
    [
        "这个项目是干什么的",
        "最新 commit 规范是什么",
        "文档中最近一次commit是什么时候",
        "最近五次commit",
        "commit message format",
        "最近100次commit",
        "show last 10 commits",
        "最近提交的Issue是什么",
        "最近一次commit修改了哪些文件",
    ],
)
def test_other_questions_keep_document_route(question):
    assert not is_latest_commit_question(question)


@pytest.mark.asyncio
async def test_latest_commit_uses_checkout_without_rag_or_llm(
    monkeypatch, checkout
):
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        selected = Repository(
            owner="team",
            name="selected",
            full_name="team/selected",
            local_path=str(checkout),
            checkout_mode="local",
        )
        other = Repository(
            owner="team",
            name="other",
            full_name="team/other",
            local_path=str(checkout / "other"),
            checkout_mode="local",
        )
        db.add_all([selected, other])
        db.commit()

        async def fail(*args, **kwargs):
            raise AssertionError(
                "A live Git fact must not use document retrieval or an LLM"
            )

        monkeypatch.setattr("app.services.rag.qa.retrieve_knowledge", fail)
        llm = type("LLM", (), {"chat_text": fail})()
        result = await answer_question(
            db, selected.id, "最近一次commit是什么时候", llm=llm
        )
        RAGAnswerResponse.model_validate(result)
        assert result["generation_mode"] == "direct"
        assert result["retrieval_count"] == 1
        assert "2026-11-10 18:20:30" in result["answer"]
        assert "latest commit" in result["answer"]
        assert "本地" in result["answer"] and "未联网" in result["answer"]
        assert result["sources"][0]["metadata"]["repo_id"] == str(selected.id)
        assert datetime.fromisoformat(
            result["sources"][0]["metadata"]["committed_at"]
        ) == datetime(2026, 11, 10, 10, 20, 30, tzinfo=timezone.utc)
        assert result["sources"][0]["source_type"] == "git_commit"

        missing = await answer_question(
            db, other.id, "最近一次commit是什么时候", llm=llm
        )
        assert missing["generation_mode"] == "no_evidence"
        assert missing["retrieval_count"] == 0
        assert missing["answer_gate"]["reason"] == "local_git_unavailable"
        assert "同步仓库" in missing["answer"]
        assert "冲突" not in missing["answer"]


def test_missing_nested_checkout_cannot_read_enclosing_repository(checkout):
    child = checkout / "child"
    child.mkdir()
    repo = Repository(
        owner="team",
        name="child",
        full_name="team/child",
        local_path=str(child),
    )
    with pytest.raises(ValueError, match="checkout"):
        read_latest_local_commit(repo)
