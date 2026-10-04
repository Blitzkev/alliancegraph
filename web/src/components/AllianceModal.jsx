import { useEffect, useState } from "react";
import { createAlliance } from "../api";
import { charLength, formatAlliance, TYPE_LABELS } from "../format";

function validate({ name, tag, server }, needsRoot, rootId) {
  const errors = {};
  const n = charLength(name.trim());
  const t = charLength(tag.trim());
  if (n === 0) errors.name = "Name is required.";
  else if (n > 256) errors.name = "Name must be at most 256 characters.";
  if (t === 0) errors.tag = "Tag is required.";
  else if (t > 4) errors.tag = "Tag must be 1-4 characters.";
  if (!/^[0-9]{4}$/.test(server.trim())) errors.server = "Server must be exactly 4 digits (e.g. 0042).";
  if (needsRoot && !rootId) errors.rootId = "Select a root alliance.";
  return errors;
}

export default function AllianceModal({ type, roots, onSaved, onClose }) {
  const needsRoot = type !== "root";
  const noRoots = needsRoot && roots.length === 0;

  const [fields, setFields] = useState({ name: "", tag: "", server: "" });
  const [rootId, setRootId] = useState(roots.length === 1 ? roots[0].id : "");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const found = validate(fields, needsRoot, rootId);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const saved = await createAlliance({
        ...fields,
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
    fields.name || fields.tag || fields.server
      ? formatAlliance({ name: fields.name.trim(), tag: fields.tag.trim(), server: fields.server.trim() })
      : null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className={`modal modal-${type}`} onSubmit={handleSubmit} noValidate>
        <h2>New {TYPE_LABELS[type]} Alliance</h2>

        {noRoots ? (
          <p className="error banner">
            A Root Alliance must exist before you can create a {TYPE_LABELS[type]} Alliance.
          </p>
        ) : (
          <>
            {needsRoot && (
              <label>
                Root alliance
                <select value={rootId} onChange={(e) => setRootId(e.target.value)} autoFocus>
                  <option value="">Select a root alliance…</option>
                  {roots.map((r) => (
                    <option key={r.id} value={r.id}>
                      {formatAlliance(r)}
                    </option>
                  ))}
                </select>
                {errors.rootId && <span className="error">{errors.rootId}</span>}
              </label>
            )}

            <label>
              Name <small>(max 256 characters)</small>
              <input value={fields.name} onChange={set("name")} autoFocus={!needsRoot} />
              {errors.name && <span className="error">{errors.name}</span>}
            </label>

            <div className="field-row">
              <label>
                Tag <small>(1-4 characters)</small>
                <input value={fields.tag} onChange={set("tag")} />
                {errors.tag && <span className="error">{errors.tag}</span>}
              </label>
              <label>
                Server <small>(4 digits)</small>
                <input
                  value={fields.server}
                  onChange={set("server")}
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="0000"
                />
                {errors.server && <span className="error">{errors.server}</span>}
              </label>
            </div>

            {preview && <p className="preview">{preview}</p>}
            {errors._ && <p className="error">{errors._}</p>}
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={noRoots || saving}>
            {saving ? "Saving…" : "Save Alliance"}
          </button>
        </div>
      </form>
    </div>
  );
}
