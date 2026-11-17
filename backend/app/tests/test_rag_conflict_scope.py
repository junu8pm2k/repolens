import pytest

from app.services.rag.answer_gate import evaluate_answer_gate


def evidence(text, key, metadata=None):
    return {
        "id": key,
        "source_id": key,
        "score": 0.9,
        "snippet": text,
        "metadata": metadata or {},
    }


@pytest.mark.parametrize(
    "query,items",
    [
        (
            "最近一次commit是什么时候",
            [
                evidence("任务成功后保存运行记录。", "a"),
                evidence("测试失败时打印日志。", "b"),
            ],
        ),
        (
            "是否允许部署",
            [
                evidence("允许并发运行两个任务。", "a"),
                evidence("禁止公网部署。", "b"),
            ],
        ),
        (
            "这个项目的核心功能是什么",
            [
                evidence("可以执行网络调查。", "a"),
                evidence("不能访问凭据文件。", "b"),
            ],
        ),
        (
            "是否允许部署",
            [
                evidence("当前版本允许部署。", "a", {"branch": "legacy"}),
                evidence("当前版本禁止部署。", "b", {"branch": "main"}),
            ],
        ),
        (
            "是否允许部署",
            [
                evidence("当前版本允许部署。", "a", {"version": "v1"}),
                evidence("当前版本禁止部署。", "b", {"version": "v2"}),
            ],
        ),
    ],
)
def test_unrelated_words_topics_or_versions_are_not_conflicts(query, items):
    gate = evaluate_answer_gate(query, items, repository_name="current-repo")
    assert gate["decision"] == "answer"


@pytest.mark.parametrize("negative", ["禁止", "不允许", "不能"])
def test_opposite_claims_about_same_question_and_scope_are_still_conflicts(
    negative,
):
    items = [
        evidence("当前版本允许部署。", "a"),
        evidence(f"当前版本{negative}部署。", "b"),
    ]
    gate = evaluate_answer_gate("是否允许部署", items)
    assert gate["decision"] == "conflict"
    assert gate["conflict"]["positive_evidence_ids"] == ["a"]
    assert gate["conflict"]["negative_evidence_ids"] == ["b"]
