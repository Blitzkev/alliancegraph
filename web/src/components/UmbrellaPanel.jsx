import { byOrder, formatAlliance, formatServer } from "../format";

function Item({ alliance, onEdit }) {
  return (
    <button
      className={`tree-item type-${alliance.type}`}
      onClick={() => onEdit(alliance)}
      title="Click to edit or delete"
    >
      {formatAlliance(alliance)}
    </button>
  );
}

function Group({ label, type, members, onEdit }) {
  return (
    <li>
      <span className={`tree-group type-${type}`}>
        {label} ({members.length})
      </span>
      {members.length ? (
        <ul>
          {members.map((m) => (
            <li key={m.id}>
              <Item alliance={m} onEdit={onEdit} />
            </li>
          ))}
        </ul>
      ) : (
        <ul>
          <li className="tree-empty">None</li>
        </ul>
      )}
    </li>
  );
}

// Tree of one root umbrella: the root, then its families and academies.
export default function UmbrellaPanel({ root, alliances, onEdit, onClose }) {
  const members = alliances.filter((a) => a.rootId === root.id);
  const families = members.filter((a) => a.type === "family").sort(byOrder);
  const academies = members.filter((a) => a.type === "academy").sort(byOrder);

  return (
    <aside className="umbrella-panel">
      <header>
        <div>
          <h2>Root umbrella</h2>
          <small>
            {formatServer(root.server)} · {members.length} member{members.length === 1 ? "" : "s"}
          </small>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <ul className="tree">
        <li>
          <Item alliance={root} onEdit={onEdit} />
          <ul>
            <Group label="Families" type="family" members={families} onEdit={onEdit} />
            <Group label="Academies" type="academy" members={academies} onEdit={onEdit} />
          </ul>
        </li>
      </ul>
      <p className="panel-hint">Click an alliance to edit or delete it.</p>
    </aside>
  );
}
