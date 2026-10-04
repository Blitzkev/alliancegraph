# AllyGraph

A single-page site for tracking alliances and how they relate, drawn as an interactive D3 graph.

- **Root** alliances sit at the top of an umbrella.
- **Family** alliances are equal members under a root.
- **Academy** alliances are protected members under a root.

Each alliance belongs to a **server/kingdom** (a 4-digit number) and is shown as
`[#TAG][#SERVER]Name`, e.g. `[#G~4][#4180]Path of Exiles`. Alliances can only be related to alliances
on the same server, and a tag can only be used once per server. Servers are created first, then
alliances are added to them.

## Stack

- `server/` — Flask app: JSON API + serves the built frontend. Data lives in `data/alliances.json`.
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
make run                             # builds the frontend, starts http://localhost:5050
```

This uses `.venv/bin/python` directly, so the venv doesn't need to be activated. Without `make`
(e.g. on Windows), activate the venv and run `cd web && npm run build && cd ..` then
`python server/app.py`. Data persists in `data/alliances.json`.

To start over with no servers or alliances, run `make reset-data`. It asks for confirmation and keeps
a timestamped backup of the old data next to it.

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
| `ALLYGRAPH_DATA` | `data/alliances.json` | Path to the JSON data file  |

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

| Method | Path                    | Body / result                                                              |
| ------ | ----------------------- | -------------------------------------------------------------------------- |
| GET    | `/api/servers`          | List of servers                                                            |
| POST   | `/api/servers`          | `{number}` (4 digits) → `201` server, or `400 {errors}`                     |
| DELETE | `/api/servers/<number>` | `{deleted: [alliance ids]}` — deleting a server deletes all its alliances  |
| GET    | `/api/alliances`        | List of alliances                                                          |
| POST   | `/api/alliances`        | `{name, tag, server, type, rootId}` → `201` alliance, or `400 {errors}`     |
| DELETE | `/api/alliances/<id>`   | `{deleted: [ids]}` — deleting a root also deletes its members              |
