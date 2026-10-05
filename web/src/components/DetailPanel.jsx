import { useState } from "react";
import { byPower, formatAlliance, formatPower, formatServer, GROUP, membersOf, sortByName } from "../format";

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

function AllianceItem({ alliance, isRoot, onEdit }) {
  return (
    <li>
      <button
        className={`tree-item type-${isRoot ? "root" : "alliance"}`}
        onClick={() => onEdit(alliance)}
        title="Click to edit or delete"
      >
        {formatAlliance(alliance)}
        {isRoot && <span className="root-badge">Root</span>}
        <span className="tree-power">{formatPower(alliance.power)}</span>
      </button>
      <Notes text={alliance.notes} />
    </li>
  );
}

function GroupLinks({ label, kind, groups, onSelect, rootIds = [] }) {
  return (
    <li>
      <span className={`tree-group type-${kind}`}>
        {label} ({groups.length})
      </span>
      <ul>
        {groups.length ? (
          groups.map((g) => (
            <li key={g.id}>
              <button className={`tree-item type-${kind}`} onClick={() => onSelect({ kind, id: g.id })}>
                {g.name}
                {rootIds.includes(g.id) && <span className="root-badge">Root</span>}
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

function GroupDetails({ kind, group, families, academies, alliances, onSelect, onEditAlliance }) {
  const members = [...membersOf(kind, group.id, alliances)].sort(byPower);
  const allies = alliances.filter((a) => a.alliedFamilyIds.includes(group.id)).sort(byPower);
  // The root is listed first.
  const ordered = kind === "family" ? [...members].sort((a, b) => (b.id === group.rootId) - (a.id === group.rootId)) : members;
  return (
    <ul className="tree">
      <li>
        <span className={`tree-group type-${kind}`}>Alliances ({members.length})</span>
        <ul>
          {ordered.length ? (
            ordered.map((a) => (
              <AllianceItem key={a.id} alliance={a} isRoot={a.id === group.rootId} onEdit={onEditAlliance} />
            ))
          ) : (
            <li className="tree-empty">None yet. Add them from an alliance's edit form.</li>
          )}
        </ul>
      </li>
      {kind === "family" && (
        <li>
          <span className="tree-group type-allied">Allied alliances ({allies.length})</span>
          <ul>
            {allies.length ? (
              allies.map((a) => <AllianceItem key={a.id} alliance={a} isRoot={false} onEdit={onEditAlliance} />)
            ) : (
              <li className="tree-empty">None</li>
            )}
          </ul>
        </li>
      )}
      {kind === "family" ? (
        <GroupLinks
          label="Protects academies"
          kind="academy"
          groups={sortByName(academies.filter((a) => a.familyIds.includes(group.id)))}
          onSelect={onSelect}
        />
      ) : (
        <GroupLinks
          label="Protected by families"
          kind="family"
          groups={sortByName(families.filter((f) => group.familyIds.includes(f.id)))}
          onSelect={onSelect}
        />
      )}
    </ul>
  );
}

function AllianceDetails({ alliance, families, academies, onSelect }) {
  return (
    <>
      <p className="panel-power">Power: {formatPower(alliance.power)}</p>
      <Notes text={alliance.notes} />
      <ul className="tree">
        <GroupLinks
          label="Families"
          kind="family"
          groups={sortByName(families.filter((f) => alliance.familyIds.includes(f.id)))}
          rootIds={families.filter((f) => f.rootId === alliance.id).map((f) => f.id)}
          onSelect={onSelect}
        />
        <GroupLinks
          label="Allied with families"
          kind="family"
          groups={sortByName(families.filter((f) => alliance.alliedFamilyIds.includes(f.id)))}
          onSelect={onSelect}
        />
        <GroupLinks
          label="Academies"
          kind="academy"
          groups={sortByName(academies.filter((a) => alliance.academyIds.includes(a.id)))}
          onSelect={onSelect}
        />
      </ul>
    </>
  );
}

// Side panel for whatever is selected in the graph: a family, an academy or an alliance.
export default function DetailPanel({ selected, families, academies, alliances, onSelect, onEdit, onClose }) {
  const collection = selected.kind === "alliance" ? alliances : selected.kind === "family" ? families : academies;
  const item = collection.find((x) => x.id === selected.id);
  if (!item) return null;
  const isAlliance = selected.kind === "alliance";
  const title = isAlliance ? formatAlliance(item) : item.name;
  const heading = isAlliance ? "Alliance" : GROUP[selected.kind].label;

  return (
    <aside className="umbrella-panel">
      <header>
        <div>
          <h2 className={`type-${selected.kind}`}>{heading}</h2>
          <div className="panel-title">{title}</div>
          <small>{formatServer(item.server)}</small>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      {isAlliance ? (
        <AllianceDetails alliance={item} families={families} academies={academies} onSelect={onSelect} />
      ) : (
        <GroupDetails
          kind={selected.kind}
          group={item}
          families={families}
          academies={academies}
          alliances={alliances}
          onSelect={onSelect}
          onEditAlliance={(a) => onEdit("alliance", a)}
        />
      )}
      <div className="panel-actions">
        <button className="btn btn-secondary" onClick={() => onEdit(selected.kind, item)}>
          Edit {heading.toLowerCase()}
        </button>
      </div>
      {!isAlliance && <p className="panel-hint">Click an alliance to edit or delete it.</p>}
    </aside>
  );
}
