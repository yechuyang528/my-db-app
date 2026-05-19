// 通用 token 验证
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

// GET /api/folders?parent_id=xxx  查询某层文件夹列表
export async function onRequestGet(context) {
  const { request, env } = context;
  const user = await verifyToken(request);
  if (!user) return jsonResponse({ error: '未登录' }, 401);

  const url = new URL(request.url);
  const parentId = url.searchParams.get('parent_id');

  let query, params;
  if (parentId === null || parentId === '' || parentId === 'null') {
    query = 'SELECT * FROM folders WHERE user_id = ? AND parent_id IS NULL ORDER BY name';
    params = [user.userId];
  } else {
    query = 'SELECT * FROM folders WHERE user_id = ? AND parent_id = ? ORDER BY name';
    params = [user.userId, parseInt(parentId)];
  }

  const result = await env.DB.prepare(query).bind(...params).all();
  return jsonResponse({ folders: result.results });
}

// POST /api/folders  新建文件夹
export async function onRequestPost(context) {
  const { request, env } = context;
  const user = await verifyToken(request);
  if (!user) return jsonResponse({ error: '未登录' }, 401);

  const { name, parent_id } = await request.json();
  if (!name) return jsonResponse({ error: '文件夹名称不能为空' }, 400);

  // 限制5层深度
  if (parent_id) {
    const depth = await getFolderDepth(env.DB, parent_id);
    if (depth >= 5) return jsonResponse({ error: '最多支持5层文件夹' }, 400);
  }

  const result = await env.DB.prepare(
    'INSERT INTO folders (user_id, parent_id, name) VALUES (?, ?, ?)'
  ).bind(user.userId, parent_id || null, name).run();

  return jsonResponse({
    success: true,
    folder: { id: result.meta.last_row_id, name, parent_id }
  });
}

// DELETE /api/folders?id=xxx  删除文件夹（连同里面所有内容）
export async function onRequestDelete(context) {
  const { request, env } = context;
  const user = await verifyToken(request);
  if (!user) return jsonResponse({ error: '未登录' }, 401);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonResponse({ error: '缺少id' }, 400);

  // 递归删除子文件夹和文件
  await deleteRecursive(env.DB, parseInt(id), user.userId);

  return jsonResponse({ success: true });
}

async function deleteRecursive(db, folderId, userId) {
  // 删除子文件夹
  const subFolders = await db.prepare(
    'SELECT id FROM folders WHERE parent_id = ? AND user_id = ?'
  ).bind(folderId, userId).all();

  for (const f of subFolders.results) {
    await deleteRecursive(db, f.id, userId);
  }

  // 删除该文件夹下的文件
  await db.prepare('DELETE FROM files WHERE folder_id = ? AND user_id = ?')
    .bind(folderId, userId).run();

  // 删除文件夹本身
  await db.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?')
    .bind(folderId, userId).run();
}

async function getFolderDepth(db, folderId) {
  let depth = 1;
  let current = folderId;
  while (current) {
    const parent = await db.prepare('SELECT parent_id FROM folders WHERE id = ?')
      .bind(current).first();
    if (!parent || !parent.parent_id) break;
    depth++;
    current = parent.parent_id;
    if (depth > 10) break; // 防止死循环
  }
  return depth;
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