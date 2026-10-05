import { useState } from "react";
import { formatTag } from "../format";

const MAX_RESULTS = 8;

// Type-ahead search over alliances by tag (tags are unique within a kingdom). Picking a result calls
// onPick(alliance) and clears the box. `describe(alliance)` adds a short note to each result.
export default function TagSearch({ alliances, onPick, describe, placeholder, id }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const q = query.trim().toUpperCase();
  // Tags starting with the query come first, then tags containing it.
  const results = q
    ? alliances
        .filter((a) => a.tag.toUpperCase().includes(q))
        .sort((a, b) => a.tag.toUpperCase().indexOf(q) - b.tag.toUpperCase().indexOf(q) || a.tag.localeCompare(b.tag))
        .slice(0, MAX_RESULTS)
    : [];
  const showList = open && q.length > 0;

  const pick = (alliance) => {
    onPick(alliance);
    setQuery("");
    setActive(0);
  };

  const onKeyDown = (e) => {
    if (!showList) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault(); // don't submit the form
      if (results[active]) pick(results[active]);
    } else if (e.key === "Escape") {
      e.stopPropagation(); // close the list, not the whole modal
      e.nativeEvent.stopImmediatePropagation();
      setOpen(false);
    }
  };

  return (
    <div className="tag-search">
      <input
        id={id}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
      />
      {showList && (
        <ul className="tag-search-results" role="listbox">
          {results.length ? (
            results.map((a, i) => (
              <li
                key={a.id}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                // mousedown, not click, so the input doesn't blur (and close the list) first
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(a);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <strong className="alliance-label-tag">{formatTag(a.tag)}</strong>{" "}
                <span className="alliance-label-name">{a.name}</span>
                {describe && <small className="muted"> {describe(a)}</small>}
              </li>
            ))
          ) : (
            <li className="empty">No alliance with a tag matching “{query.trim()}”.</li>
          )}
        </ul>
      )}
    </div>
  );
}
