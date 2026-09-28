const ADMIN_SESSION_KEY = "flixit_admin_session_nonce";
const ADMIN_SESSION_CREATED_KEY = "flixit_admin_session_created_at";

function randomHex(bytes = 32) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function createAdminSessionNonce() {
  return randomHex(32);
}

export function seedAdminSession(storage, nonce) {
  if (!storage || !nonce) return false;
  try {
    storage.setItem(ADMIN_SESSION_KEY, nonce);
    storage.setItem(ADMIN_SESSION_CREATED_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

export function activeAdminSessionNonce() {
  try {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
  } catch {
    return "";
  }
}

export function isActiveAdminSessionNonce(nonce) {
  if (!/^[a-f0-9]{64}$/i.test(String(nonce || ""))) return false;
  const active = activeAdminSessionNonce();
  if (!active || active.length !== nonce.length) return false;

  // Constant-work comparison: this nonce is not an auth secret, but avoid an
  // early-exit comparison because it costs nothing and keeps validation tidy.
  let mismatch = 0;
  for (let index = 0; index < active.length; index += 1) {
    mismatch |= active.charCodeAt(index) ^ String(nonce).charCodeAt(index);
  }
  return mismatch === 0;
}

export function adminSessionBase(nonce = activeAdminSessionNonce()) {
  return nonce ? `/admin/${nonce}` : "";
}

export function clearAdminSession() {
  try {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    sessionStorage.removeItem(ADMIN_SESSION_CREATED_KEY);
  } catch {}
}
