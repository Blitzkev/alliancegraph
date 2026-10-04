import { useEffect, useState } from "react";
import { createAlliance } from "../api";
import {
  charLength,
  familyRoot,
  formatAlliance,
  formatFamily,
  formatServer,
  parsePower,
  sortFamilies,
  TYPE_LABELS,
} from "../format";
import NotesField, { notesError } from "./NotesField";
import PowerField, { powerError } from "./PowerField";

export const NEW_FAMILY = "";

function validate({ name, tag, power, notes }, server, isAcademy, familyId) {
  const errors = {};
  const n = charLength(name.trim());
  const t = charLength(tag.trim());
  if (n === 0) errors.name = "Name is required.";
  else if (n > 256) errors.name = "Name must be at most 256 characters.";
  if (t === 0) errors.tag = "Tag is required.";
  else if (t > 4) errors.tag = "Tag must be 1-4 characters.";
  if (!server) errors.server = "Select a server.";
  if (isAcademy && !familyId) errors.familyId = "Select a family.";
  const powerProblem = powerError(power);
  if (powerProblem) errors.power = powerProblem;
  const notesProblem = notesError(notes);
  if (notesProblem) errors.notes = notesProblem;
  return errors;
}

// Family picker shared by the create and edit modals.
export function FamilySelect({ value, onChange, families, alliances, allowNew, error }) {
  return (
    <label>
      Family
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {allowNew ? (
          <option value={NEW_FAMILY}>New family (this alliance becomes its root)</option>
        ) : (
          <option value="">Select a family…</option>
        )}
        {families.map((f) => (
          <option key={f.id} value={f.id}>
            {formatFamily(f.id, alliances)}
          </option>
        ))}
      </select>
      {error && <span className="error">{error}</span>}
    </label>
  );
}

export function RootCheckbox({ checked, onChange, familyId, alliances, locked }) {
  const current = familyRoot(familyId, alliances);
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={locked}
      />
      <span>
        Root of the family
        <small>
          {locked
            ? " (set root on another family alliance to change it)"
            : current && ` (replaces ${formatAlliance(current)})`}
        </small>
      </span>
    </label>
  );
}

export default function AllianceModal({ userId, type, servers, families, alliances, onSaved, onClose }) {
  const isAcademy = type === "academy";
  const blocker =
    servers.length === 0
      ? "A Server/Kingdom must exist before you can create an alliance."
      : isAcademy && families.length === 0
        ? "A Family Alliance must exist before you can create an Academy Alliance."
        : null;

  const [fields, setFields] = useState({ name: "", tag: "", power: "", notes: "" });
  const [server, setServer] = useState(servers.length === 1 ? servers[0] : "");
  const [familyId, setFamilyId] = useState(NEW_FAMILY);
  const [isRoot, setIsRoot] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // Alliances can only be related on the same server.
  const serverFamilies = sortFamilies(
    families.filter((f) => f.server === server),
    alliances,
  );
  const noFamiliesOnServer = isAcademy && Boolean(server) && serverFamilies.length === 0;

  useEffect(() => {
    setFamilyId(isAcademy && serverFamilies.length === 1 ? serverFamilies[0].id : NEW_FAMILY);
    setIsRoot(false);
  }, [server]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const found = validate(fields, server, isAcademy, familyId);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      await createAlliance(userId, {
        ...fields,
        power: parsePower(fields.power),
        server,
        type,
        familyId: familyId || null,
        isRoot: !isAcademy && Boolean(familyId) && isRoot,
      });
      onSaved();
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

            {server && !noFamiliesOnServer && (
              <FamilySelect
                value={familyId}
                onChange={(id) => {
                  setFamilyId(id);
                  setIsRoot(false);
                }}
                families={serverFamilies}
                alliances={alliances}
                allowNew={!isAcademy}
                error={errors.familyId}
              />
            )}
            {noFamiliesOnServer && (
              <p className="error">
                {formatServer(server)} has no families. Create a Family Alliance there first.
              </p>
            )}
            {!isAcademy && familyId && (
              <RootCheckbox checked={isRoot} onChange={setIsRoot} familyId={familyId} alliances={alliances} />
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

            <PowerField
              value={fields.power}
              onChange={(power) => setFields((f) => ({ ...f, power }))}
              error={errors.power}
            />

            <NotesField
              value={fields.notes}
              onChange={(notes) => setFields((f) => ({ ...f, notes }))}
              error={errors.notes}
            />

            {preview && <p className="preview">{preview}</p>}
            {(errors._ || errors.isRoot || errors.type) && (
              <p className="error">{errors._ || errors.isRoot || errors.type}</p>
            )}
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={Boolean(blocker) || noFamiliesOnServer || saving}
          >
            {saving ? "Saving…" : "Save Alliance"}
          </button>
        </div>
      </form>
    </div>
  );
}
