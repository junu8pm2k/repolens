import sys
from pathlib import Path

# Make the backend package available when invoking this file directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.services.team_resources.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
