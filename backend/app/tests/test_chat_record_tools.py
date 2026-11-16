from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from langchain_core.messages import AIMessage

from app.api.routes.chat import _build_conversation_tools
from app.db.models import Issue, Repository, WorkflowRun
from app.db.session import Base
from app.services.agents.ci_debug_agent import CIDebugAgent
from app.services.agents.issue_agent import IssueAgent
from app.services.agents.chat_agent import ChatAgent


@pytest.fixture
def records():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        repo = Repository(owner="acme", name="chat", full_name="acme/chat")
        other = Repository(owner="acme", name="other", full_name="acme/other")
        db.add_all([repo, other])
        db.flush()
        now = datetime.now(timezone.utc)
        requested = Issue(repo_id=repo.id, number=1, title="[测试] 验证 Issue 提交与跟进流程",
                          body="这是一条测试 Issue，不是真实缺陷。只改 README。", state="open", created_at=now)
        newer = Issue(repo_id=repo.id, number=2, title="Newer issue", state="open", created_at=now + timedelta(hours=1))
        foreign = Issue(repo_id=other.id, number=99, title="Other repo issue", state="open")
        run = WorkflowRun(repo_id=repo.id, name="requested-ci", status="completed", conclusion="failure",
                          logs_text="AssertionError: expected 2, got 1", jobs=[], created_at=now)
        db.add_all([requested, newer, foreign, run])
        db.commit()
        yield db, repo, requested, foreign, run
    engine.dispose()


@pytest.mark.asyncio
async def test_issue_original_fields_are_readable_without_analysis_or_rag(records, monkeypatch):
    db, repo, issue, _, _ = records

    async def unexpected_analysis(*args, **kwargs):
        pytest.fail("Reading an Issue must not invoke analysis")

    monkeypatch.setattr(IssueAgent, "run", unexpected_analysis)
    tools = _build_conversation_tools(repo, None, db)
    result = await tools["repo.get_issue"]({"number": 1}, {})
    assert result["issue"]["id"] == str(issue.id)
    assert result["issue"]["title"] == issue.title
    assert issue.title in result["answer"]
    assert issue.body in result["answer"]


@pytest.mark.asyncio
async def test_issue_field_projection_omits_unrequested_body_and_state(records):
    db, repo, issue, _, _ = records
    tools = _build_conversation_tools(repo, None, db)
    result = await tools["repo.get_issue"]({"number": 1, "fields": ["title"]}, {})
    assert result["issue"] == {"title": issue.title}
    assert issue.title in result["answer"]
    assert issue.body not in result["answer"]
    assert "state" not in result["answer"]


@pytest.mark.asyncio
async def test_exact_title_request_returns_the_original_without_another_model_summary(records):
    db, repo, issue, _, _ = records

    class LookupModel:
        calls = 0

        def bind_tools(self, tools):
            return self

        async def ainvoke(self, messages):
            self.calls += 1
            assert self.calls == 1, "A summary call could append unwanted explanation"
            return AIMessage(content="", tool_calls=[{
                "name": "repo__get_issue", "id": "lookup-title", "args": {"number": 1, "fields": ["title"]},
            }])

    model = LookupModel()
    result = await ChatAgent(model=model).run({"message": "直接输出 Issue #1 标题"}, {
        "tools": _build_conversation_tools(repo, None, db),
    })
    assert result["answer"] == issue.title
    assert result["completion"]["reason"] == "requested_field_returned"
    assert model.calls == 1


def test_exact_field_response_does_not_accept_a_different_issue_number():
    agent = ChatAgent(model=object())
    assert agent._requested_record_value("只输出 #1 标题", "repo.get_issue", {
        "route": "issue_detail", "record_identity": {"number": 2}, "record_fields": {"title": "Wrong issue"},
    }) is None


@pytest.mark.asyncio
async def test_issue_lookup_never_falls_back_or_crosses_repository(records):
    db, repo, _, foreign, _ = records
    tools = _build_conversation_tools(repo, None, db)
    for tool_name in ("repo.get_issue", "issue_agent.analyze_issue"):
        for arguments in ({"number": 999}, {"issue_id": str(foreign.id)}, {"number": 99}):
            with pytest.raises(LookupError):
                await tools[tool_name](arguments, {})


@pytest.mark.asyncio
async def test_issue_analysis_preserves_requested_identity_and_original_text(records, monkeypatch):
    db, repo, issue, _, _ = records

    async def analyze(self, input_data, context):
        assert input_data["id"] == str(issue.id)
        return {"conclusion": "处理", "category": "Documentation", "priority": "P3", "complexity": "S",
                "suggested_owner": "待分配", "owner_reason": "", "conclusion_reason": "测试流程", "checklist": []}

    monkeypatch.setattr(IssueAgent, "run", analyze)
    tools = _build_conversation_tools(repo, None, db)
    result = await tools["issue_agent.analyze_issue"]({"issue_id": str(issue.id)}, {})
    assert issue.title in result["answer"]
    assert issue.body in result["answer"]


@pytest.mark.asyncio
async def test_ci_analysis_exposes_error_and_root_cause_for_requested_run(records, monkeypatch):
    db, repo, _, _, run = records
    db.add(WorkflowRun(repo_id=repo.id, name="newer-ci", status="completed", conclusion="failure",
                       created_at=datetime.now(timezone.utc) + timedelta(hours=1)))
    db.flush()

    async def analyze(self, input_data, context):
        assert input_data["name"] == run.name
        return {"failure_type": "test", "failure_summary": "Tests failed", "first_error": run.logs_text,
                "root_cause": "Result count differs", "fix_steps": ["Check count logic"], "debug_steps": []}

    monkeypatch.setattr(CIDebugAgent, "run", analyze)
    tools = _build_conversation_tools(repo, None, db)
    result = await tools["ci_debug_agent.analyze_workflow_run"]({"run_id": str(run.id)}, {})
    assert run.logs_text in result["answer"]
    assert "Result count differs" in result["answer"]
    assert "Check count logic" in result["answer"]
