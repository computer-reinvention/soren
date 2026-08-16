#!/usr/bin/env bash
#═══════════════════════════════════════════════════════════════════════════════
# scan-project.sh - Shared project scanning library
#
# Source this file, then call scan_project <dir>.
# After calling, the following variables are set:
#   SCAN_tech_stack, SCAN_build_cmd, SCAN_test_cmd, SCAN_lint_cmd, SCAN_dev_cmd
#   SCAN_deps_summary, SCAN_dir_tree, SCAN_key_files, SCAN_conventions
#   SCAN_git_summary, SCAN_claude_md_notes
#
# Requires: jq, find, git (optional)
# Bash 3.2 compatible (macOS default).
#═══════════════════════════════════════════════════════════════════════════════

# Resolve project path from --project flag using .soren/projects.json
# Usage: resolve_project_path <project_id> <soren_root>
# Prints the resolved absolute path. Returns 1 on failure.
resolve_project_path() {
    local pid="$1"
    local root="$2"
    local reg="${root}/.soren/projects.json"
    [[ -f "$reg" ]] || return 1
    local p
    p=$(jq -r --arg id "$pid" '.projects[] | select(.id == $id) | .path' "$reg" 2>/dev/null)
    [[ -n "$p" && "$p" != "null" && -d "$p" ]] || return 1
    echo "$p"
}

