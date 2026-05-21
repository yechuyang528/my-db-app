// functions/api/me.js
// GET /api/me
// Returns the logged-in user's info, or 401 if not logged in.
// The frontend uses this on page load to know whether to show login UI or the app.

import { getUserFromRequest, json, jsonError } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  if (!env.DB) return jsonError('Server misconfigured: missing DB binding', 500);
  if (!env.SESSION_SECRET) return jsonError('Server misconfigured: missing SESSION_SECRET', 500);

  const user = await getUserFromRequest(request, env);
  if (!user) return jsonError('未登录', 401);
  return json({ ok: true, user });
}