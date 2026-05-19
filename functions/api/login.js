export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return jsonResponse({ error: '邮箱和密码不能为空' }, 400);
    }

    const passwordHash = await hashPassword(password);
    const user = await env.DB.prepare(
      'SELECT id, email FROM users WHERE email = ? AND password_hash = ?'
    ).bind(email, passwordHash).first();

    if (!user) {
      return jsonResponse({ error: '邮箱或密码错误' }, 401);
    }

    const token = await generateToken(user.id, user.email);
    return jsonResponse({ success: true, token, user });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

async function hashPassword(password) {
  const data = new TextEncoder().encode(password + 'my-db-app-salt-2026');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

async function generateToken(userId, email) {
  const payload = { userId, email, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 };
  const payloadStr = btoa(JSON.stringify(payload));
  const signature = await hashPassword(payloadStr + 'token-secret');
  return `${payloadStr}.${signature}`;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}