#!/bin/bash
# Local launcher for agy2api.
# The app does NOT call load_dotenv() -- .env is only honoured by docker-compose --
# so we export the variables ourselves before starting web.py.
set -euo pipefail
cd "$(dirname "$0")"
set -a
[ -f .env ] && . ./.env
set +a
exec .venv/bin/python web.py
