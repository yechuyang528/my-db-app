// functions/_lib.js
// Shared auth utilities: password hashing (PBKDF2) + session cookie (HMAC-SHA256).
// Files starting with "_" in Cloudflare Pages Functions are NOT routes — safe to put helpers here.

const PBKDF2_ITERATIONS = 100_000;
const SESSION_COOKIE_NAME = 'session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- encoding helpers ----------

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToBase64Url(bytes) {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- password hashing (PBKDF2-SHA256) ----------

export async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hashBytes = await pbkdf2(password, saltBytes);
  return { hash: bytesToHex(hashBytes), salt: bytesToHex(saltBytes) };
}

export async function verifyPassword(password, hashHex, saltHex) {
  const saltBytes = hexToBytes(saltHex);
  const candidate = new Uint8Array(await pbkdf2(password, saltBytes));
  return constantTimeEqual(candidate, hexToBytes(hashHex));
}

async function pbkdf2(password, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------- session cookie (HMAC-SHA256 signed) ----------

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

export async function signSession(payload, secret) {
  const payloadB64 = bytesToBase64Url(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  return `${payloadB64}.${bytesToBase64Url(sigBytes)}`;
}

export async function verifySession(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const key = await hmacKey(secret);
  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      'HMAC', key, base64UrlToBytes(sigB64), enc.encode(payloadB64)
    );
  } catch {
    return null;
  }
  if (!ok) return null;
  let payload;
  try {
    payload = JSON.parse(dec.decode(base64UrlToBytes(payloadB64)));
  } catch {
    return null;
  }
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}

// ---------- cookie helpers ----------

export function buildSessionCookie(token) {
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ].join('; ');
}

export function buildLogoutCookie() {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');
}

function readSessionCookie(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

// ---------- get user from request ----------

export async function getUserFromRequest(request, env) {
  const token = readSessionCookie(request);
  if (!token) return null;
  const payload = await verifySession(token, env.SESSION_SECRET);
  if (!payload || !payload.uid) return null;
  const user = await env.DB.prepare(
    'SELECT id, email FROM users WHERE id = ?'
  ).bind(payload.uid).first();
  return user || null;
}

// ---------- response helpers ----------

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init.headers || {}),
    },
  });
}

export function jsonError(message, status = 400) {
  return json({ ok: false, error: message }, { status });
}