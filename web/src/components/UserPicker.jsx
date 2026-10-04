import { useEffect, useState } from "react";
import { createUser, listUsers } from "../api";

export default function UserPicker({ rememberedId, onChoose }) {
  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listUsers()
      .then((list) => {
        // Returning visitor: go straight to their graph.
        const remembered = list.find((u) => u.id === rememberedId);
        if (remembered) onChoose(remembered);
        else setUsers(list);
      })
      .catch(() => setLoadError("Could not load users from the server."));
  }, [rememberedId, onChoose]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name.");
      return;
    }
    if (Array.from(trimmed).length > 64) {
      setError("Name must be at most 64 characters.");
      return;
    }
    setSaving(true);
    try {
      onChoose(await createUser(trimmed));
    } catch (err) {
      setError(Object.values(err.errors).join(" "));
      setSaving(false);
    }
  };

  if (loadError) return <p className="error banner picker-status">{loadError}</p>;
  if (!users) return <p className="picker-status">Loading…</p>;

  return (
    <div className="picker">
      <h1>AllyGraph</h1>
      <p className="picker-intro">Choose whose graph to work on, or create a new user.</p>

      {users.length > 0 && (
        <section className="panel">
          <h2>Existing users</h2>
          <div className="user-list">
            {users.map((u) => (
              <button key={u.id} className="btn btn-user" onClick={() => onChoose(u)}>
                {u.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h2>New user</h2>
        <form className="button-row" onSubmit={handleCreate} noValidate>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoFocus={users.length === 0}
          />
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Creating…" : "Create user"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>
    </div>
  );
}
