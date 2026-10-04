export const TYPE_LABELS = { root: "Root", family: "Family", academy: "Academy" };

export const formatAlliance = (a) => `[#${a.tag}][#${a.server}]${a.name}`;

// Count code points, not UTF-16 units, so limits match the server.
export const charLength = (s) => Array.from(s).length;
