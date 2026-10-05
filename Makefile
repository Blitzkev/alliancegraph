# `make run` builds the frontend and starts the server in the background (it keeps running after
# you log out); `make stop` stops it. `make install` installs/updates dependencies.

PYTHON ?= .venv/bin/python
GUNICORN := .venv/bin/gunicorn
DATA_DIR ?= $(or $(ALLYGRAPH_DATA_DIR),data)
HOST ?= 127.0.0.1
PORT ?= 5050
LOG_DIR := $(CURDIR)/logs
PID_FILE := $(CURDIR)/run/server.pid

# True (exit 0) when the server recorded in the pid file is alive.
IS_RUNNING = [ -f "$(PID_FILE)" ] && kill -0 "$$(cat "$(PID_FILE)")" 2>/dev/null
# True when this app answers its health check (0.0.0.0 means "all interfaces", so ask localhost).
CHECK_URL = http://$(if $(filter 0.0.0.0,$(HOST)),127.0.0.1,$(HOST)):$(PORT)/api/health
IS_HEALTHY = $(PYTHON) -c "import sys, urllib.request as u; \
  sys.exit(b'allygraph' not in u.urlopen('$(CHECK_URL)', timeout=1).read())" 2>/dev/null

.PHONY: install build run run-fg stop restart status logs test reset-data migrate

# Installs/updates Python and npm dependencies to match the repo. Run after pulling changes that
# touch server/requirements*.txt or web/package-lock.json (it's safe to run any time).
install: $(PYTHON)
	$(PYTHON) -m pip install -q -r server/requirements-dev.txt
	cd web && npm ci

build:
	cd web && npm run build

# One worker on purpose: the app's file lock is per process, so more workers could clobber writes.
run: $(GUNICORN) build
	@if $(IS_RUNNING); then \
	  echo "Already running (pid $$(cat "$(PID_FILE)")). Use 'make restart' to pick up changes."; exit 1; fi
	@mkdir -p "$(LOG_DIR)" "$(dir $(PID_FILE))"
	@$(GUNICORN) --daemon --chdir server --workers 1 --threads 8 --no-control-socket \
	  --bind "$(HOST):$(PORT)" --pid "$(PID_FILE)" \
	  --error-logfile "$(LOG_DIR)/server.log" --access-logfile "$(LOG_DIR)/access.log" \
	  "app:create_app()"
	@# Wait until it answers; give up if the process exits (e.g. the port is taken) or 15s pass.
	@for i in $$(seq 30); do $(IS_HEALTHY) && break; sleep 0.5; $(IS_RUNNING) || [ $$i -lt 4 ] || break; done; \
	if $(IS_HEALTHY); then \
	  echo "Running at http://$(HOST):$(PORT) (pid $$(cat "$(PID_FILE)"))."; \
	  echo "Logs: logs/server.log, logs/access.log. Stop with 'make stop'."; \
	else \
	  echo "Server failed to start. Last lines of logs/server.log:" >&2; \
	  tail -n 20 "$(LOG_DIR)/server.log" >&2; \
	  if $(IS_RUNNING); then kill "$$(cat "$(PID_FILE)")"; fi; rm -f "$(PID_FILE)"; exit 1; \
	fi

# Foreground development server (Ctrl+C to stop).
run-fg: build $(PYTHON)
	HOST=$(HOST) PORT=$(PORT) $(PYTHON) server/app.py

stop:
	@if $(IS_RUNNING); then \
	  pid=$$(cat "$(PID_FILE)"); kill "$$pid"; \
	  for i in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$$pid" 2>/dev/null || break; sleep 0.5; done; \
	  echo "Stopped (pid $$pid)."; \
	else echo "Not running."; fi
	@rm -f "$(PID_FILE)"

restart: stop run

status:
	@if $(IS_RUNNING); then echo "Running (pid $$(cat "$(PID_FILE)"))."; else echo "Not running."; fi

logs:
	@tail -n 50 -f "$(LOG_DIR)/server.log" "$(LOG_DIR)/access.log"

test: $(PYTHON)
	cd server && ../$(PYTHON) -m pytest

# Moves every user's graph to a timestamped backup, so the app starts empty. Safe while the server runs.
reset-data:
	@if [ ! -d "$(DATA_DIR)/users" ] && [ ! -f "$(DATA_DIR)/alliances.json" ]; then \
	  echo "No data in $(DATA_DIR); nothing to reset."; exit 0; fi; \
	printf 'Delete ALL users and their graphs in %s? A backup is kept. [y/N] ' "$(DATA_DIR)"; \
	read answer; \
	case "$$answer" in y|Y) ;; *) echo "Aborted."; exit 1 ;; esac; \
	backup="$(DATA_DIR)/backup-$$(date +%Y%m%d-%H%M%S).bak"; \
	mkdir -p "$$backup"; \
	for f in users alliances.json; do [ -e "$(DATA_DIR)/$$f" ] && mv "$(DATA_DIR)/$$f" "$$backup/"; done; \
	echo "Data reset. Backup: $$backup"

# Upgrades every user's data to the current format, after copying it to a timestamped backup.
migrate: $(PYTHON)
	@if [ -d "$(DATA_DIR)/users" ]; then \
	  backup="$(DATA_DIR)/backup-$$(date +%Y%m%d-%H%M%S)-premigrate.bak"; \
	  mkdir -p "$$backup" && cp -R "$(DATA_DIR)/users" "$$backup/" && echo "Backup: $$backup"; \
	fi
	$(PYTHON) server/migrate.py "$(DATA_DIR)"

$(PYTHON):
	@echo "No virtualenv at .venv. Create it first (see README \"Setup\")." >&2
	@exit 1

$(GUNICORN):
	@echo "gunicorn isn't installed in .venv. Run 'make install' to install the dependencies." >&2
	@exit 1
