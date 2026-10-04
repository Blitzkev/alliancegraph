export const TYPE_LABELS = { root: "Root", family: "Family", academy: "Academy" };

export const formatAlliance = (a) => `[#${a.tag}][#${a.server}]${a.name}`;

// Count code points, not UTF-16 units, so limits match the server.
export const charLength = (s) => Array.from(s).length;

export const formatServer = (number) => `Server #${number}`;

export function allianceDeleteMessage(target, alliances) {
  const count = alliances.filter((a) => a.rootId === target.id).length;
  let message = `Delete ${formatAlliance(target)}?`;
  if (count) message += `\n\nThis will also delete its ${count} family/academy alliance(s).`;
  return message;
}

// Power is a bigint kept as a digit string; BigInt compares and formats it exactly.
export const POWER_MAX = BigInt("9223372036854775807"); // 2^63 - 1, signed 64-bit

const powerOf = (a) => BigInt(a.power || "0");

export const formatPower = (power) => BigInt(power || "0").toLocaleString("en-US");

// "1,200,000" / "1 200 000" / "1200000" -> "1200000"; "" -> "0"; invalid -> null.
export function parsePower(text) {
  const digits = text.replace(/[,_\s]/g, "");
  if (digits === "") return "0";
  if (!/^[0-9]+$/.test(digits)) return null;
  const value = BigInt(digits);
  return value <= POWER_MAX ? value.toString() : null;
}

// Display order: user-arranged position first; otherwise highest power, then name.
export const byOrder = (a, b) => {
  const pa = a.position ?? Infinity;
  const pb = b.position ?? Infinity;
  if (pa !== pb) return pa - pb;
  const powerA = powerOf(a);
  const powerB = powerOf(b);
  if (powerA !== powerB) return powerA > powerB ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
};

// Highest power first, ignoring any manual arrangement.
export const byPower = (a, b) => byOrder({ ...a, position: null }, { ...b, position: null });
