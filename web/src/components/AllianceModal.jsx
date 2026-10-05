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
  sortFamilies,
} from "../format";
import NotesField, { notesError } from "./NotesField";
import PowerField, { powerError } from "./PowerField";
import TagSearch from "./TagSearch";

const ROLES = [
  { value: "none", label: "Independent" },
  { value: "family", label: "Family member" },
  { value: "academy", label: "Academy of a family" },
];

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

// A picked family or alliance, shown as a removable chip.
function Chip({ children, onRemove, label }) {
  return (
    <div className="chip">
      <div className="chip-body">{children}</div>
      <button type="button" className="chip-remove" onClick={onRemove} aria-label={`Remove ${label}`} title="Remove">
        ×
      </button>
    </div>
  );
}

const relationshipNote = (a, alliances) =>
  a.familyId ? `in ${formatFamily(a.familyId, alliances)}` : "independent";

// "In a family with": search by tag and pick one alliance. Picking a family member picks its whole
// family; picking an independent alliance forms a new family with it.
function FamilyPicker({ candidates, alliances, self, pick, onPick, error }) {
  // The only member of a family (which then has an academy) can stay as it is without picking.
  const ownFamilyAlone = self?.familyId && familyMembers(self.familyId, alliances).length === 1;
  return (
    <fieldset className="group-checklist type-family">
      <legend>In a family with</legend>
      {pick ? (
        <Chip
          onRemove={() => onPick(null)}
          label={pick.kind === "family" ? formatFamily(pick.id, alliances) : "alliance"}
        >
          {pick.kind === "family" ? (
            <FamilyLabel familyId={pick.id} alliances={alliances} self={self} />
          ) : (
            <AllianceLabel alliance={alliances.find((a) => a.id === pick.id)} />
          )}
        </Chip>
      ) : (
        <>
          <TagSearch
            alliances={candidates}
            onPick={(a) => onPick(a.familyId ? { kind: "family", id: a.familyId } : { kind: "alliance", id: a.id })}
            describe={(a) => relationshipNote(a, alliances)}
            placeholder="Search by tag, e.g. G86H"
          />
          <p className="muted">
            {ownFamilyAlone
              ? "Nothing picked: it stays a family of itself and its academy."
              : "Pick an alliance: a family needs two or more alliances (or one plus its academy)."}
          </p>
        </>
      )}
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
  // { kind: "family" | "alliance", id }: the family to join, or an independent to form one with.
  // An alliance editing its own family starts with it picked (unless it's alone in it).
  const [familyPick, setFamilyPick] = useState(() =>
    alliance?.familyId && familyMembers(alliance.familyId, alliances).length > 1
      ? { kind: "family", id: alliance.familyId }
      : null,
  );
  // { kind: "family" | "alliance", id }: the family it's the academy of, or an independent alliance
  // that becomes a family together with this academy.
  const [academyPick, setAcademyPick] = useState(alliance?.academyOf ? { kind: "family", id: alliance.academyOf } : null);
  const [allied, setAllied] = useState(alliance?.alliedFamilyIds ?? []);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  // Relationships only ever stay within one server.
  const serverFamilies = sortFamilies(families.filter((f) => f.server === server));
  const others = alliances.filter((a) => a.server === server && a.id !== alliance?.id);
  // Families this alliance will belong to / be an academy of can't also be allied.
  const ownFamily =
    role === "family" ? (familyPick?.kind === "family" ? familyPick.id : alliance?.familyId) : role === "academy" && academyPick?.kind === "family" ? academyPick.id : null;
  const alliedShown = allied.filter((id) => id !== ownFamily);
  const academyTaken = (familyId) => alliances.some((a) => a.academyOf === familyId && a.id !== alliance?.id);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setField = (key) => (value) => setFields((f) => ({ ...f, [key]: value }));
  const changeServer = (value) => {
    setServer(value);
    setFamilyPick(null);
    setAcademyPick(null);
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
    if (role === "academy" && !academyPick) found.academyOf = "Pick the alliance or family it's an academy of.";
    const aloneWithAcademy = alliance?.familyId && familyMembers(alliance.familyId, alliances).length === 1;
    if (role === "family" && !familyPick && !aloneWithAcademy)
      found.familyWith = "Pick an alliance to be in a family with: a family needs two or more alliances.";
    const powerProblem = powerError(fields.power);
    if (powerProblem) found.power = powerProblem;
    const notesProblem = notesError(fields.notes);
    if (notesProblem) found.notes = notesProblem;
    setErrors(found);
    if (Object.keys(found).length) return;

    const familyWith = !familyPick
      ? []
      : familyPick.kind === "family"
        ? familyMembers(familyPick.id, alliances).map((a) => a.id).filter((id) => id !== alliance?.id)
        : [familyPick.id];
    const body = {
      ...fields,
      power: parsePower(fields.power),
      server,
      role,
      familyWith,
      academyOf: role === "academy" && academyPick?.kind === "family" ? academyPick.id : null,
      academyOfAlliance: role === "academy" && academyPick?.kind === "alliance" ? academyPick.id : null,
      alliedFamilyIds: alliedShown,
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
                    // Academies can't be in a family, so they aren't offered.
                    candidates={others.filter((a) => roleOf(a) !== "academy")}
                    alliances={alliances}
                    self={alliance}
                    pick={familyPick}
                    onPick={setFamilyPick}
                    error={errors.familyWith}
                  />
                )}

                {role === "academy" && (
                  <fieldset className="group-checklist type-academy">
                    <legend>Academy of</legend>
                    {academyPick?.kind === "family" ? (
                      <Chip onRemove={() => setAcademyPick(null)} label={formatFamily(academyPick.id, alliances)}>
                        <FamilyLabel familyId={academyPick.id} alliances={alliances} self={alliance} />
                      </Chip>
                    ) : academyPick ? (
                      <Chip onRemove={() => setAcademyPick(null)} label="alliance">
                        <AllianceLabel alliance={alliances.find((a) => a.id === academyPick.id)} />
                        <small className="muted">It and this academy become a family.</small>
                      </Chip>
                    ) : (
                      <TagSearch
                        // A family member's tag picks its family; an independent's tag makes the two a
                        // family. A family can only have one academy, so ones that already do are left out.
                        alliances={others.filter((a) => !a.academyOf && !(a.familyId && academyTaken(a.familyId)))}
                        onPick={(a) => setAcademyPick(a.familyId ? { kind: "family", id: a.familyId } : { kind: "alliance", id: a.id })}
                        describe={(a) => relationshipNote(a, alliances)}
                        placeholder="Search by tag, e.g. G86H"
                      />
                    )}
                    {errors.academyOf && <span className="error">{errors.academyOf}</span>}
                  </fieldset>
                )}

                {serverFamilies.length > 0 && (
                  <fieldset className="group-checklist type-family">
                    <legend>
                      Allied with families <small>({alliedShown.length} selected)</small>
                    </legend>
                    {alliedShown.map((id) => (
                      <Chip
                        key={id}
                        onRemove={() => setAllied(allied.filter((x) => x !== id))}
                        label={formatFamily(id, alliances)}
                      >
                        <FamilyLabel familyId={id} alliances={alliances} self={alliance} />
                      </Chip>
                    ))}
                    <TagSearch
                      // Only family members lead to a family; its own family and ones already added are left out.
                      alliances={others.filter((a) => a.familyId && a.familyId !== ownFamily && !allied.includes(a.familyId))}
                      onPick={(a) => setAllied([...allied, a.familyId])}
                      describe={(a) => relationshipNote(a, alliances)}
                      placeholder="Search by tag to add a family"
                    />
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
