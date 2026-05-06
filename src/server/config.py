from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"
    tmux_session: str = "soren"
    soren_dir: Path = Path(".soren")
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

    # Startup delay for Claude to initialize (seconds)
    claude_startup_delay: int = 8

    # Auto-sleep: idle workers are put to sleep after this many minutes (SOREN_IDLE_SLEEP_MINUTES)
    idle_sleep_minutes: int = 30

    model_config = {
        "env_prefix": "SOREN_",
        "env_file": ".env",
        "extra": "ignore",
    }


settings = Settings()
