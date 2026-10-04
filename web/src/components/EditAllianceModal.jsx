import { useEffect, useState } from "react";
import { deleteAlliance, updateAlliance } from "../api";
import { allianceDeleteMessage, charLength, formatAlliance, formatServer, TYPE_LABELS } from "../format";
import NotesField, { notesError } from "./NotesField";

export default function EditAllianceModal({ userId, alliance, alliances, onSaved, onDeleted, onClose }) {
  const isRoot = alliance.type === "root";
  // Members can only belong to a root on their own server.
  const serverRoots = alliances.filter((a) => a.type === "root" && a.server === alliance.server);

  const [fields, setFields] = useState({
    name: alliance.name,
    tag: alliance.tag,
    type: alliance.type,
    rootId: alliance.rootId || "",
    notes: alliance.notes ?? "",
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const found = {};
    const n = charLength(fields.name.trim());
    const t = charLength(fields.tag.trim());
    if (n === 0) found.name = "Name is required.";
    else if (n > 256) found.name = "Name must be at most 256 characters.";
    if (t === 0) found.tag = "Tag is required.";
    else if (t > 4) found.tag = "Tag must be 1-4 characters.";
    if (!isRoot && !fields.rootId) found.rootId = "Select a root alliance.";
    const notesProblem = notesError(fields.notes);
    if (notesProblem) found.notes = notesProblem;
    setErrors(found);
    if (Object.keys(found).length) return;

    setBusy(true);
    try {
      const body = { name: fields.name, tag: fields.tag, notes: fields.notes };
      if (!isRoot) Object.assign(body, { type: fields.type, rootId: fields.rootId });
      onSaved(await updateAlliance(userId, alliance.id, body));
    } catch (err) {
      setErrors(err.errors);
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(allianceDeleteMessage(alliance, alliances))) return;
    setBusy(true);
    try {
      const { deleted } = await deleteAlliance(userId, alliance.id);
      onDeleted(deleted);
    } catch (err) {
      setErrors(err.errors);
      setBusy(false);
    }
  };

  const preview = formatAlliance({
    name: fields.name.trim(),
    tag: fields.tag.trim(),
    server: alliance.server,
  });

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className={`modal modal-${fields.type}`} onSubmit={handleSubmit} noValidate>
        <h2>Edit {TYPE_LABELS[fields.type]} Alliance</h2>

        <p className="modal-note">
          {formatServer(alliance.server)} <small>(an alliance's server can't be changed)</small>
        </p>

        {!isRoot && (
          <>
            <fieldset className="type-choice">
              <legend>Type</legend>
              {["family", "academy"].map((t) => (
                <label key={t} className={`radio type-${t}`}>
                  <input
                    type="radio"
                    name="type"
                    value={t}
                    checked={fields.type === t}
                    onChange={set("type")}
                  />
                  {TYPE_LABELS[t]}
                </label>
              ))}
            </fieldset>

            <label>
              Root alliance
              <select value={fields.rootId} onChange={set("rootId")}>
                <option value="">Select a root alliance…</option>
                {serverRoots.map((r) => (
                  <option key={r.id} value={r.id}>
                    {formatAlliance(r)}
                  </option>
                ))}
              </select>
              {errors.rootId && <span className="error">{errors.rootId}</span>}
            </label>
          </>
        )}

        <label>
          Name <small>(max 256 characters)</small>
          <input value={fields.name} onChange={set("name")} autoFocus />
          {errors.name && <span className="error">{errors.name}</span>}
        </label>

        <label>
          Tag <small>(1-4 characters)</small>
          <input value={fields.tag} onChange={set("tag")} />
          {errors.tag && <span className="error">{errors.tag}</span>}
        </label>

        <NotesField
          value={fields.notes}
          onChange={(notes) => setFields((f) => ({ ...f, notes }))}
          error={errors.notes}
        />

        <p className="preview">{preview}</p>
        {(errors._ || errors.type) && <p className="error">{errors._ || errors.type}</p>}

        <div className="modal-actions">
          <button type="button" className="btn btn-danger push-left" onClick={handleDelete} disabled={busy}>
            Delete
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
