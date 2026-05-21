// functions/api/register.js
// POST /api/register  body: { email, password }
// Creates a new user, auto-logs them in by setting the session cookie.

import {
  hashPassword,
  signSession,
  buildSessionCookie,
  json,
  jsonError,
  SESSION_TTL_SECONDS,
} from '../_lib.js';

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('Server misconfigured: missing DB binding', 500);
  if (!env.SESSION_SECRET) return jsonError('Server misconfigured: missing SESSION_SECRET', 500);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON'); }

  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');

  if (!email || !email.includes('@') || email.length > 200) {
    return jsonError('请提供有效的邮箱');
  }
  if (password.length < 8) return jsonError('密码至少 8 位');
  if (password.length > 200) return jsonError('密码过长');

  // Check email not already taken
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).bind(email).first();
  if (existing) return jsonError('该邮箱已被注册', 409);

  // Hash and insert
  const { hash, salt } = await hashPassword(password);
  const result = await env.DB.prepare(
    'INSERT INTO users (email, password_hash, password_salt) VALUES (?, ?, ?)'
  ).bind(email, hash, salt).run();

  const userId = result.meta.last_row_id;

  // Auto-login
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = await signSession({ uid: userId, exp }, env.SESSION_SECRET);

  return json(
    { ok: true, user: { id: userId, email } },
    { headers: { 'Set-Cookie': buildSessionCookie(token) } }
  );
}