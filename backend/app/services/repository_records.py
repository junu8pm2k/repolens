from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Query, Session

from app.db.models import Issue, PullRequest, WorkflowRun

REMOTE_IDS = {
    Issue: Issue.github_issue_id,
    PullRequest: PullRequest.github_pr_id,
    WorkflowRun: WorkflowRun.github_run_id,
}


def repository_records[Record: (Issue, PullRequest, WorkflowRun)](
    db: Session, model: type[Record], repo_id: UUID
) -> Query[Record]:
    """Select one stable row per GitHub ID, including all local records."""
    remote_id = REMOTE_IDS[model]
    records = (
        select(
            model.id.label("id"),
            remote_id.label("remote_id"),
            func.row_number()
            .over(partition_by=remote_id, order_by=model.id)
            .label("position"),
        )
        .where(model.repo_id == repo_id)
        .subquery()
    )
    return (
        db.query(model)
        .join(records, records.c.id == model.id)
        .filter(or_(records.c.remote_id.is_(None), records.c.position == 1))
    )
