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

// Display order: user-arranged position first, then name for anything not yet arranged.
export const byOrder = (a, b) =>
  (a.position ?? Infinity) - (b.position ?? Infinity) ||
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
