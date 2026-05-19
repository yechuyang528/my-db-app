async function verifyToken(request) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.replace('Bearer ', '');
  const [payloadStr, signature] = token.split('.');
  if (!payloadStr || !signature) return null;
  const expectedSig = await hashPassword(payloadStr + 'token-secret');
  if (signature !== expectedSig) return null;
  try {
    const payload = JSON.parse(atob(payloadStr));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// GET /api/files?folder_id=xxx  列出某文件夹下的文件
// GET /api/files?id=xxx         获取单个文件详情
export async function onRequestGet(context) {
  const { request, env } = context;
  const user = await verifyToken(request);
  if (!user) return jsonResponse({ error: '未登录' }, 401);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const folderId = url.searchParams.get('folder_id');

  if (id) {
    const file = await env.DB.prepare(
      'SELECT * FROM files WHERE id = ? AND user_id = ?'
    ).bind(parseInt(id), user.userId).first();
    if (!file) return jsonResponse({ error: '文件不存在' }, 404);
    return jsonResponse({ file });
  }

  let query, params;
  if (folderId === null || folderId === '' || folderId === 'null') {
    query = 'SELECT id, name, created_at, updated_at FROM files WHERE user_id = ? AND folder_id IS NULL ORDER BY name';
    params = [user.userId];
  } else {
    query = 'SELECT id, name, created_at, updated_at FROM files WHERE user_id = ? AND folder_id = ? ORDER BY name';
    params = [user.userId, parseInt(folderId)];
  }

  const result = await env.DB.prepare(query).bind(...params).all();
  return jsonResponse({ files: result.results });
}

// POST /api/files  新建文件
export async function onRequestPost(context) {
  const { request, env } = context;
  const user = await verifyToken(request);
  if (!user) return jsonResponse({ error: '未登录' }, 401);

  const { name, folder_id, content } = await request.json();
  if (!name) return jsonResponse({ error: '文件名不能为空' }, 400);

  const result = await env.DB.prepare(
    'INSERT INTO files (user_id, folder_id, name, content) VALUES (?, ?, ?, ?)'
  ).bind(user.userId, folder_id || null, name, content || '[]').run();

  return jsonResponse({
    success: true,
    file: { id: result.meta.last_row_id, name, folder_id }
  });
}

// PUT /api/files  更新文件内容
export async function onRequestPut(context) {
  const { request, env } = context;
  const user = await verifyToken(request);
  if (!user) return jsonResponse({ error: '未登录' }, 401);

  const { id, name, content } = await request.json();
  if (!id) return jsonResponse({ error: '缺少id' }, 400);

  await env.DB.prepare(
    'UPDATE files SET name = ?, content = ?, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?'
  ).bind(name, content, parseInt(id), user.userId).run();

  return jsonResponse({ success: true });
}

// DELETE /api/files?id=xxx  删除文件
export async function onRequestDelete(context) {
  const { request, env } = context;
  const user = await verifyToken(request);
  if (!user) return jsonResponse({ error: '未登录' }, 401);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonResponse({ error: '缺少id' }, 400);

  await env.DB.prepare('DELETE FROM files WHERE id = ? AND user_id = ?')
    .bind(parseInt(id), user.userId).run();

  return jsonResponse({ success: true });
}

async function hashPassword(password) {
  const data = new TextEncoder().encode(password + 'my-db-app-salt-2026');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}