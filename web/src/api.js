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

const post = (url, body) =>
  request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const del = (url) => request(url, { method: "DELETE" });

export const listUsers = () => request("/api/users");
export const createUser = (name) => post("/api/users", { name });

const userBase = (userId) => `/api/users/${encodeURIComponent(userId)}`;

export const listServers = (userId) => request(`${userBase(userId)}/servers`);
export const createServer = (userId, number) => post(`${userBase(userId)}/servers`, { number });
export const deleteServer = (userId, number) =>
  del(`${userBase(userId)}/servers/${encodeURIComponent(number)}`);

export const listAlliances = (userId) => request(`${userBase(userId)}/alliances`);
export const createAlliance = (userId, alliance) => post(`${userBase(userId)}/alliances`, alliance);
export const deleteAlliance = (userId, id) =>
  del(`${userBase(userId)}/alliances/${encodeURIComponent(id)}`);
export const updateAlliance = (userId, id, fields) =>
  request(`${userBase(userId)}/alliances/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
