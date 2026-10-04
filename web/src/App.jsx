import { useEffect, useState } from "react";
import { listAlliances, deleteAlliance } from "./api";
import { formatAlliance, TYPE_LABELS } from "./format";
import AllianceModal from "./components/AllianceModal";
import AllianceGraph from "./components/AllianceGraph";

export default function App() {
  const [alliances, setAlliances] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [modalType, setModalType] = useState(null);
  const [deleteId, setDeleteId] = useState("");
  const [deleteError, setDeleteError] = useState(null);

  useEffect(() => {
    listAlliances()
      .then(setAlliances)
      .catch(() => setLoadError("Could not load alliances from the server."));
  }, []);

  const roots = alliances.filter((a) => a.type === "root");

  const handleSaved = (alliance) => {
    setAlliances((prev) => [...prev, alliance]);
    setModalType(null);
  };

  const handleDelete = async () => {
    const target = alliances.find((a) => a.id === deleteId);
    if (!target) return;
    const children = alliances.filter((a) => a.rootId === target.id);
    const warning = children.length
      ? `\n\nThis will also delete its ${children.length} family/academy alliance(s).`
      : "";
    if (!window.confirm(`Delete ${formatAlliance(target)}?${warning}`)) return;
    try {
      const { deleted } = await deleteAlliance(target.id);
      setAlliances((prev) => prev.filter((a) => !deleted.includes(a.id)));
      setDeleteId("");
      setDeleteError(null);
    } catch (err) {
      setDeleteError(Object.values(err.errors).join(" "));
    }
  };

  // Group the delete dropdown by root so it's clear what falls under what.
  const deleteOptions = roots.map((root) => (
    <optgroup key={root.id} label={formatAlliance(root)}>
      <option value={root.id}>{formatAlliance(root)} (Root)</option>
      {alliances
        .filter((a) => a.rootId === root.id)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {formatAlliance(a)} ({TYPE_LABELS[a.type]})
          </option>
        ))}
    </optgroup>
  ));

  return (
    <div className="app">
      <header className="app-header">
        <h1>AllyGraph</h1>
      </header>

      <div className="toolbar">
        <section className="panel">
          <h2>Create New Alliance</h2>
          <div className="button-row">
            <button className="btn btn-root" onClick={() => setModalType("root")}>
              Root Alliance
            </button>
            <button className="btn btn-family" onClick={() => setModalType("family")}>
              Family Alliance
            </button>
            <button className="btn btn-academy" onClick={() => setModalType("academy")}>
              Academy Alliance
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Delete Alliance</h2>
          <div className="button-row">
            <select
              value={deleteId}
              onChange={(e) => setDeleteId(e.target.value)}
              disabled={alliances.length === 0}
            >
              <option value="">
                {alliances.length ? "Select an alliance…" : "No alliances yet"}
              </option>
              {deleteOptions}
            </select>
            <button className="btn btn-danger" onClick={handleDelete} disabled={!deleteId}>
              Delete
            </button>
          </div>
          {deleteError && <p className="error">{deleteError}</p>}
        </section>
      </div>

      {loadError && <p className="error banner">{loadError}</p>}

      <main className="graph-panel">
        <AllianceGraph alliances={alliances} />
      </main>

      {modalType && (
        <AllianceModal
          type={modalType}
          roots={roots}
          onSaved={handleSaved}
          onClose={() => setModalType(null)}
        />
      )}
    </div>
  );
}
