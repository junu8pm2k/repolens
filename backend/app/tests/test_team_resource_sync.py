import subprocess
import sys
from pathlib import Path

import pytest

from app.services.team_resources import apply, cli
from app.services.team_resources.manifest import (
    DEFAULT_DOCS_DIR,
    MANIFEST_PATH,
    docs_dir,
)
from app.services.team_resources.plan import SyncConflict, build_plan
from app.services.team_resources.source import load_snapshot

SKILL = ".agents/skills/pr-review/SKILL.md"
MIRROR = "docs/team-shared/api/migration.md"


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "-c",
            "core.autocrlf=false",
            "-c",
            "core.hooksPath=.git/no-hooks",
            "-c",
            "user.name=RepoLens Test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgSign=false",
            *args,
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=10,
    ).stdout.strip()


def _write(root: Path, path: str, content: str) -> None:
    file = root / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(content.encode())


def _commit(root: Path, message: str) -> str:
    _git(root, "add", "--all")
    _git(root, "commit", "-qm", message)
    return _git(root, "rev-parse", "HEAD")


@pytest.fixture
def projects(tmp_path):
    source = tmp_path / "team"
    target = tmp_path / "project"
    for root in (source, target):
        root.mkdir()
        _git(root, "init", "-q")
    _write(
        source,
        "skills/pr-review/SKILL.md",
        "---\nname: pr-review\ndescription: Review PRs\n---\n\n"
        "Use [checklist](references/checklist.md).\n",
    )
    _write(source, "skills/pr-review/references/checklist.md", "Check API.\n")
    _write(source, "rules/api.md", "Preserve the API.\n")
    _write(source, "agentsmd/review.md", "Group findings by severity.\n")
    _write(source, "docs/api/migration.md", "# Migration\n\nOriginal.\n")
    _write(target, "AGENTS.md", "# Existing\r\n\r\nKeep this exact.")
    _commit(source, "add team resources")
    return source, target


def _plan(source: Path, target: Path):
    return build_plan(
        source, target, load_snapshot(source), docs_dir(DEFAULT_DOCS_DIR)
    )


def test_preview_uses_committed_git_and_leaves_target_untouched(projects):
    source, target = projects
    _write(source, "docs/api/migration.md", "Uncommitted edit.")
    _write(source, "docs/untracked.md", "Untracked.")
    command = (
        Path(__file__).resolve().parents[3] / "scripts/sync_team_resources.py"
    )
    result = subprocess.run(
        [
            sys.executable,
            str(command),
            "--source",
            str(source),
            "--target",
            str(target),
            "--preview",
        ],
        capture_output=True,
        encoding="utf-8",
        check=True,
        timeout=20,
    )
    assert _git(source, "rev-parse", "HEAD") in result.stdout
    assert MIRROR in result.stdout
    assert "untracked.md" not in result.stdout
    assert not (target / ".repolens").exists()
    assert not (target / SKILL).exists()


def test_apply_pins_snapshot_and_avoids_rewriting_complete_sync(projects):
    source, target = projects
    plan = _plan(source, target)
    _write(source, "docs/api/migration.md", "Updated after preview.\n")
    other_commit = _commit(source, "advance the source")
    manifest = apply.apply_plan(target, plan)
    assert manifest.applied_commit != other_commit
    assert (target / MIRROR).read_bytes() == b"# Migration\n\nOriginal.\n"
    assert (target / SKILL).is_file()
    assert (
        (target / "AGENTS.md")
        .read_bytes()
        .startswith(b"# Existing\r\n\r\nKeep this exact.\r\n")
    )
    second = apply.apply_plan(target, _plan(source, target))
    assert second.team_docs_digest != manifest.team_docs_digest
    assert (target / MIRROR).read_text() == "Updated after preview.\n"
    repeated = _plan(source, target)
    assert not repeated.needs_write
    assert apply.apply_plan(target, repeated) == second


def test_conflicts_block_writes_and_recheck_targets_after_preview(projects):
    source, target = projects
    initial = _plan(source, target)
    _write(target, SKILL, "Personal skill.")
    assert SKILL in _plan(source, target).conflicts
    with pytest.raises(SyncConflict, match="预览后"):
        apply.apply_plan(target, initial)
    assert (target / SKILL).read_text() == "Personal skill."
    assert not (target / MIRROR).exists()


def test_rules_scope_change_and_withdrawal_preserve_local_guidance(projects):
    source, target = projects
    local = (target / "AGENTS.md").read_bytes()
    apply.apply_plan(target, _plan(source, target))
    _write(source, "rules/api.md", "---\npaths: [backend/**]\n---\nScoped\n")
    (source / "agentsmd/review.md").unlink()
    (source / "docs/api/migration.md").unlink()
    _commit(source, "withdraw resources and scope rule")
    snapshot = load_snapshot(source)
    plan = build_plan(source, target, snapshot, docs_dir(DEFAULT_DOCS_DIR))
    assert "rules/api.md" in snapshot.unsupported
    assert plan.manifest.team_docs_digest is not None
    assert set(plan.previous.files) - set(plan.manifest.files) == {
        "AGENTS.md",
        MIRROR,
    }
    apply.apply_plan(target, plan)
    assert (target / "AGENTS.md").read_bytes() == local
    assert not (target / MIRROR).exists()


def test_incomplete_file_application_can_restore_known_writes(
    projects, monkeypatch
):
    source, target = projects
    plan = _plan(source, target)
    writer = apply._write

    def interrupt_at_commit(root, path, data):
        if path == MANIFEST_PATH.as_posix():
            raise OSError("simulated manifest failure")
        writer(root, path, data)

    monkeypatch.setattr(apply, "_write", interrupt_at_commit)
    with pytest.raises(OSError, match="simulated"):
        apply.apply_plan(target, plan)
    interrupted_skill = (target / SKILL).read_bytes()
    journal = apply.pending_journal(target)
    assert journal is not None
    _write(target, SKILL, "User changed interrupted output.")
    with pytest.raises(SyncConflict, match="恢复期间"):
        apply.recover(target, journal)
    assert (target / MIRROR).is_file()

    (target / SKILL).write_bytes(interrupted_skill)
    apply.recover(target, journal)
    assert apply.pending_journal(target) is None
    assert not (target / SKILL).exists()
    assert not (target / MIRROR).exists()
    assert (
        target / "AGENTS.md"
    ).read_bytes() == b"# Existing\r\n\r\nKeep this exact."


def test_cli_reports_index_failure_without_undoing_applied_files(
    projects, monkeypatch, capsys
):
    source, target = projects
    monkeypatch.setattr(cli, "_confirm", lambda _text: True)

    def fail_index(_client, _root, _digest):
        raise ValueError("index temporarily unavailable")

    monkeypatch.setattr(cli, "ensure_index", fail_index)
    argv = ["--source", str(source), "--target", str(target)]
    assert cli.main(argv) == 5
    assert (target / MIRROR).is_file()
    assert "文档索引待重试" in capsys.readouterr().err
    monkeypatch.setattr(cli, "ensure_index", lambda *_args: None)
    assert cli.main(argv) == 0
    assert "文件无变化" in capsys.readouterr().out
