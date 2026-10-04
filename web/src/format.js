export const TYPE_LABELS = { family: "Family", academy: "Academy" };

export const formatAlliance = (a) => `[#${a.tag}][#${a.server}]${a.name}`;

// Count code points, not UTF-16 units, so limits match the server.
export const charLength = (s) => Array.from(s).length;

export const formatServer = (number) => `Server #${number}`;

// A family has no name of its own; it's known by its root alliance.
export const familyRoot = (familyId, alliances) =>
  alliances.find((a) => a.familyId === familyId && a.isRoot) ||
  alliances.find((a) => a.familyId === familyId);

export const formatFamily = (familyId, alliances) => {
  const root = familyRoot(familyId, alliances);
  return root ? `${formatAlliance(root)} family` : "Empty family";
};

// Deleting this alliance would leave academies with no family alliance: the user must choose.
export function strandsAcademies(target, alliances) {
  if (target.type !== "family") return 0;
  const family = alliances.filter((a) => a.familyId === target.familyId && a.id !== target.id);
  if (family.some((a) => a.type === "family")) return 0;
  return family.filter((a) => a.type === "academy").length;
}

export function allianceDeleteMessage(target, alliances) {
  let message = `Delete ${formatAlliance(target)}?`;
  if (target.isRoot && alliances.some((a) => a.familyId === target.familyId && a.type === "family" && a.id !== target.id))
    message += "\n\nThe strongest remaining family alliance will become the family's root.";
  return message;
}

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

// Families on a server: user-arranged position first, then their roots' order.
export function sortFamilies(families, alliances) {
  const rootOf = new Map(families.map((f) => [f.id, familyRoot(f.id, alliances)]));
  return [...families].sort((a, b) => {
    const pa = a.position ?? Infinity;
    const pb = b.position ?? Infinity;
    if (pa !== pb) return pa - pb;
    const ra = rootOf.get(a.id);
    const rb = rootOf.get(b.id);
    if (!ra || !rb) return ra ? -1 : rb ? 1 : 0;
    return byPower(ra, rb);
  });
}

// A family's alliances: its root, the other family alliances, then academies, in display order.
export function familyMembers(familyId, alliances) {
  const members = alliances.filter((a) => a.familyId === familyId);
  return {
    root: members.find((a) => a.isRoot) ?? null,
    families: members.filter((a) => a.type === "family" && !a.isRoot).sort(byOrder),
    academies: members.filter((a) => a.type === "academy").sort(byOrder),
  };
}
