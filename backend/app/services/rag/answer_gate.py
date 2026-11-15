import re
from typing import Any


AMBIGUOUS_MARKERS = ("这个", "那个", "它", "这段", "这里", "怎么办", "怎么处理")
CONFLICT_POLARITIES = (
    ("permission", ("允许", "可以", "enabled", "enable"), ("禁止", "不允许", "不能", "disabled", "disable")),
    ("outcome", ("成功", "通过", "success", "passed"), ("失败", "未通过", "failure", "failed")),
    ("requirement", ("必须", "需要", "required"), ("可选", "无需", "optional")),
)


def _normalise(text: str) -> str:
    return " ".join(str(text or "").lower().split())


def _evidence_text(item: dict[str, Any]) -> str:
    metadata = item.get("metadata") or {}
    return _normalise(
        "\n".join(
            [
                str(item.get("title") or ""),
                str(item.get("snippet") or item.get("_raw_content") or ""),
                str(metadata.get("path") or ""),
                str(metadata.get("symbol") or ""),
                str(metadata.get("branch") or metadata.get("base_branch") or ""),
            ]
        )
    )


def _strong_query_signals(query: str) -> list[str]:
    candidates = re.findall(r"[A-Za-z][A-Za-z0-9_./\-]*|#\d+|\b\d{3,}\b", query)
    signals: list[str] = []
    for candidate in candidates:
        if (
            any(marker in candidate for marker in ("_", ".", "/", "-"))
            or any(char.isdigit() for char in candidate)
            or candidate.endswith(("Error", "Exception"))
        ):
            signals.append(candidate.lower())
    return list(dict.fromkeys(signals))


def _marker_pattern(markers: tuple[str, ...]) -> str:
    return "|".join(
        rf"\b{re.escape(marker)}\b" if marker.isascii() else re.escape(marker)
        for marker in sorted(markers, key=len, reverse=True)
    )


def _query_topics(query: str) -> set[str]:
    text = _normalise(query)
    markers = tuple(marker for _, positives, negatives in CONFLICT_POLARITIES for marker in (*positives, *negatives))
    text = re.sub(_marker_pattern(markers), "", text)
    text = re.sub(r"是否|能否|当前|现在|这个|那个|应该|怎么|如何|吗|的", "", text)
    tokens = set(re.findall(r"[a-z][a-z0-9_-]+", text)) - {"is", "the", "this", "can", "should", "whether", "what", "how", "it"}
    for segment in re.findall(r"[\u4e00-\u9fff]+", text):
        tokens.update(segment[index:index + 2] for index in range(len(segment) - 1))
    return tokens


def _same_claim_scope(left: dict[str, Any], right: dict[str, Any]) -> bool:
    left_meta, right_meta = left.get("metadata") or {}, right.get("metadata") or {}
    for keys in (("branch", "base_branch"), ("version",), ("commit_sha", "revision")):
        left_value = next((left_meta[key] for key in keys if left_meta.get(key)), None)
        right_value = next((right_meta[key] for key in keys if right_meta.get(key)), None)
        if left_value is not None and right_value is not None and left_value != right_value:
            return False
    return True


def _detect_conflict(query: str, items: list[dict[str, Any]]) -> dict[str, Any] | None:
    high_confidence = [item for item in items if float(item.get("score") or 0.0) >= 0.6]
    if len(high_confidence) < 2:
        return None
    topics = _query_topics(query)
    if not topics:
        return None
    for conflict_type, positive_markers, negative_markers in CONFLICT_POLARITIES:
        positive_pattern = _marker_pattern(positive_markers)
        negative_pattern = _marker_pattern(negative_markers)
        claims: dict[str, list[tuple[bool, dict[str, Any]]]] = {}
        for item in high_confidence:
            content = str(item.get("_raw_content") or item.get("snippet") or "").lower()
            for sentence in re.split(r"[。！？；;\n]+|(?<=[.!?])\s+", content):
                sentence = _normalise(sentence)
                negative = bool(re.search(negative_pattern, sentence))
                if not negative and not re.search(positive_pattern, sentence):
                    continue
                claim = re.sub(f"{negative_pattern}|{positive_pattern}", "", sentence)
                if not any(topic in claim for topic in topics):
                    continue
                claim = re.sub(r"[\s\W_]+", "", claim)
                if claim:
                    claims.setdefault(claim, []).append((negative, item))
        for claim, statements in claims.items():
            for negative, left in statements:
                if negative:
                    continue
                for opposite, right in statements:
                    left_id = str(left.get("id") or left.get("source_id") or "")
                    right_id = str(right.get("id") or right.get("source_id") or "")
                    if opposite and left_id != right_id and _same_claim_scope(left, right):
                        return {
                            "type": conflict_type, "claim": claim,
                            "positive_evidence_ids": [left_id], "negative_evidence_ids": [right_id],
                        }
    return None


