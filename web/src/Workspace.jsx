import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteAlliance, deleteServer, getGraph, reorderAlliances, reorderFamilies } from "./api";
import {
  allianceDeleteMessage,
  familyMembers,
  formatAlliance,
  formatServer,
  sortFamilies,
  strandsAcademies,
  TYPE_LABELS,
} from "./format";
import AllianceModal from "./components/AllianceModal";
import ServerModal from "./components/ServerModal";
import AllianceGraph from "./components/AllianceGraph";
import EditAllianceModal from "./components/EditAllianceModal";
import FamilyPanel from "./components/FamilyPanel";
import StrandedAcademiesDialog from "./components/StrandedAcademiesDialog";

const EMPTY = { servers: [], families: [], alliances: [] };

export default function Workspace({ user, onSwitchUser }) {
  const [graph, setGraph] = useState(EMPTY);
  const [loadError, setLoadError] = useState(null);
  const [modal, setModal] = useState(null); // "server" | alliance type | null
  const [deleteKey, setDeleteKey] = useState("");
  const [deleteError, setDeleteError] = useState(null);
  const [selectedFamilyId, setSelectedFamilyId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [strandedId, setStrandedId] = useState(null);

  // One change can ripple (root promotion, academies moving, empty families disappearing),
  // so after every change we simply reload the whole graph.
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
  // Derived, so anything deleted elsewhere closes its panel / editor / dialog.
  const selectedFamily = families.find((f) => f.id === selectedFamilyId) || null;
  const editing = alliances.find((a) => a.id === editingId) || null;
  const stranded = alliances.find((a) => a.id === strandedId) || null;

  // Apply a new order right away so the graph doesn't jump back; undo it if saving fails.
  const reorder = (collection, save) => async (ids) => {
    const previous = graph;
    const position = new Map(ids.map((id, i) => [id, i]));
    setGraph((g) => ({
      ...g,
      [collection]: g[collection].map((x) => (position.has(x.id) ? { ...x, position: position.get(x.id) } : x)),
    }));
    try {
      await save(user.id, ids);
    } catch {
      setGraph(previous);
      setLoadError("Could not save the new order. Please try again.");
    }
  };
  const handleReorder = reorder("alliances", reorderAlliances);
  const handleReorderFamilies = reorder("families", reorderFamilies);

  const afterChange = () => {
    setModal(null);
    setEditingId(null);
    setStrandedId(null);
    return refresh();
  };

  // Deleting a family's last family alliance while academies remain asks what to do with them.
  const requestDelete = async (alliance) => {
    if (strandsAcademies(alliance, alliances)) {
      setEditingId(null);
      setStrandedId(alliance.id);
      return;
    }
    if (!window.confirm(allianceDeleteMessage(alliance, alliances))) return;
    try {
      await deleteAlliance(user.id, alliance.id);
      await afterChange();
    } catch (err) {
      setDeleteError(Object.values(err.errors).join(" "));
    }
  };

  // Delete dropdown values are "server:<number>" or "alliance:<id>".
  const handleDelete = async () => {
    const [kind, key] = deleteKey.split(/:(.*)/);
    if (kind === "alliance") {
      const target = alliances.find((a) => a.id === key);
      setDeleteKey("");
      if (target) await requestDelete(target);
      return;
    }
    const count = alliances.filter((a) => a.server === key).length;
    let message = `Delete ${formatServer(key)}?`;
    if (count) message += `\n\nThis will also delete its ${count} alliance(s).`;
    if (!window.confirm(message)) return;
    try {
      await deleteServer(user.id, key);
      setDeleteKey("");
      setDeleteError(null);
      await afterChange();
    } catch (err) {
      setDeleteError(Object.values(err.errors).join(" "));
    }
  };

  // Group the delete dropdown by server, then family, so it's clear what falls under what.
  const deleteOptions = servers.map((server) => (
    <optgroup key={server} label={formatServer(server)}>
      <option value={`server:${server}`}>{formatServer(server)} (entire server)</option>
      {sortFamilies(
        families.filter((f) => f.server === server),
        alliances,
      ).flatMap((f) => {
        const { root, families: fams, academies } = familyMembers(f.id, alliances);
        return [root, ...fams, ...academies].filter(Boolean).map((a) => (
          <option key={a.id} value={`alliance:${a.id}`}>
            {a.isRoot ? "" : "   "}
            {formatAlliance(a)} ({a.isRoot ? "Root" : TYPE_LABELS[a.type]})
          </option>
        ));
      })}
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
            servers={servers}
            families={families}
            alliances={alliances}
            selectedFamily={selectedFamily?.id ?? null}
            onSelectFamily={setSelectedFamilyId}
            onReorder={handleReorder}
            onReorderFamilies={handleReorderFamilies}
          />
        </div>
        {selectedFamily && (
          <FamilyPanel
            family={selectedFamily}
            alliances={alliances}
            onEdit={(a) => setEditingId(a.id)}
            onReorder={handleReorder}
            onClose={() => setSelectedFamilyId(null)}
          />
        )}
      </main>

      {modal === "server" && (
        <ServerModal userId={user.id} onSaved={afterChange} onClose={() => setModal(null)} />
      )}
      {modal && modal !== "server" && (
        <AllianceModal
          userId={user.id}
          type={modal}
          servers={servers}
          families={families}
          alliances={alliances}
          onSaved={afterChange}
          onClose={() => setModal(null)}
        />
      )}
      {editing && (
        <EditAllianceModal
          key={editing.id}
          userId={user.id}
          alliance={editing}
          families={families}
          alliances={alliances}
          onSaved={afterChange}
          onRequestDelete={requestDelete}
          onClose={() => setEditingId(null)}
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

