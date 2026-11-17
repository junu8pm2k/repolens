import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.routes import chat as chat_routes
from app.api.routes.action_drafts import (
    confirm_action_draft,
    create_action_draft,
)
from app.api.routes.chat import (
    _build_conversation_tools,
    _confirm_chat_draft,
    _risky_action,
)
from app.db.models import (
    ActionDraft,
    AuditLog,
    Base,
    Conversation,
    Issue,
    PullRequest,
    Repository,
    User,
)
from app.schemas.action_drafts import ActionDraftCreateRequest
from app.schemas.chat import ChatRequest
from app.services.agents.chat_agent import ChatAgent
from app.services.github.client import GitHubClient


@pytest.fixture
def records():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        repo = Repository(owner="acme", name="demo", full_name="acme/demo")
        other = Repository(owner="acme", name="other", full_name="acme/other")
        user = User(name="owner", role="owner")
        db.add_all([repo, other, user])
        db.flush()
        conversation = Conversation(repo_id=repo.id, title="Issue 发布")
        now = datetime.now(timezone.utc)
        issue = Issue(
            repo_id=repo.id, number=1, title="Requested", created_at=now
        )
        newer = Issue(
            repo_id=repo.id,
            number=2,
            title="Newer",
            created_at=now + timedelta(hours=1),
        )
        pr = PullRequest(
            repo_id=repo.id, number=3, title="Latest PR", created_at=now
        )
        db.add_all([conversation, issue, newer, pr])
        db.commit()
        yield db, repo, other, conversation, user, issue
    engine.dispose()


@pytest.mark.parametrize(
    ("message", "action"),
    [
        ("在这个项目上创建第二个测试 Issue，用于验证提交流程", "create_issue"),
        ("新建一个 issue，标题「comment reply post」", "create_issue"),
        ("create a second test issue", "create_issue"),
        ("给 Issue #1 回复，正文：请 create issue", "comment"),
        ("关闭 Issue #1", "close_issue"),
        ("给 PR #3 添加标签", "label"),
        ("发送报告", "send_report"),
        ("write something", None),
    ],
)
def test_write_intent_recognizes_chinese_and_separates_body(message, action):
    assert _risky_action(message) == action


async def _issue_draft(db, repo, conversation):
    tools = _build_conversation_tools(repo, conversation, db)
    result = await tools["safety_agent.classify_action_risk"](
        {
            "message": (
                "创建第二个测试 Issue，标题「[测试] 第二次验证」，"
                "正文为 issue bot 流程验证测试，验收为 npm run verify 通过。"
            )
        },
        {},
    )
    draft_id = result["tool_calls"][0]["arguments"]["draft_id"]
    return tools, result, db.get(ActionDraft, UUID(draft_id))


@pytest.mark.asyncio
async def test_chinese_create_issue_stores_publishable_fields_once(records):
    db, repo, _, conversation, _, _ = records
    tools, result, draft = await _issue_draft(db, repo, conversation)
    assert draft.draft_type == "create_issue"
    assert draft.target_type == "repository"
    assert draft.target_id is None
    assert draft.title == "[测试] 第二次验证"
    assert draft.content == (
        "issue bot 流程验证测试，验收为 npm run verify 通过。"
    )
    assert "MVP" not in result["answer"]
    assert draft.meta["conversation_id"] == str(conversation.id)
    repeated = await tools["safety_agent.classify_action_risk"](
        {"message": "创建第二个测试 Issue"}, {}
    )
    assert repeated == result
    assert db.query(ActionDraft).count() == 1


