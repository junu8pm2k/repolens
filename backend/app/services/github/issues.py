from app.services.github.client import GitHubClient


async def list_issues(
    owner: str,
    repo: str,
    token: str | None = None,
    limit: int = 30,
    base_url: str | None = None,
) -> list[dict]:
    client = GitHubClient(token, base_url)
    per_page = min(100, max(30, limit))
    issues: list[dict] = []
    page = 1
    # The issues endpoint includes PRs. Apply the limit to actual issues.
    while len(issues) < limit:
        items = await client.get(
            f"/repos/{owner}/{repo}/issues",
            {
                "state": "all",
                "sort": "updated",
                "direction": "desc",
                "per_page": per_page,
                "page": page,
            },
        )
        issues.extend(item for item in items if "pull_request" not in item)
        if len(items) < per_page:
            break
        page += 1
    return issues[:limit]
