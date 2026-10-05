# AllyGraph

A single-page site for tracking alliances and how they relate, drawn as an interactive D3 graph.

Alliances are grouped into **families**:

- **Family** alliances are the members of a family, as equals. Creating one either joins an existing
  family or, with no family chosen, starts a new family with it as the first member.
- One family alliance in each family is its **root**; the family is known by it. Setting root on another
  family alliance moves it there. If the root is deleted or leaves, the strongest remaining family
  alliance (by power) becomes root.
- **Academy** alliances must belong to an existing family. Deleting a family's last family alliance
  while it has academies asks whether to move them to another family or delete them.

Each server is a box of families. In each family box the family alliances form the top row (root first,
in amber) and the academies hang below. Drag nodes sideways to reorder them; drag a root to move its whole
family. Click a family to see and edit its alliances in a side panel.

Alliances can carry free-form notes (up to 200,000 characters), stored exactly as typed, and a
**power** (a whole number from 0 to 2^64-1, shown as e.g. `1,200,000`). Power travels as a digit string
because browsers can't represent integers that large exactly. Alliances are ordered by power (highest
first) unless you rearrange them by dragging; "Sort by power" in the family panel undoes that.

Each alliance belongs to a **server/kingdom** (a 4-digit number) and is shown as
`[#TAG][#SERVER]Name`, e.g. `[#G~4][#4180]Path of Exiles`. Alliances can only be related to alliances
on the same server, and a tag can only be used once per server. Servers are created first, then
alliances are added to them.

There are no passwords. On first visit you pick an existing user or create one, and each user has their
own graph, so several people can maintain separate graphs at the same time. The browser remembers who
you picked; "Switch user" in the header goes back to the picker.

## Stack

- `server/` — Flask app: JSON API + serves the built frontend. Each user's graph lives in `data/users/<id>.json`.
- `web/` — React + webpack + D3.

## Requirements

- [Python](https://www.python.org/downloads/) 3.10 or newer
- [Node.js](https://nodejs.org/) 22.15 or newer (includes npm)

Any install method works (python.org, Homebrew, apt, pyenv, nvm, …). Check with `python3 --version` and `node --version`.

## Setup

All commands are run from the repository root.

1. Create and activate a Python virtual environment:

   ```sh
   python3 -m venv .venv
   source .venv/bin/activate        # macOS / Linux
   ```

   On Windows use `py -m venv .venv`, then `.venv\Scripts\activate` (cmd/PowerShell) or `source .venv/Scripts/activate` (Git Bash).

2. Install the server and frontend dependencies:

   ```sh
   pip install -r server/requirements.txt
   cd web
   npm install
   cd ..
   ```

## Run

```sh
make run                             # build the frontend and start the server in the background
make status                          # is it running?
make logs                            # follow logs/server.log and logs/access.log (Ctrl+C to stop watching)
make restart                         # rebuild and restart, e.g. after `git pull`
make stop
```

`make run` starts the server with [gunicorn](https://gunicorn.org/) in the background, so it keeps
running after you log out; it waits until the app answers and reports failure (with the log) otherwise.
Logs go to `logs/`, the process id to `run/server.pid`. It runs a single worker process on purpose:
the app's file lock is per process. Set `HOST`/`PORT` as usual, e.g. `HOST=0.0.0.0 PORT=12032 make run`.

`make run-fg` runs Flask's development server in the foreground instead (Ctrl+C to stop). These use
`.venv/bin/...` directly, so the venv doesn't need to be activated. Without `make` (e.g. on Windows),
activate the venv and run `cd web && npm run build && cd ..` then `python server/app.py`.
Data persists in `data/users/`.

The server doesn't come back by itself after a reboot; run `make run` again (or set up a systemd
service).

Data written by older versions (e.g. before families replaced root alliances) is upgraded
automatically the first time it's loaded. To upgrade everything up front, with a backup, run:

```sh
make migrate                         # copies data/users to data/backup-*-premigrate.bak, then upgrades
```

To start over with no users, servers or alliances, run `make reset-data`. It asks for confirmation and
moves the old data into a timestamped `data/backup-*.bak` folder.

A `data/alliances.json` from before multi-user support is imported automatically as user "Default".

For frontend development, keep the server running and in a second terminal:

```sh
cd web
npm run dev                          # rebuilds web/dist on every change; refresh the browser
```

### Configuration

| Variable         | Default               | Purpose                     |
| ---------------- | --------------------- | --------------------------- |
| `HOST`           | `127.0.0.1`           | Interface to listen on; `0.0.0.0` allows other machines to connect |
| `PORT`           | `5050`                | Server port                 |
| `ALLYGRAPH_DATA_DIR` | `data`            | Directory holding the per-user data files |

## Tests

```sh
pip install -r server/requirements-dev.txt
make test
```

## Contributing

A pre-commit hook blocks commits unless npm is the latest release and `npm audit` reports no
vulnerabilities. Enable it once per clone:

```sh
git config core.hooksPath .githooks
```

If it reports an outdated npm, run `npm install -g npm@latest` (the message says which Node version that
npm needs). `git commit --no-verify` skips the hook in an emergency.

## API

All graph endpoints are scoped to a user: `<u>` below is `/api/users/<user id>`.

| Method | Path                     | Body / result                                                             |
| ------ | ------------------------ | ------------------------------------------------------------------------- |
| GET    | `/api/users`             | List of users                                                             |
| POST   | `/api/users`             | `{name}` (1-64 chars, unique) → `201` user, or `400 {errors}`              |
| GET    | `<u>/graph`              | `{servers, families, alliances}` — everything the page needs              |
| GET    | `<u>/servers`            | List of servers                                                           |
| POST   | `<u>/servers`            | `{number}` (4 digits) → `201` server, or `400 {errors}`                    |
| DELETE | `<u>/servers/<number>`   | `{deleted: [alliance ids]}` — also deletes the server's families and alliances |
| GET    | `<u>/families`           | List of families (`{id, server, position?}`)                              |
| PUT    | `<u>/families/order`     | `{ids: [...]}` → sets each family's display position to its index          |
| GET    | `<u>/alliances`          | List of alliances                                                         |
| POST   | `<u>/alliances`          | `{name, tag, server, type: family\|academy, familyId, isRoot?, power?, notes?}` → `201` alliance. `familyId: null` on a family alliance starts a new family |
| PUT    | `<u>/alliances/order`    | `{ids: [...]}` → sets each alliance's display position to its index        |
| PATCH  | `<u>/alliances/<id>`     | Any of `{name, tag, type, familyId, isRoot, power, notes}` → updated alliance. Server is fixed |
| DELETE | `<u>/alliances/<id>`     | `{deleted: [ids]}`. For a family's last family alliance with academies, add `?academies=delete` or `?academies=move&moveTo=<family id>` (otherwise `409`) |
