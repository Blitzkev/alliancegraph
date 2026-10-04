import { useEffect, useState } from "react";
import { formatAlliance, formatFamily, sortFamilies } from "../format";

// Shown when deleting a family's last family alliance while it still has academies:
// the academies must move to another family on the server, or be deleted too.
export default function StrandedAcademiesDialog({ alliance, families, alliances, onConfirm, onClose }) {
  const academies = alliances.filter((a) => a.familyId === alliance.familyId && a.type === "academy");
  const destinations = sortFamilies(
    families.filter((f) => f.server === alliance.server && f.id !== alliance.familyId),
    alliances,
  );
  const [choice, setChoice] = useState(destinations.length ? "move" : "delete");
  const [moveTo, setMoveTo] = useState(destinations[0]?.id ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onConfirm(choice === "move" ? { moveTo } : "delete");
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
          It's the last family alliance in its family, which still has {academies.length} academy
          alliance{academies.length === 1 ? "" : "s"}:
        </p>
        <ul className="stranded-list">
          {academies.map((a) => (
            <li key={a.id} className="type-academy">
              {formatAlliance(a)}
            </li>
          ))}
        </ul>
        <fieldset className="choice-list">
          <legend>What should happen to {academies.length === 1 ? "it" : "them"}?</legend>
          <label className="radio">
            <input
              type="radio"
              checked={choice === "move"}
              onChange={() => setChoice("move")}
              disabled={!destinations.length}
            />
            Move to another family
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
          {!destinations.length && (
            <small className="indented">No other family on this server to move them to.</small>
          )}
          <label className="radio">
            <input type="radio" checked={choice === "delete"} onChange={() => setChoice("delete")} />
            Delete {academies.length === 1 ? "it" : "them"} too
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
