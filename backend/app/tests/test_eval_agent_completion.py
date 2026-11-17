from types import SimpleNamespace
from uuid import uuid4

import pytest
from langchain_core.messages import AIMessage
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import Base, Document, Repository
from app.services.agents.chat_agent import ChatAgent
from app.services.evals.ragas_runner import (
    RagasCollectionsScorer,
    RagEvalCase,
    _default_cases,
    _hard_rules,
)


class OverlappingReadModel:
    def __init__(self):
        self.decisions = 0
        self.summaries = 0

    def bind_tools(self, tools):
        model = self

        class Bound:
            async def ainvoke(self, messages):
                model.decisions += 1
                return AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "workspace__read_file",
                            "id": f"read-{model.decisions}",
                            "args": {
                                "path": "docs/runtime.md",
                                "start_line": model.decisions,
                                "line_count": 20,
                            },
                        }
                    ],
                )

        return Bound()

    async def ainvoke(self, messages):
        self.summaries += 1
        assert "状态持久化" in messages[-1].content
        return AIMessage(
            content="运行状态持久化到本地文件，重启后标记中断。[runtime.md]"
        )


async def read_runtime(args, context):
    lines = [
        "# Runtime",
        "状态持久化到本地文件。",
        "重启后标记中断。",
        "不会自动继续执行。",
        "可查看历史运行。",
        "报告可下载。",
    ]
    start = args.get("start_line") or 1
    return {
        "route": "workspace_read_file",
        "citations": [
            {
                "type": "code_file",
                "id": "docs/runtime.md",
                "title": "runtime.md",
            }
        ],
        "answer": f"docs/runtime.md:{start}-6\n"
        + "\n".join(
            f"{number}: {text}"
            for number, text in enumerate(lines, 1)
            if number >= start
        ),
    }


@pytest.mark.asyncio
async def test_overlapping_reads_stop_and_keep_an_answer():
    model = OverlappingReadModel()
    agent = ChatAgent(model=model)
    result = await agent.run(
        {"message": "概括文档《Runtime》中的状态持久化说明。"},
        {
            "tools": {"workspace.read_file": read_runtime},
            "evaluation_mode": True,
        },
    )
    assert model.decisions == 4 < agent.max_steps
    assert model.summaries == 1
    assert result["completion"]["reason"] == "no_new_evidence"
    assert result["completion"]["status"] == "partial"
    assert "持久化" in result["answer"] and "预算上限" not in result["answer"]
    contexts = result["evaluation_trace"]["retrieved_contexts"]
    assert any("状态持久化到本地文件" in text for text in contexts)
    assert any(
        source["source_type"] == "workspace_file"
        for retrieval in result["evaluation_trace"]["retrievals"]
        for source in retrieval["sources"]
    )


@pytest.mark.asyncio
async def test_budget_stop_keeps_evidence_and_failure_status():
    model = OverlappingReadModel()
    agent = ChatAgent(model=model)
    agent.max_steps = 1
    result = await agent.run(
        {"message": "概括文档《Runtime》的内容。"},
        {"tools": {"workspace.read_file": read_runtime}},
    )
    assert result["completion"]["status"] == "budget_exhausted"
    assert result["completion"]["reason"] == "max_steps_exhausted"
    assert "状态持久化" in result["answer"]
    assert model.summaries == 1


def test_only_visible_lines_count_as_seen_and_changed_content_is_new():
    agent = ChatAgent(model=object())
    state = {}
    agent._record_evidence_progress(
        state,
        "workspace.read_file",
        {"path": "doc.md"},
        "doc.md:1-100\n1: first\n2: clipped",
    )
    agent._record_evidence_progress(
        state,
        "workspace.read_file",
        {"path": "doc.md"},
        "doc.md:3-4\n3: new line\n4: another line",
    )
    assert state["evidence_progress"]["stagnant_observations"] == 0
    agent._record_evidence_progress(
        state,
        "workspace.read_file",
        {"path": "doc.md"},
        "doc.md:4-4\n4: another line",
    )
    assert state["evidence_progress"]["stagnant_observations"] == 1
    agent._record_evidence_progress(
        state,
        "workspace.read_file",
        {"path": "doc.md"},
        "doc.md:4-4\n4: changed line",
    )
    assert state["evidence_progress"]["stagnant_observations"] == 0


@pytest.mark.parametrize(
    "status", ["budget_exhausted", "blocked", "partial", "running", "error"]
)
def test_nonempty_budget_or_blocked_messages_cannot_pass_hard_gate(status):
    case = RagEvalCase(
        question="任务说明？", reference="事实", expected_source_ids=[]
    )
    hard = _hard_rules(
        case,
        {"answer": "已达到步骤预算上限。", "completion": {"status": status}},
        [],
        ["事实"],
    )
    assert hard["answer_present"] is True
    assert hard["completion_passed"] is False
    assert hard["passed"] is False


def test_judge_uses_visible_tool_content_instead_of_hidden_raw_output():
    scorer = object.__new__(RagasCollectionsScorer)
    scorer.message_types = (
        SimpleNamespace,
        SimpleNamespace,
        SimpleNamespace,
        SimpleNamespace,
    )
    messages = scorer._messages(
        "question",
        "answer",
        [],
        [
            {
                "content": "hidden raw data",
                "visible_content": "visible evidence",
            }
        ],
    )
    assert messages[1].content == "visible evidence"


def test_document_section_question_is_not_routed_as_a_project_overview():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        repo = Repository(owner="team", name="repo", full_name="team/repo")
        db.add(repo)
        db.flush()
        db.add(
            Document(
                repo_id=repo.id,
                source_type="project_doc",
                source_id=uuid4(),
                title="架构与实现边界 · 状态恢复",
                content="运行状态存入本地文件。",
            )
        )
        db.flush()
        case = _default_cases(db, str(repo.id))[0]
        assert "架构与实现边界 · 状态恢复" in case.question
        assert "章节" in case.question
        agent = ChatAgent(model=object())
        assert not agent._asks_project_overview(case.question)
        assert agent._asks_project_overview("这个项目是做什么的？")
