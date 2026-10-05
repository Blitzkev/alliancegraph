import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteAlliance, deleteServer, getGraph, reorderAlliances } from "./api";
import {
  familyAcademies,
  familyLeader,
  familyMembers,
  formatAlliance,
  formatFamily,
  formatServer,
  sortByName,
  sortFamilies,
} from "./format";
import AllianceGraph from "./components/AllianceGraph";
import AllianceModal from "./components/AllianceModal";
import DetailPanel from "./components/DetailPanel";
import ServerModal from "./components/ServerModal";
import StrandedAcademiesDialog from "./components/StrandedAcademiesDialog";

const EMPTY = { servers: [], families: [], alliances: [] };

// The open kingdom tab is remembered per browser and user; storage may be unavailable, which is fine.
const tabKey = (userId) => `allygraph.kingdom.${userId}`;
const loadTab = (userId) => {
  try {
    return localStorage.getItem(tabKey(userId));
  } catch {
    return null;
  }
};
const saveTab = (userId, server) => {
  try {
    localStorage.setItem(tabKey(userId), server);
  } catch {
    // Not remembering the tab is fine.
  }
};
const COLLECTION = { alliance: "alliances", family: "families" };

export default function Workspace({ user, onSwitchUser }) {
  const [graph, setGraph] = useState(EMPTY);
  const [loadError, setLoadError] = useState(null);
  // modal: { kind: "server" | "alliance", id?: string (edit) } | null
  const [modal, setModal] = useState(null);
  const [strandedId, setStrandedId] = useState(null); // alliance whose deletion strands academies
  const [selected, setSelected] = useState(null); // { kind, id } shown in the side panel
  const [deleteKey, setDeleteKey] = useState("");
  const [deleteError, setDeleteError] = useState(null);
  const [tab, setTab] = useState(() => loadTab(user.id));

  // One change can ripple (families merging or disappearing), so after every change we reload it all.
  const refresh = useCallback(
    () =>
      getGraph(user.id)
        .then((g) => {
          setGraph(g);
          setLoadError(null);
        })
        .catch((err) => {
          // The user no longer exists on the server (e.g. data was reset): pick again.
          if (err.status === 404) onSwitchUser();
          else setLoadError("Could not load data from the server.");
        }),
    [user.id, onSwitchUser],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const { families, alliances } = graph;
  const servers = useMemo(() => graph.servers.map((s) => s.number).sort(), [graph.servers]);
  // The kingdom shown in the graph: the chosen tab if it still exists, else the first kingdom.
  const activeServer = servers.includes(tab) ? tab : (servers[0] ?? null);
  const openTab = (server) => {
    setTab(server);
    saveTab(user.id, server);
  };
  const find = (kind, id) => graph[COLLECTION[kind]].find((x) => x.id === id) || null;
  // Derived, so anything deleted elsewhere (or on another kingdom) closes its panel / editor.
  const selectedItem =
    selected && find(selected.kind, selected.id)?.server === activeServer ? selected : null;
  const editingItem = modal?.id ? find(modal.kind, modal.id) : null;
  const stranded = strandedId ? find("alliance", strandedId) : null;

  const afterChange = () => {
    setModal(null);
    setStrandedId(null);
    return refresh();
  };

  // Apply a new order right away so the graph doesn't jump back; undo it if saving fails.
  const handleReorder = async (ids) => {
    const previous = graph;
    const position = new Map(ids.map((id, i) => [id, i]));
    setGraph((g) => ({
      ...g,
      alliances: g.alliances.map((a) => (position.has(a.id) ? { ...a, position: position.get(a.id) } : a)),
    }));
    try {
      await reorderAlliances(user.id, ids);
    } catch {
      setGraph(previous);
      setLoadError("Could not save the new order. Please try again.");
    }
  };

  // Deleting a family's last member while it has academies asks what happens to them.
  const handleDeleteAlliance = async (alliance) => {
    const family = alliance.familyId;
    if (family && familyMembers(family, alliances).length === 1 && familyAcademies(family, alliances).length) {
      setModal(null);
      setStrandedId(alliance.id);
      return;
    }
    let message = `Delete ${formatAlliance(alliance)}?`;
    if (family && familyLeader(family, alliances)?.id === alliance.id && familyMembers(family, alliances).length > 1)
      message += "\n\nIt leads its family; the next strongest member will lead instead.";
    if (!window.confirm(message)) return;
    try {
      await deleteAlliance(user.id, alliance.id);
      setDeleteError(null);
      await afterChange();
    } catch (err) {
      setDeleteError(Object.values(err.errors).join(" "));
    }
  };

  // Delete dropdown values are "server:<number>" or "alliance:<id>".
  const handleDelete = async () => {
    const [kind, key] = deleteKey.split(/:(.*)/);
    setDeleteKey("");
    if (kind === "alliance") {
      const item = find("alliance", key);
      if (item) await handleDeleteAlliance(item);
      return;
    }
    const count = alliances.filter((a) => a.server === key).length;
    let message = `Delete ${formatServer(key)}?`;
    message += `\n\nThis also deletes its ${count} alliance(s).`;
    if (!window.confirm(message)) return;
    try {
      await deleteServer(user.id, key);
      setDeleteError(null);
      await afterChange();
    } catch (err) {
      setDeleteError(Object.values(err.errors).join(" "));
    }
  };

  // Group the delete dropdown by server, then family, so it's clear what falls under what.
  const deleteOptions = servers.map((server) => {
    const on = (items) => items.filter((x) => x.server === server);
    const option = (a, indent) => (
      <option key={a.id} value={`alliance:${a.id}`}>
        {indent ? "\u00a0\u00a0\u00a0" : ""}
        {formatAlliance(a)}
      </option>
    );
    return [
      <optgroup key={server} label={formatServer(server)}>
        <option value={`server:${server}`}>{formatServer(server)} (entire server)</option>
        {sortByName(on(alliances).filter((a) => !a.familyId && !a.academyOf)).map((a) => option(a, false))}
      </optgroup>,
      ...sortFamilies(on(families)).map((f) => (
        <optgroup key={f.id} label={`${formatServer(server)} · ${formatFamily(f.id, alliances)}`}>
          {sortByName(familyMembers(f.id, alliances)).map((a) => option(a, true))}
          {sortByName(familyAcademies(f.id, alliances)).map((a) => option(a, true))}
        </optgroup>
      )),
    ];
  });

  const openEdit = (alliance) => setModal({ kind: "alliance", id: alliance.id });

  return (
    <div className="app">
      <header className="app-header">
        <h1>AllyGraph</h1>
        <div className="current-user">
          <span>
            Graph of <strong>{user.name}</strong>
          </span>
          <button className="btn btn-secondary" onClick={onSwitchUser}>
            Switch user
          </button>
        </div>
      </header>

      <div className="toolbar">
        <section className="panel">
          <h2>Servers</h2>
          <div className="button-row">
            <button className="btn btn-server" onClick={() => setModal({ kind: "server" })}>
              Create Server/Kingdom
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Create</h2>
          <div className="button-row">
            <button className="btn btn-alliance" onClick={() => setModal({ kind: "alliance" })}>
              Alliance
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Delete</h2>
          <div className="button-row">
            <select
              value={deleteKey}
              onChange={(e) => setDeleteKey(e.target.value)}
              disabled={servers.length === 0}
            >
              <option value="">{servers.length ? "Select something to delete…" : "Nothing to delete yet"}</option>
              {deleteOptions}
            </select>
            <button className="btn btn-danger" onClick={handleDelete} disabled={!deleteKey}>
              Delete
            </button>
          </div>
          {deleteError && <p className="error">{deleteError}</p>}
        </section>
      </div>

      {loadError && <p className="error banner">{loadError}</p>}

      <main className="workspace">
        <div className="graph-column">
          {servers.length > 0 && (
            <nav className="tabs" role="tablist" aria-label="Kingdoms">
              {servers.map((server) => (
                <button
                  key={server}
                  role="tab"
                  aria-selected={server === activeServer}
                  className={`tab${server === activeServer ? " active" : ""}`}
                  onClick={() => openTab(server)}
                >
                  Kingdom {server}
                </button>
              ))}
            </nav>
          )}
          <div className="graph-panel">
            <AllianceGraph
              server={activeServer}
              families={families}
              alliances={alliances}
              selected={selectedItem}
              onSelect={setSelected}
              onReorder={handleReorder}
            />
          </div>
        </div>
        {selectedItem && (
          <DetailPanel
            selected={selectedItem}
            families={families}
            alliances={alliances}
            onSelect={setSelected}
            onEdit={openEdit}
            onClose={() => setSelected(null)}
          />
        )}
      </main>

      {modal?.kind === "server" && (
        <ServerModal
          userId={user.id}
          onSaved={(server) => {
            openTab(server.number);
            return afterChange();
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "alliance" && (!modal.id || editingItem) && (
        <AllianceModal
          key={modal.id ?? "new"}
          userId={user.id}
          alliance={editingItem}
          servers={servers}
          defaultServer={activeServer}
          families={families}
          alliances={alliances}
          onSaved={afterChange}
          onDelete={handleDeleteAlliance}
          onClose={() => setModal(null)}
        />
      )}
      {stranded && (
        <StrandedAcademiesDialog
          alliance={stranded}
          families={families}
          alliances={alliances}
          onConfirm={async (academies) => {
            await deleteAlliance(user.id, stranded.id, academies);
            await afterChange();
          }}
          onClose={() => setStrandedId(null)}
        />
      )}
    </div>
  );
}
