"""Upgrade every user's data file to the current format in one go.

The server also upgrades each file the first time it's loaded; this just does it up front and
reports what changed. Run via `make migrate`, which backs up the data first.
"""

import sys
from pathlib import Path

from app import DEFAULT_DATA_DIR, Store, _read_json, _upgrade


def main(data_dir):
    store = Store(data_dir)  # also imports a pre-multi-user data/alliances.json, if present
    paths = sorted(store.users_dir.glob("*.json")) if store.users_dir.is_dir() else []
    if not paths:
        print(f"No user data in {data_dir}; nothing to migrate.")
        return
    for path in paths:
        data = _read_json(path)
        name = data["user"]["name"]
        if _upgrade(data):
            store.save(data["user"]["id"], data)
            print(f"  migrated  {name}: {len(data['families'])} families, {len(data['alliances'])} alliances")
        else:
            print(f"  current   {name}")
    print("Done.")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DATA_DIR)
