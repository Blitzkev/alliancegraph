import { useEffect, useState } from "react";
import { updateAlliance } from "../api";
import {
  charLength,
  formatAlliance,
  formatPower,
  formatServer,
  parsePower,
  sortFamilies,
  TYPE_LABELS,
} from "../format";
import { FamilySelect, NEW_FAMILY, RootCheckbox } from "./AllianceModal";
import NotesField, { notesError } from "./NotesField";
import PowerField, { powerError } from "./PowerField";

export default function EditAllianceModal({
  userId,
  alliance,
  families,
  alliances,
  onSaved,
  onRequestDelete,
  onClose,
}) {
  // Alliances can only be related on the same server.
  const serverFamilies = sortFamilies(
    families.filter((f) => f.server === alliance.server),
    alliances,
  );

  const [fields, setFields] = useState({
    name: alliance.name,
    tag: alliance.tag,
    type: alliance.type,
    familyId: alliance.familyId,
    isRoot: Boolean(alliance.isRoot),
    power: formatPower(alliance.power),
    notes: alliance.notes ?? "",
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const isFamily = fields.type === "family";
  const inOwnFamily = fields.familyId === alliance.familyId;
  // The current root can only hand root over by another alliance taking it.
  const rootLocked = alliance.isRoot && isFamily && inOwnFamily;

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  const setType = (type) =>
    setFields((f) => ({
      ...f,
      type,
      // Academies can't start a new family; fall back to the current one.
      familyId: type === "academy" && f.familyId === NEW_FAMILY ? alliance.familyId : f.familyId,
      isRoot: type === "family" && f.familyId === alliance.familyId && Boolean(alliance.isRoot),
    }));

  const setFamily = (familyId) =>
    setFields((f) => ({
      ...f,
      familyId,
      isRoot: familyId === alliance.familyId && f.type === "family" && Boolean(alliance.isRoot),
    }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const found = {};
    const n = charLength(fields.name.trim());
    const t = charLength(fields.tag.trim());
    if (n === 0) found.name = "Name is required.";
    else if (n > 256) found.name = "Name must be at most 256 characters.";
    if (t === 0) found.tag = "Tag is required.";
    else if (t > 4) found.tag = "Tag must be 1-4 characters.";
    if (!isFamily && !fields.familyId) found.familyId = "Select a family.";
    const powerProblem = powerError(fields.power);
    if (powerProblem) found.power = powerProblem;
    const notesProblem = notesError(fields.notes);
    if (notesProblem) found.notes = notesProblem;
    setErrors(found);
    if (Object.keys(found).length) return;

    setBusy(true);
    try {
      await updateAlliance(userId, alliance.id, {
        name: fields.name,
        tag: fields.tag,
        type: fields.type,
        familyId: fields.familyId || null,
        isRoot: isFamily && (!fields.familyId || fields.isRoot),
        power: parsePower(fields.power),
        notes: fields.notes,
      });
      onSaved();
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
        <h2>
          Edit {TYPE_LABELS[fields.type]} Alliance
          {alliance.isRoot && <span className="root-badge">Root</span>}
        </h2>

        <p className="modal-note">
          {formatServer(alliance.server)} <small>(an alliance's server can't be changed)</small>
        </p>

        <fieldset className="type-choice">
          <legend>Type</legend>
          {["family", "academy"].map((t) => (
            <label key={t} className={`radio type-${t}`}>
              <input type="radio" name="type" value={t} checked={fields.type === t} onChange={() => setType(t)} />
              {TYPE_LABELS[t]}
            </label>
          ))}
        </fieldset>

        <FamilySelect
          value={fields.familyId}
          onChange={setFamily}
          families={serverFamilies}
          alliances={alliances}
          allowNew={isFamily}
          error={errors.familyId}
        />

        {isFamily && fields.familyId && (
          <RootCheckbox
            checked={fields.isRoot}
            onChange={(isRoot) => setFields((f) => ({ ...f, isRoot }))}
            familyId={fields.familyId}
            alliances={alliances.filter((a) => a.id !== alliance.id)}
            locked={rootLocked}
          />
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

        <p className="preview">{preview}</p>
        {(errors._ || errors.type || errors.isRoot) && (
          <p className="error">{errors._ || errors.type || errors.isRoot}</p>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-danger push-left"
            onClick={() => onRequestDelete(alliance)}
            disabled={busy}
          >
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
