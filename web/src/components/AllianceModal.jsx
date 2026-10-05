import { useEffect, useState } from "react";
import { createAlliance, updateAlliance } from "../api";
import {
  byPower,
  charLength,
  familyMembers,
  formatAlliance,
  formatFamily,
  formatPower,
  formatServer,
  formatTag,
  parsePower,
  roleOf,
  sortByName,
  sortFamilies,
} from "../format";
import NotesField, { notesError } from "./NotesField";
import PowerField, { powerError } from "./PowerField";

const ROLES = [
  { value: "none", label: "Independent" },
  { value: "family", label: "Family member" },
  { value: "academy", label: "Academy of a family" },
];

const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

// "[#TAG] Name", with the tag bold and larger.
function AllianceLabel({ alliance }) {
  return (
    <span className="alliance-label">
      <strong className="alliance-label-tag">{formatTag(alliance.tag)}</strong>{" "}
      <span className="alliance-label-name">{alliance.name}</span>
    </span>
  );
}

// A family shown as its members, strongest first (leaving out the alliance being edited).
function FamilyLabel({ familyId, alliances, self, note }) {
  const members = familyMembers(familyId, alliances).filter((a) => a.id !== self?.id).sort(byPower);
  return (
    <span className="family-label">
      {members.length ? (
        members.map((m) => <AllianceLabel key={m.id} alliance={m} />)
      ) : (
        <small className="muted">only this alliance</small>
      )}
      {note && <small className="muted">{note}</small>}
    </span>
  );
}

// "In a family with": whole families (picked as a unit) and independent alliances.
function FamilyPicker({ families, independents, alliances, self, picked, onPick, loners, onLoners, error }) {
  const mergeCount = picked.length;
  const nothing = picked.length === 0 && loners.length === 0;
  const ownFamilyAlone = self?.familyId && picked.length === 1 && picked[0] === self.familyId &&
    familyMembers(self.familyId, alliances).length === 1;
  return (
    <fieldset className="group-checklist type-family">
      <legend>In a family with</legend>
      {families.length === 0 && independents.length === 0 && (
        <p className="muted">No other alliances on this server yet.</p>
      )}
      {families.map((f) => (
        <label key={f.id} className="checkbox family-option">
          <input type="checkbox" checked={picked.includes(f.id)} onChange={() => onPick(toggle(picked, f.id))} />
          <FamilyLabel familyId={f.id} alliances={alliances} self={self} />
        </label>
      ))}
      {independents.length > 0 && <div className="checklist-heading">Independent alliances</div>}
      {independents.map((a) => (
        <label key={a.id} className="checkbox">
          <input type="checkbox" checked={loners.includes(a.id)} onChange={() => onLoners(toggle(loners, a.id))} />
          <AllianceLabel alliance={a} />
        </label>
      ))}
      {mergeCount > 1 && (
        <p className="warning">These {mergeCount} families will be merged into one family.</p>
      )}
      {nothing && <p className="muted">Nothing picked: this alliance starts a new family on its own.</p>}
      {ownFamilyAlone && loners.length === 0 && <p className="muted">It stays a family of one.</p>}
      {error && <span className="error">{error}</span>}
    </fieldset>
  );
}

