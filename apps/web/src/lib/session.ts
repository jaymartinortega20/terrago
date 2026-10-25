/**
 * A hint (not the session itself — that is an HttpOnly cookie) that this browser
 * is logged in, so Play can go straight to the login page when it isn't,
 * instead of waiting on the server.
 */
const KEY = 'terrago:signed-in';

export function markSignedIn(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked: Play just takes the slower path
  }
}

export function seemsSignedIn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true;
  }
}
