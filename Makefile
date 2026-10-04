# Run `make run` to build the frontend and start the server.
# Dependencies are installed separately (see README "Setup").

PYTHON ?= .venv/bin/python
DATA ?= $(or $(ALLYGRAPH_DATA),data/alliances.json)

.PHONY: build run test reset-data

build:
	cd web && npm run build

run: build $(PYTHON)
	$(PYTHON) server/app.py

test: $(PYTHON)
	cd server && ../$(PYTHON) -m pytest

# Moves the data file to a timestamped backup, so the app starts empty. Safe while the server runs.
reset-data:
	@if [ ! -f "$(DATA)" ]; then echo "No data at $(DATA); nothing to reset."; exit 0; fi; \
	printf 'Delete all servers and alliances in %s? A backup is kept. [y/N] ' "$(DATA)"; \
	read answer; \
	case "$$answer" in y|Y) ;; *) echo "Aborted."; exit 1 ;; esac; \
	backup="$(DATA).$$(date +%Y%m%d-%H%M%S).bak"; \
	mv "$(DATA)" "$$backup" && echo "Data reset. Backup: $$backup"

$(PYTHON):
	@echo "No virtualenv at .venv. Create it first (see README \"Setup\")." >&2
	@exit 1