// Create (no `alliance`) or edit an alliance, including its family relationships.
export default function AllianceModal({
  userId,
  alliance,
  servers,
  defaultServer,
  families,
  alliances,
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
  });
  const [role, setRole] = useState(alliance ? roleOf(alliance) : "none");
  const [pickedFamilies, setPickedFamilies] = useState(alliance?.familyId ? [alliance.familyId] : []);
  const [pickedLoners, setPickedLoners] = useState([]);
  const [academyOf, setAcademyOf] = useState(alliance?.academyOf ?? "");
  const [allied, setAllied] = useState(alliance?.alliedFamilyIds ?? []);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  // Relationships only ever stay within one server.
  const serverFamilies = sortFamilies(families.filter((f) => f.server === server));
  const independents = sortByName(
    alliances.filter((a) => a.server === server && roleOf(a) === "none" && a.id !== alliance?.id),
  );
  // Families this alliance will belong to / be an academy of can't also be allied.
  const ownFamilies = role === "family" ? pickedFamilies : role === "academy" && academyOf ? [academyOf] : [];

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setField = (key) => (value) => setFields((f) => ({ ...f, [key]: value }));
  const changeServer = (value) => {
    setServer(value);
    setPickedFamilies([]);
    setPickedLoners([]);
    setAcademyOf("");
    setAllied([]);
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
    if (role === "academy" && !academyOf) found.academyOf = "Pick the family it's an academy of.";
    const powerProblem = powerError(fields.power);
    if (powerProblem) found.power = powerProblem;
    const notesProblem = notesError(fields.notes);
    if (notesProblem) found.notes = notesProblem;
    setErrors(found);
    if (Object.keys(found).length) return;

    const familyWith = [
      ...pickedFamilies.flatMap((id) => familyMembers(id, alliances).map((a) => a.id)),
      ...pickedLoners,
    ].filter((id) => id !== alliance?.id);
    const body = {
      ...fields,
      power: parsePower(fields.power),
      server,
      role,
      familyWith,
      academyOf: role === "academy" ? academyOf : null,
      alliedFamilyIds: allied.filter((id) => !ownFamilies.includes(id)),
    };
    setBusy(true);
    try {
      if (editing) await updateAlliance(userId, alliance.id, body);
      else await createAlliance(userId, body);
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
        <h2>{editing ? "Edit Alliance" : "New Alliance"}</h2>

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
                <fieldset className="role-choice">
                  <legend>Relationship</legend>
                  {ROLES.map((r) => (
                    <label key={r.value} className="radio">
                      <input type="radio" checked={role === r.value} onChange={() => setRole(r.value)} />
                      {r.label}
                    </label>
                  ))}
                  {errors.role && <span className="error">{errors.role}</span>}
                </fieldset>

                {role === "family" && (
                  <FamilyPicker
                    families={serverFamilies}
                    independents={independents}
                    alliances={alliances}
                    self={alliance}
                    picked={pickedFamilies}
                    onPick={setPickedFamilies}
                    loners={pickedLoners}
                    onLoners={setPickedLoners}
                    error={errors.familyWith}
                  />
                )}

                {role === "academy" && (
                  <label>
                    Academy of
                    <select value={academyOf} onChange={(e) => setAcademyOf(e.target.value)}>
                      <option value="">Select a family…</option>
                      {serverFamilies.map((f) => (
                        <option key={f.id} value={f.id}>
                          {formatFamily(f.id, alliances)}
                        </option>
                      ))}
                    </select>
                    {serverFamilies.length === 0 && <small>No families on this server yet.</small>}
                    {errors.academyOf && <span className="error">{errors.academyOf}</span>}
                  </label>
                )}

                {serverFamilies.length > 0 && (
                  <fieldset className="group-checklist type-family">
                    <legend>
                      Allied with families <small>({allied.filter((id) => !ownFamilies.includes(id)).length} selected)</small>
                    </legend>
                    {serverFamilies.map((f) => {
                      const own = ownFamilies.includes(f.id);
                      return (
                        <label key={f.id} className={`checkbox family-option${own ? " disabled" : ""}`}>
                          <input
                            type="checkbox"
                            checked={!own && allied.includes(f.id)}
                            onChange={() => setAllied(toggle(allied, f.id))}
                            disabled={own}
                          />
                          <FamilyLabel
                            familyId={f.id}
                            alliances={alliances}
                            self={alliance}
                            note={own ? "(its own family)" : null}
                          />
                        </label>
                      );
                    })}
                    {errors.alliedFamilyIds && <span className="error">{errors.alliedFamilyIds}</span>}
                  </fieldset>
                )}
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
