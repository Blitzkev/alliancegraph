async function request(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error("Request failed");
    err.status = res.status;
    err.errors = body.errors || { _: `Server error (${res.status})` };
    throw err;
  }
  return body;
}

const json = (method) => (url, body) =>
  request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const post = json("POST");
const put = json("PUT");
const patch = json("PATCH");
const del = (url) => request(url, { method: "DELETE" });

export const listUsers = () => request("/api/users");
export const createUser = (name) => post("/api/users", { name });

const userBase = (userId) => `/api/users/${encodeURIComponent(userId)}`;

// { servers, families, academies, alliances }
export const getGraph = (userId) => request(`${userBase(userId)}/graph`);

export const createServer = (userId, number) => post(`${userBase(userId)}/servers`, { number });
export const deleteServer = (userId, number) =>
  del(`${userBase(userId)}/servers/${encodeURIComponent(number)}`);

export const createAlliance = (userId, fields) => post(`${userBase(userId)}/alliances`, fields);
export const updateAlliance = (userId, id, fields) =>
  patch(`${userBase(userId)}/alliances/${encodeURIComponent(id)}`, fields);

// academies: undefined | "delete" | "detach" | { moveTo: familyId }. Needed when deleting a family's
// last member while it still has academies (the server answers 409 otherwise).
export const deleteAlliance = (userId, id, academies) => {
  const params = new URLSearchParams();
  if (academies === "delete" || academies === "detach") params.set("academies", academies);
  else if (academies?.moveTo) {
    params.set("academies", "move");
    params.set("moveTo", academies.moveTo);
  }
  const query = params.toString() ? `?${params}` : "";
  return del(`${userBase(userId)}/alliances/${encodeURIComponent(id)}${query}`);
};

export const reorderAlliances = (userId, ids) => put(`${userBase(userId)}/alliances/order`, { ids });

// items: [{ kind: "family" | "academy" | "alliance", id, x, y }]; null x/y forgets a dragged spot.
export const saveLayout = (userId, items) => put(`${userBase(userId)}/layout`, { items });
