import { formatPower, parsePower, POWER_MAX } from "../format";

// Text input for a bigint. Accepts digits with optional separators and reformats with commas on blur.
export default function PowerField({ value, onChange, error }) {
  const handleBlur = () => {
    const parsed = parsePower(value);
    if (parsed !== null) onChange(formatPower(parsed));
  };

  return (
    <label>
      Power <small>(whole number, e.g. 1,200,000)</small>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        inputMode="numeric"
        placeholder="0"
      />
      {error && <span className="error">{error}</span>}
    </label>
  );
}

export function powerError(value) {
  return parsePower(value) === null
    ? `Power must be a whole number from 0 to ${POWER_MAX.toLocaleString("en-US")}.`
    : null;
}
