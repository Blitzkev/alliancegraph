# AllyGraph

A single-page site for tracking alliances and how they relate, drawn as an interactive D3 graph.

Everything is an **alliance** (name, tag, power, notes). Relationships are set in the alliance's form:

- **Family member**: families are unnamed sets of alliances that never overlap, with two or more members
  (or one member plus its academy; a lone alliance is simply independent). Pick, by tag, an alliance this
  one is in a family with: picking any member of a family joins that family, picking an independent forms
  a new family with it. A family that drops below two members (and has no academy) dissolves. A family is led by its strongest member
  (highest power, ties by name) and is shown as "<leader> family".
- **Academy**: the academy of exactly one family; a family has at most one academy. Picking an
  independent alliance makes the two a family (that alliance plus its academy). An alliance is either
  a family member, an academy, or independent.
- **Allied**: any alliance can also be allied with any number of other families, e.g. a "loner" roughly
  aligned with a family. Shown as a dashed line; it doesn't make it a member.

Deleting a family's last member while it still has an academy asks whether to move it to another
family (one without an academy), make it independent, or delete it.

Each server/kingdom has its own tab above the graph (creating one opens its tab); the graph shows one
kingdom at a time. Each family is a light blue bubble around its alliances (tag and power; the leader
in amber) and, inside it below them, its academy as a green box.
Independent alliances sit in a row at the bottom, and dashed lines show which families an alliance is
allied with. Drag a family's bubble or an independent alliance to move it anywhere (positions are saved;
"Reset layout" puts the kingdom back to the automatic arrangement), drag an alliance inside a bubble to
reorder it, and click a bubble or an alliance to see details (members, academies, allies, notes) in a
side panel. Tags are shown as `[#TAG]`.

Notes (up to 200,000 characters) are stored exactly as typed. **Power** is a whole number from 0 to
2^64-1, shown as e.g. `1,200,000`; it travels as a digit string because browsers can't represent
integers that large exactly. Within a row, alliances are ordered by power unless you rearrange them by dragging.

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
   make install                      # pip install (into .venv) + npm ci
   ```

   Without `make`: `pip install -r server/requirements-dev.txt`, then `cd web && npm ci`.

   Re-run `make install` after pulling changes that add dependencies (it's safe to run any time).

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

Data written by older versions (root alliances, named families/academies, ...) is upgraded
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

| Method | Path                         | Body / result                                                       |
| ------ | ---------------------------- | ------------------------------------------------------------------- |
| GET    | `/api/users`                 | List of users                                                       |
| POST   | `/api/users`                 | `{name}` (1-64 chars, unique) → `201` user, or `400 {errors}`        |
| GET    | `<u>/graph`                  | `{servers, families, alliances}`: everything the page needs         |
| POST   | `<u>/servers`                | `{number}` (4 digits) → `201` server                                 |
| DELETE | `<u>/servers/<number>`       | Deletes the server and everything on it                             |
| POST   | `<u>/alliances`              | `{name, tag, server, power?, notes?, role?, familyWith?, academyOf?, alliedFamilyIds?}` → `201` alliance |
| PATCH  | `<u>/alliances/<id>`         | Any of the above except `server`; omitted relationship fields keep their current values |
| PUT    | `<u>/layout`                 | `{items: [{kind: family\|academy\|alliance, id, x, y}]}`: remember dragged positions (null x/y clears) |
| PUT    | `<u>/alliances/order`        | `{ids: [...]}` → sets each alliance's display position to its index  |
| DELETE | `<u>/alliances/<id>`         | `{deleted: [ids]}`. For a family's last member with academies add `?academies=detach`, `?academies=delete` or `?academies=move&moveTo=<family id>` (otherwise `409`) |

Relationship fields: `role` is `family`, `academy` or `none` (default). With `family`, `familyWith` lists
the alliances to be in a family with (their families merge into the oldest; empty starts a new family).
With `academy`, `academyOf` is a family id, or `academyOfAlliance` an alliance id (an independent
alliance becomes a family with its new academy). Families are `{id, server, createdAt}` and exist while they
have members. Alliances carry `familyId`, `academyOf` and `alliedFamilyIds`.
