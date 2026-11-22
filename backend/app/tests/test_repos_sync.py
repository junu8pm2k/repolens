import os

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import (
    Base,
    Document,
    Issue,
    PRFile,
    PRReviewComment,
    PullRequest,
    Repository,
    WorkflowRun,
)
from app.schemas.repos import RepoSyncRequest
from app.services.github import issues as github_issues
from app.services.repos_sync import sync_repository
from app.services.repository_records import repository_records


def _db_session():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


@pytest.mark.asyncio
async def test_sync_repository_persists_facts_without_triggering_rag(
    monkeypatch,
) -> None:
    async def fake_list_issues(*_args, **_kwargs):
        return [
            {
                "id": 7800,
                "number": 78,
                "title": "Error: Could not import 'app'.",
                "body": "Realistic issue body",
                "state": "open",
                "labels": [{"name": "bug"}],
                "user": {"login": "contributor"},
                "assignees": [],
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-02T00:00:00Z",
                "closed_at": None,
            }
        ]

    def fail_if_vector_runtime_is_used(*_args, **_kwargs):
        raise AssertionError(
            "GitHub fact sync must not depend on embeddings or Milvus"
        )

    monkeypatch.setattr(
        "app.services.repos_sync.list_issues", fake_list_issues
    )
    monkeypatch.setattr(
        "app.services.rag.vector_store.embed_texts",
        fail_if_vector_runtime_is_used,
    )
    monkeypatch.setattr(
        "app.services.rag.vector_store.delete_milvus_documents",
        fail_if_vector_runtime_is_used,
    )
    monkeypatch.setattr(
        "app.services.rag.vector_store.upsert_milvus_documents",
        fail_if_vector_runtime_is_used,
    )

    db = _db_session()
    repo = Repository(
        owner="openai",
        name="openai-quickstart-python",
        full_name="openai/openai-quickstart-python",
        provider="github",
        api_base_url="https://api.github.com",
    )
    db.add(repo)
    db.commit()

    result = await sync_repository(
        db,
        repo,
        RepoSyncRequest(
            sync_pull_requests=False, sync_workflow_runs=False, limit=1
        ),
    )

    issue = db.query(Issue).filter(Issue.repo_id == repo.id).one()
    assert result.status == "completed"
    assert result.synced == {
        "issues": 1,
        "pull_requests": 0,
        "workflow_runs": 0,
    }
    assert issue.number == 78
    assert issue.title == "Error: Could not import 'app'."
    assert db.query(Document).filter(Document.repo_id == repo.id).count() == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["http_error", "timeout", "empty_success"])
async def test_pr_detail_sync_only_replaces_existing_data_after_success(
    monkeypatch, outcome
):
    db = _db_session()
    repo = Repository(
        owner="team", name="repo", full_name="team/repo", provider="github"
    )
    db.add(repo)
    db.flush()
    pr = PullRequest(
        repo_id=repo.id, github_pr_id=123, number=1, title="old title"
    )
    db.add(pr)
    db.flush()
    db.add_all(
        [
            PRFile(pr_id=pr.id, filename="existing.py", status="modified"),
            PRReviewComment(pr_id=pr.id, body="existing review"),
        ]
    )
    db.commit()

    async def list_prs(*args, **kwargs):
        return [{"id": 123, "number": 1, "title": "new title"}]

    async def details(*args, **kwargs):
        if outcome == "empty_success":
            return []
        request = httpx.Request("GET", "https://api.example.test/pr-details")
        if outcome == "timeout":
            raise httpx.ReadTimeout("timed out", request=request)
        response = httpx.Response(503, request=request)
        raise httpx.HTTPStatusError(
            "unavailable", request=request, response=response
        )

    monkeypatch.setattr("app.services.repos_sync.list_pull_requests", list_prs)
    monkeypatch.setattr(
        "app.services.repos_sync.list_pull_request_files", details
    )
    monkeypatch.setattr(
        "app.services.repos_sync.list_pull_request_review_comments", details
    )
    await sync_repository(
        db, repo, RepoSyncRequest(sync_issues=False, sync_workflow_runs=False)
    )
    assert db.get(PullRequest, pr.id).title == "new title"
    expected = 0 if outcome == "empty_success" else 1
    assert db.query(PRFile).filter(PRFile.pr_id == pr.id).count() == expected
    assert (
        db.query(PRReviewComment)
        .filter(PRReviewComment.pr_id == pr.id)
        .count()
        == expected
    )


