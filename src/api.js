// src/api.js
// API 调用封装 - 基于 Cookie 鉴权
// 浏览器会自动携带 HttpOnly session cookie，前端不需要也拿不到 token

const API_BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    credentials: 'same-origin', // 确保 cookie 跟着请求一起发
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('服务器返回了无效响应');
  }

  if (!res.ok) {
    const msg = data?.error || `请求失败 (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ===== 认证 =====

// 检查当前登录态。返回 user 对象 { id, email }；未登录时返回 null（不抛错，便于初始加载逻辑）
export async function me() {
  try {
    const data = await request('/me');
    return data.user;
  } catch (e) {
    if (e.status === 401) return null;
    throw e;
  }
}

// 登录。成功返回 { ok: true, user }，失败抛错（带 error 消息）
export async function login(email, password) {
  return await request('/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

// 注册并自动登录。成功返回 { ok: true, user }，失败抛错
export async function register(email, password) {
  return await request('/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

// 退出登录
export async function logout() {
  return await request('/logout', { method: 'POST' });
}

// ===== 数据库 & 记录 =====
// TODO（步骤 2）：listDatabases / createDatabase / listRecords / createRecord 等
// 等后端 /api/databases、/api/records 端点上线后再补