def _is_ambiguous_query(query: str, items: list[dict[str, Any]]) -> bool:
    compact = re.sub(r"\s+", "", query)
    if not any(marker in compact for marker in AMBIGUOUS_MARKERS):
        return False
    source_ids = {str(item.get("source_id") or "") for item in items if item.get("source_id")}
    return len(source_ids) > 1 or len(compact) <= 8


def is_repository_overview_query(query: str) -> bool:
    compact = re.sub(r"\s+", "", query).strip("？?。.!！")
    subject = r"(?:这个|当前|本)(?:项目|仓库)"
    return bool(
        re.fullmatch(
            subject + r"(?:是(?:干|做)什么的?|是什么|有什么用|(?:的)?(?:主要功能|核心功能|用途|定位)(?:是什么)?|有哪些(?:核心|主要)?功能|简介|概览)",
            compact,
        )
        or re.fullmatch(r"(?:请)?(?:介绍|概述|总结)(?:一下)?" + subject, compact)
    )


def evaluate_answer_gate(
    query: str,
    items: list[dict[str, Any]],
    *,
    score_threshold: float = 0.0,
    threshold_enabled: bool = True,
    repository_name: str | None = None,
) -> dict[str, Any]:
    top_score = max((float(item.get("score") or 0.0) for item in items), default=0.0)
    base = {
        "evidence_count": len(items),
        "top_score": round(top_score, 4),
        "score_threshold": round(float(score_threshold), 4) if threshold_enabled else None,
    }
    if not items:
        return {**base, "decision": "insufficient_evidence", "reason": "没有检索到满足条件的证据"}
    if threshold_enabled and top_score < score_threshold:
        return {**base, "decision": "insufficient_evidence", "reason": "最高证据分数未达到回答门槛"}

    signals = _strong_query_signals(query)
    evidence_text = "\n".join(_evidence_text(item) for item in items)
    missing_signals = [signal for signal in signals if signal not in evidence_text]
    if signals and len(missing_signals) == len(signals):
        return {
            **base,
            "decision": "insufficient_evidence",
            "reason": "查询中的关键名称没有出现在候选证据中",
            "required_signals": signals,
            "missing_signals": missing_signals,
        }

    conflict = _detect_conflict(query, items)
    if conflict:
        return {**base, "decision": "conflict", "reason": "高排名证据给出了相反结论", "conflict": conflict}

    scoped_overview = bool(repository_name) and is_repository_overview_query(query)
    if not scoped_overview and _is_ambiguous_query(query, items):
        return {
            **base,
            "decision": "ask_clarification",
            "reason": "问题缺少可定位的对象或范围",
            "suggested_fields": ["文件或模块", "错误名称", "分支或版本"],
        }

    return {
        **base,
        "decision": "answer",
        "reason": "证据达到分数门槛，关键名称可以在候选中核对",
        "matched_signals": [signal for signal in signals if signal in evidence_text],
    }


def gate_response_message(gate: dict[str, Any]) -> str:
    decision = str(gate.get("decision") or "insufficient_evidence")
    if decision == "ask_clarification":
        return "当前问题的对象或范围不够明确。请补充文件、模块、错误名称、分支或版本后再试。"
    if decision == "conflict":
        return "当前知识库中的高排名证据存在冲突，暂时无法给出确定结论。请先核对对应来源或版本。"
    if gate.get("reason") == "候选证据均未达到回答门槛":
        score = float(gate.get("top_candidate_score") or 0.0)
        threshold = float(gate.get("score_threshold") or 0.0)
        return (
            f"检索到了 {int(gate.get('candidate_count') or 0)} 条候选资料，但最高相关性分数 "
            f"{score:.2f} 未达到当前门槛 {threshold:.2f}。请在知识库检索设置中调整分数门槛，或补充更直接的资料。"
        )
    return "当前知识库资料不足，无法确认。请补充相关资料、检查检索范围，或换一种更具体的问法。"
