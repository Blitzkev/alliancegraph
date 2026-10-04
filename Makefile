# Run `make run` to build the frontend and start the server.
# Dependencies are installed separately (see README "Setup").

PYTHON ?= .venv/bin/python

.PHONY: build run test

build:
	cd web && npm run build

run: build $(PYTHON)
	$(PYTHON) server/app.py

test: $(PYTHON)
	cd server && ../$(PYTHON) -m pytest

$(PYTHON):
	@echo "No virtualenv at .venv. Create it first (see README \"Setup\")." >&2
	@exit 1
