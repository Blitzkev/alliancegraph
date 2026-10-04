# AllyGraph

A single-page site for tracking alliances and how they relate, drawn as an interactive D3 graph.

- **Root** alliances sit at the top of an umbrella.
- **Family** alliances are equal members under a root.
- **Academy** alliances are protected members under a root.

Each alliance is shown as `[#TAG][#SERVER]Name`, e.g. `[#G~4][#4180]Path of Exiles`.
A tag can only be used once per server.

## Stack

- `server/` — Flask app: JSON API + serves the built frontend. Data lives in `data/alliances.json`.
- `web/` — React + webpack + D3.

## Setup

```sh
/opt/homebrew/bin/python3 -m venv .venv
.venv/bin/pip install -r server/requirements.txt
cd web && npm install
```

## Run

```sh
cd web && npm run build && cd ..
.venv/bin/python server/app.py        # http://localhost:5050
```

For frontend development with live reload, run the Flask server as above and in another terminal:

```sh
cd web && npm run dev                 # http://localhost:8080, proxies /api to :5050
```

Set `ALLYGRAPH_DATA=/path/to/file.json` to use a different data file, or `PORT` to change the port.

## Tests

```sh
cd server && ../.venv/bin/pytest
```

## API

| Method | Path                   | Body / result                                                         |
| ------ | ---------------------- | --------------------------------------------------------------------- |
| GET    | `/api/alliances`       | List of alliances                                                     |
| POST   | `/api/alliances`       | `{name, tag, server, type, rootId}` → `201` alliance, or `400 {errors}` |
| DELETE | `/api/alliances/<id>`  | `{deleted: [ids]}` — deleting a root also deletes its members          |
