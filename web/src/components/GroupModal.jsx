import { useEffect, useState } from "react";
import { createItem, updateItem } from "../api";
import { byPower, charLength, formatAlliance, formatServer, GROUP, membersOf, sortByName } from "../format";

// Create (no `group`) or edit a family or academy. Members are chosen from the alliance side.
export default function GroupModal({
  userId,
  kind,
  group,
  servers,
  families,
  alliances,
  onSaved,
  onDelete,
  onClose,
}) {
  const { label, collection } = GROUP[kind];
  const editing = Boolean(group);
  const [server, setServer] = useState(group?.server ?? (servers.length === 1 ? servers[0] : ""));
  const [name, setName] = useState(group?.name ?? "");
  const [rootId, setRootId] = useState(group?.rootId ?? "");
  const [familyIds, setFamilyIds] = useState(group?.familyIds ?? []);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const members = editing ? [...membersOf(kind, group.id, alliances)].sort(byPower) : [];
  const serverFamilies = sortByName(families.filter((f) => f.server === server));

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const found = {};
    const n = charLength(name.trim());
    if (n === 0) found.name = "Name is required.";
    else if (n > 256) found.name = "Name must be at most 256 characters.";
    if (!server) found.server = "Select a server.";
    setErrors(found);
    if (Object.keys(found).length) return;

    setBusy(true);
    const body = { name, server };
    if (kind === "family" && editing) body.rootId = rootId || null;
    if (kind === "academy") body.familyIds = familyIds;
    try {
      if (editing) await updateItem(userId, collection, group.id, body);
      else await createItem(userId, collection, body);
      onSaved();
    } catch (err) {
      setErrors(err.errors);
      setBusy(false);
    }
  };

  const toggleFamily = (id) =>
    setFamilyIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const blocker = servers.length === 0 ? `A Server/Kingdom must exist before you can create a ${label.toLowerCase()}.` : null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className={`modal modal-${kind}`} onSubmit={handleSubmit} noValidate>
        <h2>
          {editing ? "Edit" : "New"} {label}
        </h2>

        {blocker ? (
          <p className="error banner">{blocker}</p>
        ) : (
          <>
            {editing ? (
              <p className="modal-note">
                {formatServer(server)} <small>(a {label.toLowerCase()}'s server can't be changed)</small>
              </p>
            ) : (
              <label>
                Server/Kingdom
                <select
                  value={server}
                  onChange={(e) => {
                    setServer(e.target.value);
                    setFamilyIds([]);
                  }}
                >
                  <option value="">Select a server…</option>
                  {servers.map((s) => (
                    <option key={s} value={s}>
                      {formatServer(s)}
                    </option>
                  ))}
                </select>
                {errors.server && <span className="error">{errors.server}</span>}
              </label>
            )}

            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              {errors.name && <span className="error">{errors.name}</span>}
            </label>

            {kind === "family" && editing && (
              <label>
                Root alliance
                {members.length ? (
                  <select value={rootId} onChange={(e) => setRootId(e.target.value)}>
                    {members.map((a) => (
                      <option key={a.id} value={a.id}>
                        {formatAlliance(a)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <small>Add alliances to this family (from an alliance's edit form) to pick a root.</small>
                )}
                {errors.rootId && <span className="error">{errors.rootId}</span>}
              </label>
            )}

            {kind === "academy" && server && (
              <fieldset className="group-checklist type-family">
                <legend>
                  Protected by families <small>({familyIds.length} selected)</small>
                </legend>
                {serverFamilies.length === 0 ? (
                  <p className="muted">No families on this server yet.</p>
                ) : (
                  serverFamilies.map((f) => (
                    <label key={f.id} className="checkbox">
                      <input type="checkbox" checked={familyIds.includes(f.id)} onChange={() => toggleFamily(f.id)} />
                      <span>{f.name}</span>
                    </label>
                  ))
                )}
                {errors.familyIds && <span className="error">{errors.familyIds}</span>}
              </fieldset>
            )}

            {!editing && (
              <p className="muted">
                Add alliances to this {label.toLowerCase()} from each alliance's create or edit form.
              </p>
            )}
            {errors._ && <p className="error">{errors._}</p>}
          </>
        )}

        <div className="modal-actions">
          {editing && (
            <button type="button" className="btn btn-danger push-left" onClick={() => onDelete(kind, group)} disabled={busy}>
              Delete
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={Boolean(blocker) || busy}>
            {busy ? "Saving…" : editing ? "Save Changes" : `Save ${label}`}
          </button>
        </div>
      </form>
    </div>
  );
}
