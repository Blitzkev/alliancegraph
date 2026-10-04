async function request(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error("Request failed");
    err.errors = body.errors || { _: `Server error (${res.status})` };
    throw err;
  }
  return body;
}

export const listAlliances = () => request("/api/alliances");

export const createAlliance = (alliance) =>
  request("/api/alliances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(alliance),
  });

export const deleteAlliance = (id) =>
  request(`/api/alliances/${encodeURIComponent(id)}`, { method: "DELETE" });
