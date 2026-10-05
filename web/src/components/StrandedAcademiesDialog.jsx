import { useEffect, useState } from "react";
import { familyAcademies, formatAlliance, formatFamily, sortFamilies } from "../format";

// Shown when deleting a family's last member while the family still has academies: they move to
// another family on the server, become independent, or are deleted too.
export default function StrandedAcademiesDialog({ alliance, families, alliances, onConfirm, onClose }) {
  const academies = familyAcademies(alliance.familyId, alliances);
  const destinations = sortFamilies(
    families.filter((f) => f.server === alliance.server && f.id !== alliance.familyId),
  );
  const [choice, setChoice] = useState(destinations.length ? "move" : "detach");
  const [moveTo, setMoveTo] = useState(destinations[0]?.id ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const them = academies.length === 1 ? "it" : "them";

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onConfirm(choice === "move" ? { moveTo } : choice);
    } catch (err) {
      setError(Object.values(err.errors).join(" "));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal modal-danger" onSubmit={handleSubmit} noValidate>
        <h2>Delete {formatAlliance(alliance)}?</h2>
        <p>
          It's the last member of its family, which has {academies.length} academy alliance
          {academies.length === 1 ? "" : "s"}:
        </p>
        <ul className="stranded-list">
          {academies.map((a) => (
            <li key={a.id} className="type-academy">
              {formatAlliance(a)}
            </li>
          ))}
        </ul>
        <fieldset className="choice-list">
          <legend>What should happen to {them}?</legend>
          <label className="radio">
            <input
              type="radio"
              checked={choice === "move"}
              onChange={() => setChoice("move")}
              disabled={!destinations.length}
            />
            Make {them} an academy of another family
          </label>
          {choice === "move" && (
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="indented">
              {destinations.map((f) => (
                <option key={f.id} value={f.id}>
                  {formatFamily(f.id, alliances)}
                </option>
              ))}
            </select>
          )}
          {!destinations.length && <small className="indented">No other family on this server.</small>}
          <label className="radio">
            <input type="radio" checked={choice === "detach"} onChange={() => setChoice("detach")} />
            Make {them} independent
          </label>
          <label className="radio">
            <input type="radio" checked={choice === "delete"} onChange={() => setChoice("delete")} />
            Delete {them} too
          </label>
        </fieldset>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy || (choice === "move" && !moveTo)}>
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </form>
    </div>
  );
}
