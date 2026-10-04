import { useEffect, useState } from "react";
import { createServer } from "../api";

export default function ServerModal({ userId, onSaved, onClose }) {
  const [number, setNumber] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!/^[0-9]{4}$/.test(number.trim())) {
      setError("Server must be exactly 4 digits (e.g. 0042).");
      return;
    }
    setSaving(true);
    try {
      onSaved(await createServer(userId, number.trim()));
    } catch (err) {
      setError(Object.values(err.errors).join(" "));
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal modal-server" onSubmit={handleSubmit} noValidate>
        <h2>New Server/Kingdom</h2>
        <label>
          Server number <small>(4 digits)</small>
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            inputMode="numeric"
            maxLength={4}
            placeholder="0000"
            autoFocus
          />
          {error && <span className="error">{error}</span>}
        </label>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save Server"}
          </button>
        </div>
      </form>
    </div>
  );
}
