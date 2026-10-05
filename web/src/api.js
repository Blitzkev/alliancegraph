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

// collection: "alliances" | "families" | "academies"
export const createItem = (userId, collection, fields) => post(`${userBase(userId)}/${collection}`, fields);
export const updateItem = (userId, collection, id, fields) =>
  patch(`${userBase(userId)}/${collection}/${encodeURIComponent(id)}`, fields);
export const deleteItem = (userId, collection, id) =>
  del(`${userBase(userId)}/${collection}/${encodeURIComponent(id)}`);

export const reorderAlliances = (userId, ids) => put(`${userBase(userId)}/alliances/order`, { ids });
