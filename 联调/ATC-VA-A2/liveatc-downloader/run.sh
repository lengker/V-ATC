#!/usr/bin/env bash
# VHHH Downloader Quick Start (Bash)
# 
# This script activates the .venv virtual environment and runs the downloader
# 
# Usage:
#   bash run.sh --count 5
#   ./run.sh --export-cookie

set -e

# Get paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENV_PATH="$PROJECT_ROOT/.venv"
PYTHON_EXE="$VENV_PATH/bin/python"

# Check virtual environment
if [ ! -f "$PYTHON_EXE" ]; then
    echo "[ERROR] Virtual environment not found: $VENV_PATH"
    echo "Create it with: python -m venv .venv"
    exit 1
fi

echo ""
echo "[INFO] Using Python from: $PYTHON_EXE"
echo ""

# Run the downloader
cd "$SCRIPT_DIR"
"$PYTHON_EXE" vhhh_multimethod_download.py "$@"
