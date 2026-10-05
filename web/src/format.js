export const formatAlliance = (a) => `[#${a.tag}][#${a.server}]${a.name}`;

// Count code points, not UTF-16 units, so limits match the server.
export const charLength = (s) => Array.from(s).length;

export const formatServer = (number) => `Server #${number}`;

// An alliance is a family member, an academy of one family, or independent.
export const roleOf = (a) => (a.familyId ? "family" : a.academyOf ? "academy" : "none");

export const familyMembers = (familyId, alliances) => alliances.filter((a) => a.familyId === familyId);
export const familyAcademies = (familyId, alliances) => alliances.filter((a) => a.academyOf === familyId);

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

// A family has no name: it's led by its strongest member (highest power, ties by name).
export const familyLeader = (familyId, alliances) => [...familyMembers(familyId, alliances)].sort(byPower)[0] ?? null;

export const formatFamily = (familyId, alliances) => {
  const leader = familyLeader(familyId, alliances);
  return leader ? `${leader.name} family` : "Empty family";
};

// Families oldest first, so new ones appear at the end.
export const sortFamilies = (families) =>
  [...families].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
