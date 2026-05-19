// 用户注册接口
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { email, password } = await request.json();

    // 简单校验
    if (!email || !password) {
      return jsonResponse({ error: '邮箱和密码不能为空' }, 400);
    }
    if (password.length < 6) {
      return jsonResponse({ error: '密码至少6位' }, 400);
    }

    // 检查邮箱是否已注册
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email).first();
    if (existing) {
      return jsonResponse({ error: '该邮箱已注册' }, 400);
    }

    // 加密密码（用Web Crypto API做SHA-256）
    const passwordHash = await hashPassword(password);

    // 插入用户
    const result = await env.DB.prepare(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)'
    ).bind(email, passwordHash).run();

    // 生成 token
    const token = await generateToken(result.meta.last_row_id, email);

    return jsonResponse({
      success: true,
      token,
      user: { id: result.meta.last_row_id, email }
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ===== 工具函数 =====
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