import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
  listFolders, createFolder, deleteFolder,
  listFiles, createFile, getFile, updateFile, deleteFile,
  logout, currentUser
} from '../api';

export default function Dashboard({ onLogout }) {
  const [path, setPath] = useState([{ id: null, name: '根目录' }]); // 面包屑路径
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingFile, setEditingFile] = useState(null); // 当前正在编辑的文件
  const user = currentUser();

  const currentFolderId = path[path.length - 1].id;
  const currentDepth = path.length - 1;

  useEffect(() => {
    loadContents();
  }, [currentFolderId]);

  async function loadContents() {
    setLoading(true);
    try {
      const [fd, fl] = await Promise.all([
        listFolders(currentFolderId),
        listFiles(currentFolderId)
      ]);
      setFolders(fd);
      setFiles(fl);
    } catch (e) {
      alert('加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleNewFolder() {
    const name = prompt('新文件夹名称：');
    if (!name) return;
    try {
      await createFolder(name, currentFolderId);
      loadContents();
    } catch (e) {
      alert('创建失败: ' + e.message);
    }
  }

  async function handleDeleteFolder(id, name) {
    if (!confirm(`确定删除文件夹"${name}"及其所有内容吗？`)) return;
    try {
      await deleteFolder(id);
      loadContents();
    } catch (e) {
      alert('删除失败: ' + e.message);
    }
  }

  async function handleDeleteFile(id, name) {
    if (!confirm(`确定删除文件"${name}"吗？`)) return;
    try {
      await deleteFile(id);
      loadContents();
    } catch (e) {
      alert('删除失败: ' + e.message);
    }
  }

  function enterFolder(folder) {
    setPath([...path, { id: folder.id, name: folder.name }]);
  }

  function goToPath(index) {
    setPath(path.slice(0, index + 1));
  }

  async function handleNewFile() {
    const name = prompt('新表格名称：');
    if (!name) return;
    try {
      const file = await createFile(name, '[["列1","列2","列3"],["","",""]]', currentFolderId);
      const fullFile = await getFile(file.id);
      setEditingFile(fullFile);
    } catch (e) {
      alert('创建失败: ' + e.message);
    }
  }

  async function handleUploadExcel(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        await createFile(file.name, JSON.stringify(data), currentFolderId);
        loadContents();
        alert('上传成功！');
      } catch (err) {
        alert('上传失败: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  async function handleOpenFile(id) {
    try {
      const file = await getFile(id);
      setEditingFile(file);
    } catch (e) {
      alert('打开失败: ' + e.message);
    }
  }

  function handleLogout() {
    if (confirm('确定退出登录？')) {
      logout();
      onLogout();
    }
  }

  if (editingFile) {
    return <TableEditor
      file={editingFile}
      onClose={() => { setEditingFile(null); loadContents(); }}
    />;
  }

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h2 style={{ margin: 0 }}>📁 我的数据库</h2>
        <div>
          <span style={{ marginRight: 15, color: '#666' }}>{user?.email}</span>
          <button onClick={handleLogout} style={styles.btnSecondary}>退出</button>
        </div>
      </header>

      <div style={styles.breadcrumb}>
        {path.map((p, i) => (
          <span key={i}>
            <a onClick={() => goToPath(i)} style={styles.crumb}>{p.name}</a>
            {i < path.length - 1 && <span style={{ margin: '0 8px', color: '#999' }}>/</span>}
          </span>
        ))}
      </div>

      <div style={styles.toolbar}>
        <button
          onClick={handleNewFolder}
          style={styles.btn}
          disabled={currentDepth >= 5}
          title={currentDepth >= 5 ? '已达到最大深度5层' : ''}
        >
          📁 新建文件夹
        </button>
        <button onClick={handleNewFile} style={styles.btn}>📊 新建表格</button>
        <label style={{ ...styles.btn, cursor: 'pointer' }}>
          📤 上传Excel
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleUploadExcel}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {loading ? (
        <div style={styles.empty}>加载中...</div>
      ) : (folders.length === 0 && files.length === 0) ? (
        <div style={styles.empty}>此文件夹为空，新建一些内容吧</div>
      ) : (
        <div style={styles.grid}>
          {folders.map(f => (
            <div key={'folder-' + f.id} style={styles.card}>
              <div onClick={() => enterFolder(f)} style={styles.cardContent}>
                <div style={styles.icon}>📁</div>
                <div style={styles.name}>{f.name}</div>
              </div>
              <button
                onClick={() => handleDeleteFolder(f.id, f.name)}
                style={styles.delBtn}
              >×</button>
            </div>
          ))}
          {files.map(f => (
            <div key={'file-' + f.id} style={styles.card}>
              <div onClick={() => handleOpenFile(f.id)} style={styles.cardContent}>
                <div style={styles.icon}>📊</div>
                <div style={styles.name}>{f.name}</div>
              </div>
              <button
                onClick={() => handleDeleteFile(f.id, f.name)}
                style={styles.delBtn}
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== 表格编辑器组件 =====
function TableEditor({ file, onClose }) {
  const [data, setData] = useState(() => {
    try { return JSON.parse(file.content); }
    catch { return [['列1', '列2']]; }
  });
  const [name, setName] = useState(file.name);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  function updateCell(r, c, val) {
    const newData = data.map((row, i) =>
      i === r ? row.map((cell, j) => j === c ? val : cell) : row
    );
    setData(newData);
  }

  function addRow() {
    const cols = data[0]?.length || 1;
    setData([...data, new Array(cols).fill('')]);
  }

  function addCol() {
    setData(data.map(row => [...row, '']));
  }

  function delRow(r) {
    if (data.length <= 1) return;
    setData(data.filter((_, i) => i !== r));
  }

  function delCol(c) {
    if (data[0].length <= 1) return;
    setData(data.map(row => row.filter((_, j) => j !== c)));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateFile(file.id, name, JSON.stringify(data));
      alert('保存成功');
    } catch (e) {
      alert('保存失败: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, name.endsWith('.xlsx') ? name : name + '.xlsx');
  }

  // 筛选行（第一行作为表头不参与筛选）
  const filteredRows = filter
    ? data.slice(1).filter(row =>
        row.some(cell => String(cell).toLowerCase().includes(filter.toLowerCase()))
      )
    : data.slice(1);

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={styles.nameInput}
        />
        <div>
          <button onClick={handleSave} disabled={saving} style={styles.btn}>
            {saving ? '保存中...' : '💾 保存'}
          </button>
          <button onClick={handleExport} style={styles.btn}>📥 导出Excel</button>
          <button onClick={onClose} style={styles.btnSecondary}>← 返回</button>
        </div>
      </header>

      <div style={{ padding: '10px 20px' }}>
        <input
          type="text"
          placeholder="🔍 筛选内容..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ ...styles.input, maxWidth: 300 }}
        />
        <span style={{ marginLeft: 15, color: '#666' }}>
          共 {data.length - 1} 行，显示 {filteredRows.length} 行
        </span>
      </div>

      <div style={{ padding: 20, overflowX: 'auto' }}>