import { useCallback, useState } from "react";
import UserPicker from "./components/UserPicker";
import Workspace from "./Workspace";

// The chosen user is remembered per browser. Storage can be unavailable (private mode etc.),
// in which case the picker simply shows on every visit.
const STORAGE_KEY = "allygraph.userId";

const storage = {
  get: () => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  set: (id) => {
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Not remembering the user is fine.
    }
  },
};

export default function App() {
  const [user, setUser] = useState(null);

  const chooseUser = useCallback((u) => {
    storage.set(u.id);
    setUser(u);
  }, []);

  const switchUser = useCallback(() => {
    storage.set(null);
    setUser(null);
  }, []);

  if (!user) return <UserPicker rememberedId={storage.get()} onChoose={chooseUser} />;
  // key: remount on user change so no state leaks from one user's graph to the next.
  return <Workspace key={user.id} user={user} onSwitchUser={switchUser} />;
}
