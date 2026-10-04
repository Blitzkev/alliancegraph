import { byPower, familyMembers, formatAlliance, formatPower, formatServer } from "../format";

function Item({ alliance, onEdit }) {
  return (
    <button
      className={`tree-item type-${alliance.isRoot ? "root" : alliance.type}`}
      onClick={() => onEdit(alliance)}
      title="Click to edit or delete"
    >
      {formatAlliance(alliance)}
      {alliance.isRoot && <span className="root-badge">Root</span>}
      <span className="tree-power">{formatPower(alliance.power)}</span>
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

// Tree of one family: its root, then its other family alliances and its academies.
export default function FamilyPanel({ family, alliances, onEdit, onReorder, onClose }) {
  const { root, families, academies } = familyMembers(family.id, alliances);
  const count = families.length + academies.length + (root ? 1 : 0);

  // Undo any manual arrangement: both branches back to highest power first.
  const powerOrder = [...families].sort(byPower).concat([...academies].sort(byPower));
  const isPowerOrder = powerOrder.every((a, i) => a.id === [...families, ...academies][i].id);

  return (
    <aside className="umbrella-panel">
      <header>
        <div>
          <h2>Family</h2>
          <small>
            {formatServer(family.server)} · {count} alliance{count === 1 ? "" : "s"}
          </small>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <ul className="tree">
        <li>
          {root && <Item alliance={root} onEdit={onEdit} />}
          <ul>
            <Group label="Family alliances" type="family" members={families} onEdit={onEdit} />
            <Group label="Academies" type="academy" members={academies} onEdit={onEdit} />
          </ul>
        </li>
      </ul>
      <div className="panel-actions">
        <button
          className="btn btn-secondary"
          onClick={() => onReorder(powerOrder.map((a) => a.id))}
          disabled={isPowerOrder}
          title={isPowerOrder ? "Already sorted by power" : "Sort family alliances and academies by power"}
        >
          Sort by power
        </button>
      </div>
      <p className="panel-hint">Click an alliance to edit or delete it.</p>
    </aside>
  );
}
