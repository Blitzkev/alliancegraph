import { useState } from "react";
import {
  byPower,
  familyAcademies,
  familyLeader,
  familyMembers,
  formatAlliance,
  formatFamily,
  formatPower,
  formatServer,
  sortFamilies,
  totalPower,
} from "../format";

// Long notes are clipped to a few lines until expanded.
const NOTES_PREVIEW_LINES = 4;
const NOTES_PREVIEW_CHARS = 280;

function Notes({ text }) {
  const [expanded, setExpanded] = useState(false);
  if (!text || !text.trim()) return null;
  const long = text.length > NOTES_PREVIEW_CHARS || text.split("\n").length > NOTES_PREVIEW_LINES;
  return (
    <div className="tree-notes-wrap">
      <div className={`tree-notes${long && !expanded ? " clamped" : ""}`}>{text}</div>
      {long && (
        <button className="link-btn" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function AllianceItem({ alliance, isLeader, onEdit }) {
  return (
    <li>
      <button
        className={`tree-item type-${isLeader ? "root" : "alliance"}`}
        onClick={() => onEdit(alliance)}
        title="Click to edit or delete"
      >
        {formatAlliance(alliance)}
        {isLeader && <span className="root-badge">Leader</span>}
        <span className="tree-power">{formatPower(alliance.power)}</span>
      </button>
      <Notes text={alliance.notes} />
    </li>
  );
}

function AllianceList({ label, kind, items, leaderId, onEdit, empty = "None" }) {
  return (
    <li>
      <span className={`tree-group type-${kind}`}>
        {label} ({items.length})
      </span>
      <ul>
        {items.length ? (
          items.map((a) => <AllianceItem key={a.id} alliance={a} isLeader={a.id === leaderId} onEdit={onEdit} />)
        ) : (
          <li className="tree-empty">{empty}</li>
        )}
      </ul>
    </li>
  );
}

function FamilyLinks({ label, kind, familyIds, alliances, onSelect }) {
  return (
    <li>
      <span className={`tree-group type-${kind}`}>
        {label} ({familyIds.length})
      </span>
      <ul>
        {familyIds.length ? (
          familyIds.map((id) => (
            <li key={id}>
              <button className="tree-item type-family" onClick={() => onSelect({ kind: "family", id })}>
                {formatFamily(id, alliances)}
              </button>
            </li>
          ))
        ) : (
          <li className="tree-empty">None</li>
        )}
      </ul>
    </li>
  );
}

function FamilyDetails({ family, alliances, onEditAlliance }) {
  const leader = familyLeader(family.id, alliances);
  const members = [...familyMembers(family.id, alliances)].sort(byPower); // leader comes first
  return (
    <>
      <p className="panel-power">Total power: {formatPower(totalPower(members))}</p>
      <ul className="tree">
        <AllianceList label="Members" kind="family" items={members} leaderId={leader?.id} onEdit={onEditAlliance} />
        <AllianceList
          label="Academies"
          kind="academy"
          items={[...familyAcademies(family.id, alliances)].sort(byPower)}
          onEdit={onEditAlliance}
        />
        <AllianceList
          label="Allied alliances"
          kind="allied"
          items={alliances.filter((a) => a.alliedFamilyIds.includes(family.id)).sort(byPower)}
          onEdit={onEditAlliance}
        />
      </ul>
    </>
  );
}

function AllianceDetails({ alliance, families, alliances, onSelect }) {
  const familyOrder = sortFamilies(families).map((f) => f.id);
  const allied = familyOrder.filter((id) => alliance.alliedFamilyIds.includes(id));
  let relationship = "Independent";
  if (alliance.familyId) {
    const isLeader = familyLeader(alliance.familyId, alliances)?.id === alliance.id;
    relationship = isLeader ? "Leader of" : "Member of";
  } else if (alliance.academyOf) relationship = "Academy of";
  const familyId = alliance.familyId || alliance.academyOf;
  return (
    <>
      <p className="panel-power">Power: {formatPower(alliance.power)}</p>
      <p className="panel-relationship">
        {relationship}
        {familyId && (
          <>
            {" "}
            <button className="link-btn inline" onClick={() => onSelect({ kind: "family", id: familyId })}>
              {formatFamily(familyId, alliances)}
            </button>
          </>
        )}
      </p>
      <Notes text={alliance.notes} />
      <ul className="tree">
        <FamilyLinks label="Allied with families" kind="allied" familyIds={allied} alliances={alliances} onSelect={onSelect} />
      </ul>
    </>
  );
}

// Side panel for whatever is selected in the graph: a family or an alliance.
export default function DetailPanel({ selected, families, alliances, onSelect, onEdit, onClose }) {
  const isFamily = selected.kind === "family";
  const item = (isFamily ? families : alliances).find((x) => x.id === selected.id);
  if (!item) return null;
  const title = isFamily ? formatFamily(item.id, alliances) : formatAlliance(item);

  return (
    <aside className="umbrella-panel">
      <header>
        <div>
          <h2 className={`type-${isFamily ? "family" : "alliance"}`}>{isFamily ? "Family" : "Alliance"}</h2>
          <div className="panel-title">{title}</div>
          <small>{formatServer(item.server)}</small>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      {isFamily ? (
        <FamilyDetails family={item} alliances={alliances} onEditAlliance={(a) => onEdit(a)} />
      ) : (
        <AllianceDetails alliance={item} families={families} alliances={alliances} onSelect={onSelect} />
      )}
      {isFamily ? (
        <p className="panel-hint">
          A family is led by its strongest member. Click an alliance to edit it or change its family.
        </p>
      ) : (
        <div className="panel-actions">
          <button className="btn btn-secondary" onClick={() => onEdit(item)}>
            Edit alliance
          </button>
        </div>
      )}
    </aside>
  );
}
