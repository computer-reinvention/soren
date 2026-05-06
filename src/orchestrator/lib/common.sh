#!/usr/bin/env bash
# Common functions and variables for soren orchestrator

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get project root (where script is run from or SOREN_PROJECT_ROOT)
get_project_root() {
    echo "${SOREN_PROJECT_ROOT:-$(pwd)}"
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Ensure required commands are available
ensure_dependencies() {
    local deps=("tmux" "curl" "git" "uv" "npm")
    local missing=()

    for dep in "${deps[@]}"; do
        if ! command_exists "$dep"; then
            missing+=("$dep")
        fi
    done

    if ((${#missing[@]} > 0)); then
        echo -e "${RED}Missing dependencies: ${missing[*]}${NC}"
        exit 1
    fi
}

# Generate a unique ID
generate_id() {
    date +%s%N | sha256sum | head -c 12
}
