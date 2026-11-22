/** The signed-in player, kept in this browser. Only the session token is secret; it never leaves this site. */
export interface Session {
  token: string;
  username: string;
  wallet: string;
}

const KEY = 'heistmas.session.v1';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return s && typeof s.token === 'string' && typeof s.username === 'string' ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the session lasts until the tab closes */
  }
}