@pytest.mark.asyncio
async def test_explicit_issue_text_is_preserved_over_model_rewrites(records):
    db, repo, _, conversation, _, _ = records
    tools = _build_conversation_tools(repo, conversation, db)
    await tools["safety_agent.classify_action_risk"](
        {
            "message": "创建 Issue，标题「原始标题」，正文：原始正文。",
            "title": "模型改写标题",
            "content": "模型改写正文",
        },
        {},
    )
    draft = db.query(ActionDraft).one()
    assert draft.title == "原始标题"
    assert draft.content == "原始正文。"


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True])
async def test_chat_confirmation_executes_original_without_model_or_new_draft(
    records, monkeypatch, stream
):
    db, repo, _, conversation, _, _ = records
    _, _, draft = await _issue_draft(db, repo, conversation)
    expected_title, expected_body = draft.title, draft.content
    publish = AsyncMock(
        return_value={
            "number": 4,
            "html_url": "https://github.com/acme/demo/issues/4",
        }
    )
    monkeypatch.setattr(GitHubClient, "create_issue", publish)
    monkeypatch.setattr(
        ChatAgent,
        "run",
        AsyncMock(side_effect=AssertionError("No LLM needed")),
    )
    monkeypatch.setattr(
        chat_routes.ProgressiveContextManager,
        "ensure_headroom",
        AsyncMock(return_value={}),
    )
    monkeypatch.setattr(
        chat_routes.ContextAssembler,
        "assemble",
        lambda *args: SimpleNamespace(
            system_context="",
            history_messages=[],
            evidence=[],
            compression_stats={},
        ),
    )
    monkeypatch.setattr(chat_routes.SessionSealer, "seal", AsyncMock())
    monkeypatch.setattr(
        chat_routes, "pre_retrieval_policy", lambda _: {"enabled": False}
    )
    payload = ChatRequest(
        repo_id=repo.id,
        conversation_id=conversation.id,
        message=f"确认发布：对应草稿 {draft.id}",
    )
    if stream:
        events = [
            json.loads(chunk.split("data: ", 1)[1])
            async for chunk in chat_routes._conversation_sse(payload, db)
            if "event: final" in chunk
        ]
        result = events[0]
    else:
        result = await chat_routes._conversation_response(payload, db)
    assert result["route"] == "safety_confirmation"
    assert "https://github.com/acme/demo/issues/4" in result["answer"]
    publish.assert_awaited_once_with(
        repo.owner, repo.name, expected_title, expected_body
    )
    assert draft.status == "executed"
    assert db.query(ActionDraft).count() == 1
    assert db.query(AuditLog).filter(AuditLog.status == "success").count() == 2
    repeated = await _confirm_chat_draft(
        payload.message, repo, conversation, db
    )
    assert "未重复执行" in repeated["answer"]
    assert publish.await_count == 1


@pytest.mark.asyncio
async def test_comment_uses_requested_issue_instead_of_latest_pr(records):
    db, repo, _, conversation, _, issue = records
    tools = _build_conversation_tools(repo, conversation, db)
    await tools["safety_agent.classify_action_risk"](
        {
            "message": "给 Issue #1 回复",
            "draft_type": "pr_comment",
            "content": "请补充复现步骤。",
        },
        {},
    )
    draft = db.query(ActionDraft).one()
    assert draft.draft_type == "issue_comment"
    assert draft.target_id == issue.id
    assert draft.meta["target_number"] == 1
    assert draft.content == "请补充复现步骤。"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "arguments",
    [
        {"message": "发表评论", "content": "测试"},
        {"message": "给 Issue #1 回复"},
        {"message": "给 Issue #1 和 Issue #2 评论", "content": "测试"},
        {"message": "给 Issue #1 添加标签"},
        {"message": "写入外部系统"},
        {"message": "确认发布：创建第二个测试 Issue"},
    ],
)
async def test_incomplete_or_confirmation_requests_do_not_create_drafts(
    records, arguments
):
    db, repo, _, conversation, _, _ = records
    tools = _build_conversation_tools(repo, conversation, db)
    result = await tools["safety_agent.classify_action_risk"](arguments, {})
    assert result["route"] in {"safety_clarification", "safety_confirmation"}
    assert db.query(ActionDraft).count() == 0


@pytest.mark.asyncio
async def test_confirmation_is_scoped_to_repo_and_requires_permission(
    records, monkeypatch
):
    db, repo, other, conversation, user, _ = records
    _, _, draft = await _issue_draft(db, repo, conversation)
    publish = AsyncMock()
    monkeypatch.setattr(GitHubClient, "create_issue", publish)
    result = await _confirm_chat_draft(
        f"确认发布：{draft.id}", other, conversation, db
    )
    assert "未找到" in result["answer"]
    user.role = "developer"
    db.commit()
    result = await _confirm_chat_draft(
        f"确认发布：{draft.id}", repo, conversation, db
    )
    assert "draft:approve" in result["answer"]
    assert draft.status == "pending_confirmation"
    publish.assert_not_awaited()


