import { useEffect, useState } from "react";
import { createItem, updateItem } from "../api";
import {
  charLength,
  formatAlliance,
  formatPower,
  formatServer,
  GROUP,
  parsePower,
  sortByName,
} from "../format";
import NotesField, { notesError } from "./NotesField";
import PowerField, { powerError } from "./PowerField";

// Pick any number of a server's families or academies. `disabledIds` are shown but can't be picked.
function GroupChecklist({ kind, title, groups, selected, onChange, rootIds = [], disabledIds = [], disabledNote, error }) {
  const { plural, label } = GROUP[kind];
  const toggle = (id) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <fieldset className={`group-checklist type-${kind}`}>
      <legend>
        {title ?? plural} <small>({selected.length} selected)</small>
      </legend>
      {groups.length === 0 ? (
        <p className="muted">No {plural.toLowerCase()} on this server yet. Create one with “{label}”.</p>
      ) : (
        groups.map((g) => (
          <label key={g.id} className={`checkbox${disabledIds.includes(g.id) ? " disabled" : ""}`}>
            <input
              type="checkbox"
              checked={selected.includes(g.id)}
              onChange={() => toggle(g.id)}
              disabled={disabledIds.includes(g.id)}
            />
            <span>
              {g.name}
              {rootIds.includes(g.id) && <span className="root-badge">Root</span>}
              {disabledIds.includes(g.id) && <small> ({disabledNote})</small>}
            </span>
          </label>
        ))
      )}
      {error && <span className="error">{error}</span>}
    </fieldset>
  );
}

// Create (no `alliance`) or edit an alliance.
export default function AllianceModal({
  userId,
  alliance,
  servers,
  defaultServer,
  families,
  academies,
  onSaved,
  onDelete,
  onClose,
}) {
  const editing = Boolean(alliance);
  const [server, setServer] = useState(alliance?.server ?? defaultServer ?? "");
  const [fields, setFields] = useState({
    name: alliance?.name ?? "",
    tag: alliance?.tag ?? "",
    power: alliance ? formatPower(alliance.power) : "",
    notes: alliance?.notes ?? "",
    familyIds: alliance?.familyIds ?? [],
    academyIds: alliance?.academyIds ?? [],
    alliedFamilyIds: alliance?.alliedFamilyIds ?? [],
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  // Groups only ever contain alliances from their own server.
  const serverFamilies = sortByName(families.filter((f) => f.server === server));
  const serverAcademies = sortByName(academies.filter((a) => a.server === server));
  const rootIds = editing ? families.filter((f) => f.rootId === alliance.id).map((f) => f.id) : [];

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setField = (key) => (value) => setFields((f) => ({ ...f, [key]: value }));
  const changeServer = (value) => {
    setServer(value);
    setFields((f) => ({ ...f, familyIds: [], academyIds: [], alliedFamilyIds: [] }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const found = {};
    const n = charLength(fields.name.trim());
    const t = charLength(fields.tag.trim());
    if (n === 0) found.name = "Name is required.";
    else if (n > 256) found.name = "Name must be at most 256 characters.";
    if (t === 0) found.tag = "Tag is required.";
    else if (t > 4) found.tag = "Tag must be 1-4 characters.";
    if (!server) found.server = "Select a server.";
    const powerProblem = powerError(fields.power);
    if (powerProblem) found.power = powerProblem;
    const notesProblem = notesError(fields.notes);
    if (notesProblem) found.notes = notesProblem;
    setErrors(found);
    if (Object.keys(found).length) return;

    setBusy(true);
    const body = { ...fields, power: parsePower(fields.power), server };
    try {
      if (editing) await updateItem(userId, "alliances", alliance.id, body);
      else await createItem(userId, "alliances", body);
      onSaved();
    } catch (err) {
      setErrors(err.errors);
      setBusy(false);
    }
  };

  const blocker = servers.length === 0 ? "A Server/Kingdom must exist before you can create an alliance." : null;
  const preview =
    fields.name || fields.tag
      ? formatAlliance({ name: fields.name.trim(), tag: fields.tag.trim(), server: server || "????" })
      : null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal modal-alliance" onSubmit={handleSubmit} noValidate>
        <h2>
          {editing ? "Edit Alliance" : "New Alliance"}
          {rootIds.length > 0 && <span className="root-badge">Root</span>}
        </h2>

        {blocker ? (
          <p className="error banner">{blocker}</p>
        ) : (
          <>
            {editing ? (
              <p className="modal-note">
                {formatServer(server)} <small>(an alliance's server can't be changed)</small>
              </p>
            ) : (
              <label>
                Server/Kingdom
                <select value={server} onChange={(e) => changeServer(e.target.value)} autoFocus>
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
              Name <small>(max 256 characters)</small>
              <input value={fields.name} onChange={(e) => setField("name")(e.target.value)} autoFocus={editing} />
              {errors.name && <span className="error">{errors.name}</span>}
            </label>

            <label>
              Tag <small>(1-4 characters)</small>
              <input value={fields.tag} onChange={(e) => setField("tag")(e.target.value)} />
              {errors.tag && <span className="error">{errors.tag}</span>}
            </label>

            <PowerField value={fields.power} onChange={setField("power")} error={errors.power} />

            {server && (
              <>
                <GroupChecklist
                  kind="family"
                  title="Member of families"
                  groups={serverFamilies}
                  selected={fields.familyIds}
                  // Joining a family replaces being allied with it.
                  onChange={(ids) =>
                    setFields((f) => ({
                      ...f,
                      familyIds: ids,
                      alliedFamilyIds: f.alliedFamilyIds.filter((id) => !ids.includes(id)),
                    }))
                  }
                  rootIds={rootIds}
                  error={errors.familyIds}
                />
                <GroupChecklist
                  kind="family"
                  title="Allied with families"
                  groups={serverFamilies}
                  selected={fields.alliedFamilyIds}
                  onChange={setField("alliedFamilyIds")}
                  disabledIds={fields.familyIds}
                  disabledNote="member"
                  error={errors.alliedFamilyIds}
                />
                <GroupChecklist
                  kind="academy"
                  title="Member of academies"
                  groups={serverAcademies}
                  selected={fields.academyIds}
                  onChange={setField("academyIds")}
                  error={errors.academyIds}
                />
              </>
            )}

            <NotesField value={fields.notes} onChange={setField("notes")} error={errors.notes} />

            {preview && <p className="preview">{preview}</p>}
            {errors._ && <p className="error">{errors._}</p>}
          </>
        )}

        <div className="modal-actions">
          {editing && (
            <button
              type="button"
              className="btn btn-danger push-left"
              onClick={() => onDelete(alliance)}
              disabled={busy}
            >
              Delete
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={Boolean(blocker) || busy}>
            {busy ? "Saving…" : editing ? "Save Changes" : "Save Alliance"}
          </button>
        </div>
      </form>
    </div>
  );
}
