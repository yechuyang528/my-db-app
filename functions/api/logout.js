// functions/api/logout.js
// POST /api/logout
// Clears the session cookie. Always returns ok — logout is idempotent.

import { buildLogoutCookie, json } from '../_lib.js';

export async function onRequestPost() {
  return json(
    { ok: true },
    { headers: { 'Set-Cookie': buildLogoutCookie() } }
  );
}