@pytest.mark.asyncio
async def test_sync_recovers_from_duplicate_github_records(monkeypatch):
    db = _db_session()
    repo = Repository(owner="team", name="repo", full_name="team/repo")
    db.add(repo)
    db.flush()
    for _ in range(2):
        db.add_all(
            [
                Issue(
                    repo_id=repo.id, github_issue_id=1, number=1, title="Issue"
                ),
                PullRequest(
                    repo_id=repo.id, github_pr_id=2, number=2, title="PR"
                ),
                WorkflowRun(
                    repo_id=repo.id,
                    github_run_id=3,
                    name="CI",
                    status="in_progress",
                ),
            ]
        )
    for number in (10, 11):
        db.add(Issue(repo_id=repo.id, number=number, title="Local issue"))
    db.commit()

    async def list_issues(*args, **kwargs):
        return [
            {
                "id": 1,
                "number": 1,
                "state": "closed",
                "state_reason": "completed",
            }
        ]

    async def list_prs(*args, **kwargs):
        return [
            {"id": 2, "number": 2, "state": "closed"},
            {
                "id": 4,
                "number": 4,
                "title": "Merged PR",
                "state": "closed",
                "merged_at": "2026-11-21T14:28:28Z",
            },
        ]

    async def list_runs(*args, **kwargs):
        return [
            {"id": 3, "status": "completed", "conclusion": "success"},
            {"id": 5, "status": "in_progress"},
        ]

    async def empty_details(*args, **kwargs):
        return []

    for name, callback in (
        ("list_issues", list_issues),
        ("list_pull_requests", list_prs),
        ("list_workflow_runs", list_runs),
        ("list_pull_request_files", empty_details),
        ("list_pull_request_review_comments", empty_details),
        ("list_workflow_run_jobs", empty_details),
    ):
        monkeypatch.setattr(f"app.services.repos_sync.{name}", callback)

    for _ in range(2):
        result = await sync_repository(db, repo, RepoSyncRequest())
        assert result.status == "completed"
        assert result.synced == {
            "issues": 1,
            "pull_requests": 2,
            "workflow_runs": 2,
        }
    issues = repository_records(db, Issue, repo.id).all()
    assert {issue.number for issue in issues} == {1, 10, 11}
    assert len(issues) == 3
    closed_issue = next(issue for issue in issues if issue.number == 1)
    assert (closed_issue.state, closed_issue.state_reason) == (
        "closed",
        "completed",
    )
    prs = (
        repository_records(db, PullRequest, repo.id)
        .order_by(PullRequest.number)
        .all()
    )
    assert [pr.number for pr in prs] == [2, 4]
    assert prs[0].state == "closed"
    assert prs[0].merged_at is None
    assert prs[1].merged_at is not None
    runs = repository_records(db, WorkflowRun, repo.id).all()
    assert {run.github_run_id: run.status for run in runs} == {
        3: "completed",
        5: "in_progress",
    }
    assert next(run for run in runs if run.github_run_id == 3).conclusion == (
        "success"
    )
    assert db.query(PullRequest).filter(PullRequest.number == 2).count() == 2


@pytest.mark.asyncio
async def test_issue_sync_limit_counts_issues_after_skipping_prs(monkeypatch):
    requested_pages = []

    async def get(_client, _path, params):
        requested_pages.append(params["page"])
        if params["page"] == 1:
            return [{"pull_request": {}}] * params["per_page"]
        return [{"id": 99, "number": 1}]

    monkeypatch.setattr(github_issues.GitHubClient, "get", get)
    assert await github_issues.list_issues("team", "repo", limit=1) == [
        {"id": 99, "number": 1}
    ]
    assert requested_pages == [1, 2]
