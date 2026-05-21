// functions/api/login.js
// POST /api/login  body: { email, password }
// Verifies credentials and sets the session cookie.

import {
  verifyPassword,
  signSession,
  buildSessionCookie,
  json,
  jsonError,
  SESSION_TTL_SECONDS,
} from '../_lib.js';

// A precomputed dummy hash/salt used when the email doesn't exist —
// so the response time matches the real-verify path and attackers
// can't enumerate registered emails by timing the response.
const DUMMY_HASH = '0'.repeat(64);
const DUMMY_SALT = '0'.repeat(32);

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('Server misconfigured: missing DB binding', 500);
  if (!env.SESSION_SECRET) return jsonError('Server misconfigured: missing SESSION_SECRET', 500);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON'); }

  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');

  if (!email || !password) return jsonError('请提供邮箱和密码');

  const user = await env.DB.prepare(
    'SELECT id, email, password_hash, password_salt FROM users WHERE email = ?'
  ).bind(email).first();

  if (!user) {
    // Dummy verify to equalize timing — result discarded.
    await verifyPassword(password, DUMMY_HASH, DUMMY_SALT);
    return jsonError('邮箱或密码不正确', 401);
  }

  const ok = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!ok) return jsonError('邮箱或密码不正确', 401);

  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = await signSession({ uid: user.id, exp }, env.SESSION_SECRET);

  return json(
    { ok: true, user: { id: user.id, email: user.email } },
    { headers: { 'Set-Cookie': buildSessionCookie(token) } }
  );
}