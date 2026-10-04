import { useEffect, useState } from "react";
import { createAlliance } from "../api";
import { charLength, formatAlliance, formatServer, TYPE_LABELS } from "../format";
import NotesField, { notesError } from "./NotesField";

function validate({ name, tag, notes }, server, needsRoot, rootId) {
  const errors = {};
  const n = charLength(name.trim());
  const t = charLength(tag.trim());
  if (n === 0) errors.name = "Name is required.";
  else if (n > 256) errors.name = "Name must be at most 256 characters.";
  if (t === 0) errors.tag = "Tag is required.";
  else if (t > 4) errors.tag = "Tag must be 1-4 characters.";
  if (!server) errors.server = "Select a server.";
  if (needsRoot && !rootId) errors.rootId = "Select a root alliance.";
  const notesProblem = notesError(notes);
  if (notesProblem) errors.notes = notesProblem;
  return errors;
}

export default function AllianceModal({ userId, type, servers, roots, onSaved, onClose }) {
  const needsRoot = type !== "root";
  const blocker =
    servers.length === 0
      ? "A Server/Kingdom must exist before you can create an alliance."
      : needsRoot && roots.length === 0
        ? `A Root Alliance must exist before you can create a ${TYPE_LABELS[type]} Alliance.`
        : null;

  const [fields, setFields] = useState({ name: "", tag: "", notes: "" });
  const [server, setServer] = useState(servers.length === 1 ? servers[0] : "");
  const [rootId, setRootId] = useState("");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // Alliances can only be related on the same server.
  const serverRoots = roots.filter((r) => r.server === server);
  const noRootsOnServer = needsRoot && server && serverRoots.length === 0;

  useEffect(() => {
    setRootId(serverRoots.length === 1 ? serverRoots[0].id : "");
  }, [server]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const found = validate(fields, server, needsRoot, rootId);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const saved = await createAlliance(userId, {
        ...fields,
        server,
        type,
        rootId: needsRoot ? rootId : null,
      });
      onSaved(saved);
    } catch (err) {
      setErrors(err.errors);
      setSaving(false);
    }
  };

  const preview =
    fields.name || fields.tag
      ? formatAlliance({ name: fields.name.trim(), tag: fields.tag.trim(), server: server || "????" })
      : null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className={`modal modal-${type}`} onSubmit={handleSubmit} noValidate>
        <h2>New {TYPE_LABELS[type]} Alliance</h2>

        {blocker ? (
          <p className="error banner">{blocker}</p>
        ) : (
          <>
            <label>
              Server/Kingdom
              <select value={server} onChange={(e) => setServer(e.target.value)} autoFocus>
                <option value="">Select a server…</option>
                {servers.map((s) => (
                  <option key={s} value={s}>
                    {formatServer(s)}
                  </option>
                ))}
              </select>
              {errors.server && <span className="error">{errors.server}</span>}
            </label>

            {needsRoot && (
              <label>
                Root alliance
                <select
                  value={rootId}
                  onChange={(e) => setRootId(e.target.value)}
                  disabled={!server || noRootsOnServer}
                >
                  <option value="">
                    {server ? "Select a root alliance…" : "Select a server first"}
                  </option>
                  {serverRoots.map((r) => (
                    <option key={r.id} value={r.id}>
                      {formatAlliance(r)}
                    </option>
                  ))}
                </select>
                {noRootsOnServer && (
                  <span className="error">
                    {formatServer(server)} has no root alliances. Create one there first.
                  </span>
                )}
                {errors.rootId && <span className="error">{errors.rootId}</span>}
              </label>
            )}

            <label>
              Name <small>(max 256 characters)</small>
              <input value={fields.name} onChange={set("name")} />
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

            {preview && <p className="preview">{preview}</p>}
            {errors._ && <p className="error">{errors._}</p>}
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={Boolean(blocker) || noRootsOnServer || saving}
          >
            {saving ? "Saving…" : "Save Alliance"}
          </button>
        </div>
      </form>
    </div>
  );
}
