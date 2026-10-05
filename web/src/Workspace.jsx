import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteItem, deleteServer, getGraph, reorderAlliances } from "./api";
import { formatAlliance, formatServer, GROUP, membersOf, rootOf, sortByName } from "./format";
import AllianceGraph from "./components/AllianceGraph";
import AllianceModal from "./components/AllianceModal";
import DetailPanel from "./components/DetailPanel";
import GroupModal from "./components/GroupModal";
import ServerModal from "./components/ServerModal";

const EMPTY = { servers: [], families: [], academies: [], alliances: [] };

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
const COLLECTION = { alliance: "alliances", family: "families", academy: "academies" };

export default function Workspace({ user, onSwitchUser }) {
  const [graph, setGraph] = useState(EMPTY);
  const [loadError, setLoadError] = useState(null);
  // modal: { kind: "server" | "alliance" | "family" | "academy", id?: string (edit) } | null
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null); // { kind, id } shown in the side panel
  const [deleteKey, setDeleteKey] = useState("");
  const [deleteError, setDeleteError] = useState(null);
  const [tab, setTab] = useState(() => loadTab(user.id));

  // One change can ripple (roots promoted, links removed), so after every change we reload it all.
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

  const { families, academies, alliances } = graph;
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

  const afterChange = () => {
    setModal(null);
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

  const deleteMessage = (kind, item) => {
    if (kind === "alliance") {
      const roots = rootOf(item, families);
      let message = `Delete ${formatAlliance(item)}?`;
      if (roots.length)
        message += `\n\nIt's the root of ${roots.map((f) => f.name).join(", ")}; the strongest remaining member will take over.`;
      return message;
    }
    const count = membersOf(kind, item.id, alliances).length;
    return `Delete ${GROUP[kind].label.toLowerCase()} "${item.name}"?${count ? `\n\nIts ${count} alliance(s) are kept.` : ""}`;
  };

  const handleDeleteItem = async (kind, item) => {
    if (!window.confirm(deleteMessage(kind, item))) return;
    try {
      await deleteItem(user.id, COLLECTION[kind], item.id);
      setDeleteError(null);
      await afterChange();
    } catch (err) {
      setDeleteError(Object.values(err.errors).join(" "));
    }
  };

  // Delete dropdown values are "<kind>:<id>", with kind server | family | academy | alliance.
  const handleDelete = async () => {
    const [kind, key] = deleteKey.split(/:(.*)/);
    setDeleteKey("");
    if (kind !== "server") {
      const item = find(kind, key);
      if (item) await handleDeleteItem(kind, item);
      return;
    }
    const count = alliances.filter((a) => a.server === key).length;
    let message = `Delete ${formatServer(key)}?`;
    message += `\n\nThis also deletes its families, academies and ${count} alliance(s).`;
    if (!window.confirm(message)) return;
    try {
      await deleteServer(user.id, key);
      setDeleteError(null);
      await afterChange();
    } catch (err) {
      setDeleteError(Object.values(err.errors).join(" "));
    }
  };

  const optionsFor = (kind, items, label) =>
    sortByName(items).map((x) => (
      <option key={x.id} value={`${kind}:${x.id}`}>
        {"   "}
        {label(x)}
      </option>
    ));
  const deleteOptions = servers.map((server) => {
    const on = (items) => items.filter((x) => x.server === server);
    return (
      <optgroup key={server} label={formatServer(server)}>
        <option value={`server:${server}`}>{formatServer(server)} (entire server)</option>
        {optionsFor("family", on(families), (f) => `Family: ${f.name}`)}
        {optionsFor("academy", on(academies), (a) => `Academy: ${a.name}`)}
        {optionsFor("alliance", on(alliances), formatAlliance)}
      </optgroup>
    );
  });

  const openEdit = (kind, item) => setModal({ kind, id: item.id });

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
            <button className="btn btn-family" onClick={() => setModal({ kind: "family" })}>
              Family
            </button>
            <button className="btn btn-academy" onClick={() => setModal({ kind: "academy" })}>
              Academy
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
              academies={academies}
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
            academies={academies}
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
          academies={academies}
          onSaved={afterChange}
          onDelete={(a) => handleDeleteItem("alliance", a)}
          onClose={() => setModal(null)}
        />
      )}
      {(modal?.kind === "family" || modal?.kind === "academy") && (!modal.id || editingItem) && (
        <GroupModal
          key={modal.id ?? `new-${modal.kind}`}
          userId={user.id}
          kind={modal.kind}
          group={editingItem}
          servers={servers}
          defaultServer={activeServer}
          families={families}
          alliances={alliances}
          onSaved={afterChange}
          onDelete={handleDeleteItem}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