# Main scan function. Sets SCAN_* variables.
# Usage: scan_project <directory> [quiet]
#   Pass "quiet" as second arg to suppress info messages.
scan_project() {
    local dir="$1"
    local quiet="${2:-}"

    _scan_info() {
        [[ "$quiet" == "quiet" ]] && return
        echo -e "\033[0;36m▶\033[0m $1"
    }

    # Reset all scan outputs
    SCAN_tech_stack=""
    SCAN_build_cmd=""
    SCAN_test_cmd=""
    SCAN_lint_cmd=""
    SCAN_dev_cmd=""
    SCAN_deps_summary=""
    SCAN_dir_tree=""
    SCAN_key_files=""
    SCAN_conventions=""
    SCAN_git_summary=""
    SCAN_claude_md_notes=""

    # --- AGENTS.md / CLAUDE.md ---
    if [[ -f "$dir/AGENTS.md" ]]; then
        SCAN_claude_md_notes="AGENTS.md present — contains project-specific instructions for agents."
    elif [[ -f "$dir/CLAUDE.md" ]]; then
        SCAN_claude_md_notes="CLAUDE.md present (legacy) — contains project-specific instructions for agents."
    fi

    # --- Package manager & dependencies ---
    if [[ -f "$dir/package.json" ]]; then
        _scan_info "Found package.json"
        local pkg="$dir/package.json"

        # Framework detection
        local frameworks=""
        for fw in react next vue svelte angular vite expo react-native express fastify hono; do
            if jq -e ".dependencies[\"$fw\"] // .devDependencies[\"$fw\"]" "$pkg" >/dev/null 2>&1; then
                frameworks="${frameworks:+$frameworks, }$fw"
            fi
        done

        # Language
        local has_ts=false
        if jq -e '.devDependencies["typescript"]' "$pkg" >/dev/null 2>&1; then
            has_ts=true
        fi

        local lang="JavaScript"
        [[ "$has_ts" == true ]] && lang="TypeScript"
        SCAN_tech_stack="${lang}${frameworks:+ ($frameworks)}"

        # Scripts
        SCAN_build_cmd=$(jq -r '.scripts.build // empty' "$pkg")
        SCAN_test_cmd=$(jq -r '.scripts.test // empty' "$pkg")
        SCAN_lint_cmd=$(jq -r '.scripts.lint // empty' "$pkg")
        SCAN_dev_cmd=$(jq -r '.scripts.dev // empty' "$pkg")

        # Top deps (up to 15)
        SCAN_deps_summary=$(jq -r '[(.dependencies // {} | keys[]), (.devDependencies // {} | keys[])] | .[0:15] | join(", ")' "$pkg" 2>/dev/null)
    fi

    if [[ -f "$dir/pyproject.toml" ]]; then
        _scan_info "Found pyproject.toml"
        local py_deps=""
        if command -v python3 >/dev/null 2>&1; then
            py_deps=$(python3 -c "
import tomllib, sys
with open('$dir/pyproject.toml', 'rb') as f:
    d = tomllib.load(f)
deps = d.get('project', {}).get('dependencies', [])
print(', '.join(deps[:15]))
" 2>/dev/null || echo "")
        fi
        if [[ -z "$py_deps" ]]; then
            py_deps=$(grep -A 20 '^\[project\]' "$dir/pyproject.toml" 2>/dev/null | grep -oP '"[^"]*"' | tr -d '"' | head -15 | paste -sd ", " -)
        fi

        local py_fw=""
        for fw in fastapi django flask starlette; do
            if grep -qi "$fw" "$dir/pyproject.toml" 2>/dev/null; then
                py_fw="${py_fw:+$py_fw, }$fw"
            fi
        done

        if [[ -n "$SCAN_tech_stack" ]]; then
            SCAN_tech_stack="${SCAN_tech_stack} + Python${py_fw:+ ($py_fw)}"
        else
            SCAN_tech_stack="Python${py_fw:+ ($py_fw)}"
        fi
        SCAN_deps_summary="${SCAN_deps_summary:+$SCAN_deps_summary; Python: }${py_deps:-<see pyproject.toml>}"
        [[ -z "$SCAN_test_cmd" ]] && SCAN_test_cmd="uv run pytest"
    fi

    if [[ -f "$dir/go.mod" ]]; then
        _scan_info "Found go.mod"
        local go_module
        go_module=$(head -1 "$dir/go.mod" | awk '{print $2}')
        SCAN_tech_stack="${SCAN_tech_stack:+$SCAN_tech_stack + }Go ($go_module)"
        [[ -z "$SCAN_test_cmd" ]] && SCAN_test_cmd="go test ./..."
        [[ -z "$SCAN_build_cmd" ]] && SCAN_build_cmd="go build ./..."
    fi

    [[ -z "$SCAN_tech_stack" ]] && SCAN_tech_stack="Unknown — check manually"

    # --- Directory structure ---
    _scan_info "Scanning directory structure"
    SCAN_dir_tree=$(ls -1 "$dir" | head -30 | while read -r entry; do
        if [[ -d "$dir/$entry" ]]; then
            echo "  $entry/"
        else
            echo "  $entry"
        fi
    done)

    # --- Key source files ---
    _scan_info "Finding key source files"
    SCAN_key_files=""
    for pattern in "src/index.*" "src/main.*" "src/app.*" "src/server/main.*" "src/server/app.*" \
                   "index.*" "main.*" "app.*" "server.*" \
                   "src/routes/*" "src/server/routes/*" "routes/*" "api/*" \
                   "src/components/*" "src/pages/*" "src/views/*"; do
        local matches
        matches=$(find "$dir" -path "$dir/node_modules" -prune -o \
                  -path "$dir/.git" -prune -o \
                  -path "$dir/dist" -prune -o \
                  -path "$dir/build" -prune -o \
                  -path "$dir/.next" -prune -o \
                  -path "$dir/__pycache__" -prune -o \
                  -path "$dir/$pattern" -print 2>/dev/null | head -5)
        if [[ -n "$matches" ]]; then
            while IFS= read -r f; do
                local rel="${f#$dir/}"
                SCAN_key_files="${SCAN_key_files:+$SCAN_key_files\n}  - $rel"
            done <<< "$matches"
        fi
    done
    [[ -z "$SCAN_key_files" ]] && SCAN_key_files="  - <none detected — check manually>"

    # --- Config files / conventions ---
    _scan_info "Checking conventions"
    SCAN_conventions=""
    for cfg in .eslintrc .eslintrc.js .eslintrc.json eslint.config.js eslint.config.mjs \
               tsconfig.json jsconfig.json \
               pytest.ini pyproject.toml setup.cfg \
               .prettierrc .prettierrc.json prettier.config.js \
               .editorconfig \
               Makefile Dockerfile docker-compose.yml; do
        if [[ -e "$dir/$cfg" ]]; then
            SCAN_conventions="${SCAN_conventions:+$SCAN_conventions, }$cfg"
        fi
    done
    [[ -z "$SCAN_conventions" ]] && SCAN_conventions="None detected"

    # --- Git recent activity ---
    _scan_info "Reading git log"
    SCAN_git_summary=""
    if [[ -d "$dir/.git" ]]; then
        SCAN_git_summary=$(git -C "$dir" log --oneline -20 2>/dev/null || echo "Could not read git log")
    fi
}

# Write the "Project Context" section to stdout using SCAN_* variables.
# Usage: write_project_context
write_project_context() {
    echo "## Project Context"
    echo ""
    echo "### Tech Stack"
    echo ""
    echo "$SCAN_tech_stack"
    echo ""
    echo "### Key Dependencies"
    echo ""
    echo "${SCAN_deps_summary:-<none detected>}"
    echo ""
    echo "### Directory Structure"
    echo ""
    echo '```'
    echo "$SCAN_dir_tree"
    echo '```'
    echo ""
    echo "### Key Files"
    echo ""
    echo -e "$SCAN_key_files"
    echo ""

    if [[ -n "$SCAN_build_cmd" || -n "$SCAN_test_cmd" || -n "$SCAN_lint_cmd" || -n "$SCAN_dev_cmd" ]]; then
        echo "### Commands"
        echo ""
        echo "| Action | Command |"
        echo "|--------|---------|"
        [[ -n "$SCAN_dev_cmd" ]]   && echo "| Dev server | \`$SCAN_dev_cmd\` |"
        [[ -n "$SCAN_build_cmd" ]] && echo "| Build | \`$SCAN_build_cmd\` |"
        [[ -n "$SCAN_test_cmd" ]]  && echo "| Test | \`$SCAN_test_cmd\` |"
        [[ -n "$SCAN_lint_cmd" ]]  && echo "| Lint | \`$SCAN_lint_cmd\` |"
        echo ""
    fi

    echo "### Config & Conventions"
    echo ""
    echo "$SCAN_conventions"
    echo ""
    [[ -n "$SCAN_claude_md_notes" ]] && echo "> $SCAN_claude_md_notes" && echo ""

    echo "### Recent Git Activity"
    echo ""
    echo '```'
    echo "${SCAN_git_summary:-No git history available}"
    echo '```'
}

# Write the static "As a Permanent Worker" section to stdout.
write_permanent_worker_section() {
    cat << 'PWSECTION'
## As a Permanent Worker

You persist across tasks. You receive work via `[TASK]` messages with task IDs from the supervisor.

### On receiving a [TASK] message:
1. Read the task details from the task system if a task ID is provided
2. Acknowledge with `[STATUS] Starting task <id>`
3. Do the work
4. Commit with a descriptive message
5. Report `[DONE]` with a summary via `./tools/mailbox done "summary"`

### Between tasks:
- You remain idle and responsive
- When nudged by heartbeat, respond with `[SYS] Idle — awaiting task.`

### Context resets:
- Your supervisor may reset your context periodically
- After reset, re-read this file and check for any in-progress tasks

## Team Reference

See [docs/TEAM.md](../../docs/TEAM.md) for the full team architecture, topology, and coordination protocols.
PWSECTION
}
