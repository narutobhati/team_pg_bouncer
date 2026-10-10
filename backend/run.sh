#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Kill any existing process on port 8080
echo "Stopping any existing server on port 8080..."
lsof -ti:8080 | xargs kill -9 2>/dev/null || true

sleep 1

echo "Starting backend server..."
venv/bin/python3 main.py
