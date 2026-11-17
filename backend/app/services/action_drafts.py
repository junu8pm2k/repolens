from sqlalchemy.orm import Session

from app.db.models import ActionDraft, Issue, PullRequest

COMMENT_TYPES = {"comment", "issue_comment", "pr_comment"}
LABEL_TYPES = {"label", "add_label", "add_labels"}
SUPPORTED_TYPES = (
    COMMENT_TYPES
    | LABEL_TYPES
    | {
        "create_issue",
        "close_issue",
        "send_report",
    }
)


def target_number(db: Session, draft: ActionDraft) -> int | None:
    meta = draft.meta or {}
    raw = next(
        (
            meta[key]
            for key in ("target_number", "issue_number", "pr_number")
            if meta.get(key) is not None
        ),
        None,
    )
    number = None
    if raw is not None:
        try:
            number = int(raw)
        except (TypeError, ValueError):
            return None
        if isinstance(raw, bool) or str(number) != str(raw).strip():
            return None
        if number <= 0:
            return None
    if draft.target_id:
        model = {
            "issue": Issue,
            "pull_request": PullRequest,
            "pr": PullRequest,
        }.get(draft.target_type)
        target = db.get(model, draft.target_id) if model else None
        if target is None or target.repo_id != draft.repo_id:
            raise ValueError("草稿目标不属于当前仓库或已不存在")
        if number is not None and number != target.number:
            raise ValueError("草稿目标编号与目标记录不一致")
        number = target.number
    return number


def validate_action_draft(db: Session, draft: ActionDraft) -> None:
    draft_type = draft.draft_type.lower()
    if draft_type not in SUPPORTED_TYPES:
        raise ValueError(f"暂不支持执行草稿类型：{draft.draft_type}")
    if draft_type == "create_issue":
        if not draft.title.strip():
            raise ValueError("创建 Issue 草稿缺少标题")
        return
    if draft_type in COMMENT_TYPES | LABEL_TYPES | {"close_issue"}:
        if draft.target_type not in {"issue", "pull_request", "pr"}:
            raise ValueError("请明确指定要操作的 Issue 或 PR")
        if draft_type == "close_issue" and draft.target_type != "issue":
            raise ValueError("关闭 Issue 草稿的目标必须是 Issue")
        if target_number(db, draft) is None:
            raise ValueError("请指定有效的 Issue/PR 编号后再生成草稿")
    if draft_type in COMMENT_TYPES and not draft.content.strip():
        raise ValueError("评论草稿缺少正文")
    if draft_type in LABEL_TYPES:
        labels = (draft.meta or {}).get("labels")
        if not isinstance(labels, list) or not labels:
            labels = [draft.title] if draft.title.strip() else []
        if not labels or any(
            not isinstance(label, str) or not label.strip() for label in labels
        ):
            raise ValueError("Label 草稿缺少有效的 labels")
