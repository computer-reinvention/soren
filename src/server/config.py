from typing import Optional

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    host: str = "127.0.0.1"  # hosted deployments opt in via SOREN_HOST
    port: int = 8000
    log_level: str = "INFO"
    tmux_session: str = "soren"
    soren_dir: Path = Path(".soren")

    # Consolidated SQLite database (ALL server state lives in this one file).
    # Defaults to <project_root>/.soren/soren.db (i.e. <soren_dir>/soren.db —
    # resolved in services/db.py:get_db_path). Env override: SOREN_DB.
    db_path: Optional[Path] = Field(
        default=None,
        validation_alias=AliasChoices("SOREN_DB", "SOREN_DB_PATH"),
    )
    mailbox_path: Path = Path(".soren/mailbox")
    recovery_wait_seconds: int = 30
    event_buffer_size: int = 100
    journal_path: Path = Path(".soren/journal")
    router_log_path: Path = Path(".soren/router.log")
    healthy_commit_path: Path = Path(".soren/.last_healthy_commit")

    # System windows that should be hidden from agent listings
    system_windows: list[str] = ["monitor"]

    # Main session name (immortal - cannot be killed)
    main_session: str = "soren"

    # Session prefix for spawned sessions
    session_prefix: str = "soren-"

    # Startup delay for the agent TUI to initialize (seconds)
    agent_startup_delay: int = 8

    # Auto-sleep: idle workers are put to sleep after this many minutes (SOREN_IDLE_SLEEP_MINUTES)
    idle_sleep_minutes: int = 30

    model_config = {
        "env_prefix": "SOREN_",
        "env_file": ".env",
        "extra": "ignore",
    }


settings = Settings()