@pytest.mark.asyncio
async def test_bare_confirmation_requires_one_draft_in_current_conversation(
    records, monkeypatch
):
    db, repo, _, conversation, _, _ = records
    _, _, draft = await _issue_draft(db, repo, conversation)
    publish = AsyncMock(return_value={"number": 4})
    monkeypatch.setattr(GitHubClient, "create_issue", publish)
    other_conversation = Conversation(repo_id=repo.id, title="Other chat")
    db.add(other_conversation)
    db.flush()
    result = await _confirm_chat_draft(
        "确认执行", repo, other_conversation, db
    )
    assert "请提供" in result["answer"]
    await _issue_draft(db, repo, conversation)
    result = await _confirm_chat_draft("确认执行", repo, conversation, db)
    assert "请提供" in result["answer"]
    assert draft.status == "pending_confirmation"
    publish.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "message",
    [
        "确认发布：{draft_id}，但是不要真正执行",
        "确认执行：{draft_id} 会发布吗？",
        "confirm execute: {draft_id}, do not publish yet",
    ],
)
async def test_confirmation_questions_and_negation_never_execute(
    records, monkeypatch, message
):
    db, repo, _, conversation, _, _ = records
    _, _, draft = await _issue_draft(db, repo, conversation)
    publish = AsyncMock()
    monkeypatch.setattr(GitHubClient, "create_issue", publish)
    result = await _confirm_chat_draft(
        message.format(draft_id=draft.id), repo, conversation, db
    )
    assert "尚未执行" in result["answer"]
    assert db.query(ActionDraft).count() == 1
    assert draft.status == "pending_confirmation"
    publish.assert_not_awaited()


def test_safety_tool_always_uses_original_user_message():
    normalized = ChatAgent(model=object())._normalize_action_input(
        "safety_agent.classify_action_risk",
        {"message": "发表评论", "draft_type": "create_issue"},
        {"message": "创建第二个测试 Issue"},
    )
    assert normalized["message"] == "创建第二个测试 Issue"


@pytest.mark.asyncio
async def test_invalid_api_and_legacy_drafts_rejected_before_execution(
    records,
):
    db, repo, _, _, user, _ = records
    with pytest.raises(HTTPException) as invalid:
        await create_action_draft(
            ActionDraftCreateRequest(
                repo_id=repo.id, draft_type="comment", content="测试"
            ),
            db=db,
            user=user,
        )
    assert invalid.value.status_code == 422
    assert db.query(ActionDraft).count() == 0
    legacy = ActionDraft(
        repo_id=repo.id,
        draft_type="comment",
        target_type="repository",
        title="comment 草稿",
        content="旧的通用写操作草稿",
    )
    db.add(legacy)
    db.commit()
    with pytest.raises(HTTPException) as invalid:
        await confirm_action_draft(legacy.id, db=db, user=user)
    assert invalid.value.status_code == 422
    assert legacy.status == "pending_confirmation"


@pytest.mark.asyncio
async def test_overlapping_confirmations_publish_once(records, monkeypatch):
    db, repo, _, conversation, user, _ = records
    _, _, draft = await _issue_draft(db, repo, conversation)

    async def publish(*args):
        await asyncio.sleep(0)
        return {"number": 4}

    mock_publish = AsyncMock(side_effect=publish)
    monkeypatch.setattr(GitHubClient, "create_issue", mock_publish)
    results = await asyncio.gather(
        confirm_action_draft(draft.id, db=db, user=user),
        confirm_action_draft(draft.id, db=db, user=user),
        return_exceptions=True,
    )
    assert sum(isinstance(result, dict) for result in results) == 1
    assert sum(isinstance(result, HTTPException) for result in results) == 1
    mock_publish.assert_awaited_once()
