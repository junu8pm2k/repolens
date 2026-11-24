from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.routes import pull_requests, repos
from app.db.models import Base, PullRequest, Repository
from app.db.session import get_db
from app.services.llm.client import LLMClient


def test_repository_review_rules_are_used_by_both_pr_endpoints(
    monkeypatch,
) -> None:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        repository = Repository(owner="team", name="api", full_name="team/api")
        other = Repository(owner="team", name="web", full_name="team/web")
        db.add_all([repository, other])
        db.flush()
        pr = PullRequest(repo_id=repository.id, number=1, title="Update API")
        other_pr = PullRequest(repo_id=other.id, number=1, title="Update Web")
        db.add_all([pr, other_pr])
        db.commit()
        settings_url = f"/api/repos/{repository.id}/pr-review-rules"
        analysis_url = f"/api/pull-requests/{pr.id}/analyze"
        other_analysis_url = f"/api/pull-requests/{other_pr.id}/analyze"

    def test_db():
        with Session(engine) as db:
            yield db

    received_rules = []

    async def fake_chat_json(self, prompt, payload):
        rules = payload["context"].get("repository_review_rules")
        received_rules.append(rules)
        if rules:
            assert "逐条判断是否适用于当前 PR" in prompt
            return {"review_checklist": [f"{rules}：待确认"]}
        assert "context.repository_review_rules" not in prompt
        return {}

    async def fake_stream(self, *args, **kwargs):
        yield "审查过程"

    monkeypatch.setattr(LLMClient, "chat_json", fake_chat_json)
    monkeypatch.setattr(LLMClient, "chat_text_stream", fake_stream)
    monkeypatch.setattr(
        pull_requests, "search_similar_documents", lambda *args, **kwargs: []
    )
    monkeypatch.setattr(
        pull_requests, "search_repository_code", lambda *args, **kwargs: []
    )
    monkeypatch.setattr(
        pull_requests,
        "prepare_pr_worktree",
        lambda *args: {"status": "skipped"},
    )
    app = FastAPI()
    app.include_router(repos.router, prefix="/api/repos")
    app.include_router(pull_requests.router, prefix="/api")
    app.dependency_overrides[get_db] = test_db

    with TestClient(app) as client:
        assert client.get(settings_url).json() == {"rules": ""}
        assert (
            client.patch(settings_url, json={"rules": "x" * 4001}).status_code
            == 422
        )

        rule = "修改表结构时检查回滚方案"
        response = client.patch(settings_url, json={"rules": f" {rule}\r\n "})
        assert response.status_code == 200
        assert client.get(settings_url).json() == {"rules": rule}

        response = client.post(analysis_url)
        assert response.status_code == 200
        assert response.json()["result"]["review_checklist"] == [
            f"{rule}：待确认"
        ]
        stream = client.post(f"{analysis_url}/stream")
        assert "已加载 1 条仓库审查规则" in stream.text
        assert "event: final" in stream.text
        assert client.post(other_analysis_url).status_code == 200

        assert (
            client.patch(settings_url, json={"rules": ""}).status_code == 200
        )
        assert client.post(analysis_url).status_code == 200
        assert received_rules == [rule, rule, None, None]

    engine.dispose()
