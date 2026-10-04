import { useEffect, useMemo, useState } from "react";
import { listAlliances, listServers, deleteAlliance, deleteServer, reorderAlliances } from "./api";
import { allianceDeleteMessage, formatAlliance, formatServer, TYPE_LABELS } from "./format";
import AllianceModal from "./components/AllianceModal";
import ServerModal from "./components/ServerModal";
import AllianceGraph from "./components/AllianceGraph";
import EditAllianceModal from "./components/EditAllianceModal";
import UmbrellaPanel from "./components/UmbrellaPanel";

export default function Workspace({ user, onSwitchUser }) {
  const [servers, setServers] = useState([]);
  const [alliances, setAlliances] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [modal, setModal] = useState(null); // "server" | alliance type | null
  const [deleteKey, setDeleteKey] = useState("");
  const [deleteError, setDeleteError] = useState(null);
  const [selectedRootId, setSelectedRootId] = useState(null);
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    Promise.all([listServers(user.id), listAlliances(user.id)])
      .then(([s, a]) => {
        setServers(s.map((x) => x.number));
        setAlliances(a);
      })
      .catch((err) => {
        // The user no longer exists on the server (e.g. data was reset): pick again.
        if (err.status === 404) onSwitchUser();
        else setLoadError("Could not load data from the server.");
      });
  }, [user.id, onSwitchUser]);

  const sortedServers = useMemo(() => [...servers].sort(), [servers]);
  const roots = alliances.filter((a) => a.type === "root");
  // Derived, so a deleted root closes its panel / an alliance deleted elsewhere closes its editor.
  const selectedRoot = roots.find((r) => r.id === selectedRootId) || null;
  const editing = alliances.find((a) => a.id === editingId) || null;

  const handleAllianceUpdated = (updated) => {
    setAlliances((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setEditingId(null);
  };

  // Apply the new order right away so the graph doesn't jump back; undo it if saving fails.
  const handleReorder = async (ids) => {
    const previous = alliances;
    const position = new Map(ids.map((id, i) => [id, i]));
    setAlliances((prev) =>
      prev.map((a) => (position.has(a.id) ? { ...a, position: position.get(a.id) } : a)),
    );
    try {
      await reorderAlliances(user.id, ids);
      setLoadError(null);
    } catch {
      setAlliances(previous);
      setLoadError("Could not save the new order. Please try again.");
    }
  };

  const handleAlliancesDeleted = (deleted) => {
    setAlliances((prev) => prev.filter((a) => !deleted.includes(a.id)));
    setEditingId(null);
  };

  const handleAllianceSaved = (alliance) => {
    setAlliances((prev) => [...prev, alliance]);
    setModal(null);
  };

  const handleServerSaved = (server) => {
    setServers((prev) => [...prev, server.number]);
    setModal(null);
  };

  // Delete dropdown values are "server:<number>" or "alliance:<id>".
  const handleDelete = async () => {
    const [kind, key] = deleteKey.split(/:(.*)/);
    let message, remove;
    if (kind === "server") {
      const count = alliances.filter((a) => a.server === key).length;
      message = `Delete ${formatServer(key)}?`;
      if (count) message += `\n\nThis will also delete its ${count} alliance(s).`;
      remove = () => deleteServer(user.id, key);
    } else {
      const target = alliances.find((a) => a.id === key);
      if (!target) return;
      message = allianceDeleteMessage(target, alliances);
      remove = () => deleteAlliance(user.id, key);
    }
    if (!window.confirm(message)) return;
    try {
      const { deleted } = await remove();
      setAlliances((prev) => prev.filter((a) => !deleted.includes(a.id)));
      if (kind === "server") setServers((prev) => prev.filter((s) => s !== key));
      setDeleteKey("");
      setDeleteError(null);
    } catch (err) {
      setDeleteError(Object.values(err.errors).join(" "));
    }
  };

  // Group the delete dropdown by server, then by root, so it's clear what falls under what.
  const deleteOptions = sortedServers.map((server) => (
    <optgroup key={server} label={formatServer(server)}>
      <option value={`server:${server}`}>{formatServer(server)} (entire server)</option>
      {roots
        .filter((r) => r.server === server)
        .flatMap((root) => [root, ...alliances.filter((a) => a.rootId === root.id)])
        .map((a) => (
          <option key={a.id} value={`alliance:${a.id}`}>
            {a.type === "root" ? "" : "   "}
            {formatAlliance(a)} ({TYPE_LABELS[a.type]})
          </option>
        ))}
    </optgroup>
  ));

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
            <button className="btn btn-server" onClick={() => setModal("server")}>
              Create Server/Kingdom
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Create New Alliance</h2>
          <div className="button-row">
            <button className="btn btn-root" onClick={() => setModal("root")}>
              Root Alliance
            </button>
            <button className="btn btn-family" onClick={() => setModal("family")}>
              Family Alliance
            </button>
            <button className="btn btn-academy" onClick={() => setModal("academy")}>
              Academy Alliance
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
              <option value="">
                {servers.length ? "Select a server or alliance…" : "Nothing to delete yet"}
              </option>
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
        <div className="graph-panel">
          <AllianceGraph
            servers={sortedServers}
            alliances={alliances}
            selectedUmbrella={selectedRoot?.id ?? null}
            onSelectUmbrella={setSelectedRootId}
            onReorder={handleReorder}
          />
        </div>
        {selectedRoot && (
          <UmbrellaPanel
            root={selectedRoot}
            alliances={alliances}
            onEdit={(a) => setEditingId(a.id)}
            onReorder={handleReorder}
            onClose={() => setSelectedRootId(null)}
          />
        )}
      </main>

      {modal === "server" && (
        <ServerModal userId={user.id} onSaved={handleServerSaved} onClose={() => setModal(null)} />
      )}
      {modal && modal !== "server" && (
        <AllianceModal
          userId={user.id}
          type={modal}
          servers={sortedServers}
          roots={roots}
          onSaved={handleAllianceSaved}
          onClose={() => setModal(null)}
        />
      )}
      {editing && (
        <EditAllianceModal
          key={editing.id}
          userId={user.id}
          alliance={editing}
          alliances={alliances}
          onSaved={handleAllianceUpdated}
          onDeleted={handleAlliancesDeleted}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
