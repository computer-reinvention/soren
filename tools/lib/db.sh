# shellcheck shell=bash
#═══════════════════════════════════════════════════════════════════════════════
# db.sh - Shared access to the consolidated SOREN SQLite database
#
# All SOREN state lives in a single SQLite file: .soren/soren.db
# (override with SOREN_DB). The legacy per-domain DBs (tasks.db,
# conversations.db, agent_registry.db, auth.db, memories.db) are consolidated
# into it by tools/migrate-state; on migration the legacy files are moved to
# .soren/backup-pre-consolidation/<timestamp>/.
#
# Provides:
#   SOREN_DB_PATH             - resolved path to the consolidated database
#   soren_db [flags...] [SQL] - sqlite3 wrapper with a 5s busy timeout
#
# Source this from tools/* and orchestrator scripts. Bash 3.2 compatible.
#═══════════════════════════════════════════════════════════════════════════════

# Resolve the consolidated DB path once at source time.
# Project root derivation mirrors the other tools/lib files:
# SOREN_HOME, then SOREN_PROJECT_ROOT, then the git toplevel, then cwd.
if [ -n "${SOREN_DB:-}" ]; then
    SOREN_DB_PATH="$SOREN_DB"
else
    _soren_db_root="${SOREN_HOME:-${SOREN_PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"
    SOREN_DB_PATH="${_soren_db_root}/.soren/soren.db"
    unset _soren_db_root
fi

# soren_db [sqlite3-flags...] ["SQL" ...]
#
# Thin wrapper around:  sqlite3 -cmd '.timeout 5000' [flags] "$SOREN_DB_PATH" ["SQL"]
#
# sqlite3 requires flags BEFORE the database path, so leading '-'-prefixed
# args are forwarded as flags and everything from the first non-flag arg on
# is forwarded after the path (the SQL). With no SQL args, sqlite3 reads
# statements from stdin — heredoc and pipe usage work unchanged:
#
#   soren_db "SELECT COUNT(*) FROM tasks;"
#   soren_db -separator "$SEP" "SELECT id, title FROM tasks;"
#   soren_db <<'SQL'
#   CREATE TABLE IF NOT EXISTS t (...);
#   SQL
#
# The 5s busy timeout is the project-wide contract for the shared DB — do
# not add per-call PRAGMA busy_timeout statements.
soren_db() {
    local _soren_db_flags=()
    while [ "$#" -gt 0 ]; do
        case "$1" in
            # sqlite3 flags that take a value
            -separator|-cmd|-init|-nullvalue|-newline|-A|-lookaside|-mmap|-pagecache|-vfs)
                _soren_db_flags[${#_soren_db_flags[@]}]="$1"
                _soren_db_flags[${#_soren_db_flags[@]}]="${2-}"
                shift 2 || break
                ;;
            # any other flag is boolean (-json, -line, -csv, -header, ...)
            -*)
                _soren_db_flags[${#_soren_db_flags[@]}]="$1"
                shift
                ;;
            # first non-flag arg starts the SQL
            *)
                break
                ;;
        esac
    done
    # ${arr[@]+...} keeps empty-array expansion safe under bash 3.2 set -u
    sqlite3 -cmd '.timeout 5000' ${_soren_db_flags[@]+"${_soren_db_flags[@]}"} "$SOREN_DB_PATH" "$@"
}
