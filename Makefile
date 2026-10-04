# Run `make run` to build the frontend and start the server.
# Dependencies are installed separately (see README "Setup").

PYTHON ?= .venv/bin/python
DATA_DIR ?= $(or $(ALLYGRAPH_DATA_DIR),data)

.PHONY: build run test reset-data

build:
	cd web && npm run build

run: build $(PYTHON)
	$(PYTHON) server/app.py

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

$(PYTHON):
	@echo "No virtualenv at .venv. Create it first (see README \"Setup\")." >&2
	@exit 1
