export const formatAlliance = (a) => `[#${a.tag}][#${a.server}]${a.name}`;

// Count code points, not UTF-16 units, so limits match the server.
export const charLength = (s) => Array.from(s).length;

export const formatServer = (number) => `Server #${number}`;

// The two kinds of group an alliance can belong to (any number of each).
export const GROUP = {
  family: { collection: "families", field: "familyIds", label: "Family", plural: "Families" },
  academy: { collection: "academies", field: "academyIds", label: "Academy", plural: "Academies" },
};

export const membersOf = (kind, groupId, alliances) =>
  alliances.filter((a) => a[GROUP[kind].field].includes(groupId));

// Families whose root this alliance is.
export const rootOf = (alliance, families) => families.filter((f) => f.rootId === alliance.id);

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
export const sortByName = (items) => [...items].sort(byName);

// Power is a bigint kept as a digit string; BigInt compares and formats it exactly.
export const POWER_MAX = BigInt("18446744073709551615"); // 2^64 - 1, unsigned 64-bit

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

// Highest power first, then name.
export const byPower = (a, b) => {
  const powerA = powerOf(a);
  const powerB = powerOf(b);
  if (powerA !== powerB) return powerA > powerB ? -1 : 1;
  return byName(a, b);
};
