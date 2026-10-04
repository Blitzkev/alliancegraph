import { charLength } from "../format";

export const NOTES_MAX = 200000;

// Free-form notes. The value is sent exactly as typed, so whitespace and line breaks are kept.
export default function NotesField({ value, onChange, error }) {
  const length = charLength(value);
  return (
    <label>
      Notes <small>(optional)</small>
      <textarea
        className="notes"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        spellCheck
      />
      <span className={`char-count${length > NOTES_MAX ? " over" : ""}`}>
        {length.toLocaleString()} / {NOTES_MAX.toLocaleString()}
      </span>
      {error && <span className="error">{error}</span>}
    </label>
  );
}

export function notesError(value) {
  return charLength(value) > NOTES_MAX
    ? `Notes must be at most ${NOTES_MAX.toLocaleString()} characters.`
    : null;
}
