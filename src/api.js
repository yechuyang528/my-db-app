// API 调用封装

const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

function setToken(token) {
  localStorage.setItem('token', token);
}

function clearToken() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

function getUser() {
  const u = localStorage.getItem('user');
  return u ? JSON.parse(u) : null;
}

function setUser(user) {
  localStorage.setItem('user', JSON.stringify(user));
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API_BASE + path, { ...options, headers });
  const data = await res.json();

  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
      window.location.reload();
    }
    throw new Error(data.error || '请求失败');
  }
  return data;
}

// ===== 用户相关 =====
export async function register(email, password) {
  const data = await request('/register', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  setToken(data.token);
  setUser(data.user);
  return data;
}

export async function login(email, password) {
  const data = await request('/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  setToken(data.token);
  setUser(data.user);
  return data;
}

export function logout() {
  clearToken();
}

export function isLoggedIn() {
  return !!getToken();
}

export function currentUser() {
  return getUser();
}

// ===== 文件夹相关 =====
export async function listFolders(parentId = null) {
  const q = parentId ? `?parent_id=${parentId}` : '';
  const data = await request('/folders' + q);
  return data.folders;
}

export async function createFolder(name, parentId = null) {
  const data = await request('/folders', {
    method: 'POST',
    body: JSON.stringify({ name, parent_id: parentId })
  });
  return data.folder;
}

export async function deleteFolder(id) {
  return await request(`/folders?id=${id}`, { method: 'DELETE' });
}

// ===== 文件相关 =====
export async function listFiles(folderId = null) {
  const q = folderId ? `?folder_id=${folderId}` : '';
  const data = await request('/files' + q);
  return data.files;
}

export async function getFile(id) {
  const data = await request(`/files?id=${id}`);
  return data.file;
}

export async function createFile(name, content, folderId = null) {
  const data = await request('/files', {
    method: 'POST',
    body: JSON.stringify({ name, content, folder_id: folderId })
  });
  return data.file;
}

export async function updateFile(id, name, content) {
  return await request('/files', {
    method: 'PUT',
    body: JSON.stringify({ id, name, content })
  });
}

export async function deleteFile(id) {
  return await request(`/files?id=${id}`, { method: 'DELETE' });
}