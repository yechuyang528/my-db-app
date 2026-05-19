/* ============================================================
 * 数据库系统  ·  完整保真导入版（含尺寸可调）
 *
 * 依赖：npm install xlsx
 *
 * 新增能力：
 *   1. 整个系统的宽高可拖拽调节（右下角拖拽手柄）
 *   2. 左侧库目录宽度可拖拽调节（侧边栏右边缘）
 *   3. 库目录内部"未分组区"和"文件夹区"上下比例可调
 *   4. 文件夹删除按钮显眼化（hover 出现红色"🗑 删除"按钮）
 * ============================================================ */

import { useState, useEffect, useMemo, useRef } from "react";

/* ============================================================
   常量 & 工具函数
   ============================================================ */

const FIELD_TYPES = ["文本", "数字", "日期", "布尔值", "邮箱", "URL"];
const typeIcon = { "文本": "T", "数字": "#", "日期": "D", "布尔值": "B", "邮箱": "@", "URL": "L" };
const PAGE_SIZES = [25, 50, 100, 200, 500];

const defaultValueFor = (type) => {
  if (type === "数字") return 0;
  if (type === "布尔值") return false;
  if (type === "日期") return new Date().toISOString().split("T")[0];
  return "";
};

const validate = (val, type) => {
  if (val === "" || val === null || val === undefined) return type === "布尔值";
  if (type === "数字") return !isNaN(Number(val));
  if (type === "邮箱") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
  if (type === "URL") { try { new URL(val); return true; } catch { return false; } }
  return true;
};

const matchesFilter = (record, filter) => {
  const { field, op, value } = filter;
  const rv = record[field];
  if (rv === undefined || rv === null) return false;
  const rv2 = String(rv).toLowerCase();
  const v2 = String(value).toLowerCase();
  if (op === "包含") return rv2.includes(v2);
  if (op === "等于") return rv2 === v2;
  if (op === "大于") return Number(rv) > Number(value);
  if (op === "小于") return Number(rv) < Number(value);
  if (op === "不含") return !rv2.includes(v2);
  return true;
};

/* -------- CSV/TSV 解析 -------- */
function parseDelimited(text, delim = ",") {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delim) { row.push(cell); cell = ""; }
      else if (c === '\n' || c === '\r') {
        if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); row = []; cell = ""; }
        if (c === '\r' && text[i + 1] === '\n') i++;
      } else cell += c;
    }
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 5).filter(Boolean);
  const candidates = [",", "\t", ";", "|"];
  let best = ",", bestScore = -1;
  for (const d of candidates) {
    const counts = sample.map(l => (l.match(new RegExp(d === "\t" ? "\\t" : "\\" + d, "g")) || []).length);
    if (counts[0] === 0) continue;
    const consistent = counts.every(c => c === counts[0]);
    const score = counts[0] * (consistent ? 10 : 1);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function detectFieldType(samples) {
  const dateCount = samples.filter(v => v instanceof Date).length;
  if (dateCount > 0 && dateCount === samples.filter(v => v !== "" && v !== null && v !== undefined).length) return "日期";

  const non = samples.filter(v => v !== "" && v !== null && v !== undefined).map(v => String(v).trim());
  if (non.length === 0) return "文本";

  const distinct = new Set(non.map(v => v.toLowerCase()));
  const boolSet = new Set(["true", "false", "yes", "no", "是", "否", "y", "n"]);
  if ([...distinct].every(v => boolSet.has(v)) && distinct.size <= 2) return "布尔值";

  if (non.every(v => v !== "" && !isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v)
        && !(v.length > 1 && /^0\d/.test(v)) && v.replace(/[^\d]/g, "").length <= 15)) return "数字";

  if (non.every(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) return "邮箱";

  if (non.every(v => /^https?:\/\//i.test(v))) return "URL";

  const dateRe = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/;
  if (non.every(v => dateRe.test(v) || !isNaN(Date.parse(v))) && non.some(v => dateRe.test(v))) return "日期";

  return "文本";
}

function coerceValue(raw, type, fidelity = false) {
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, "0");
    const d = String(raw.getDate()).padStart(2, "0");
    raw = `${y}-${m}-${d}`;
  }
  if (raw && typeof raw === "object" && !(raw instanceof Date)) {
    if (Array.isArray(raw)) {
      raw = raw.map(p => (p && typeof p === "object" ? (p.t || p.v || "") : String(p))).join("");
    } else if ("w" in raw) raw = raw.w;
    else if ("v" in raw) raw = raw.v;
    else if ("t" in raw) raw = raw.t;
    else raw = "";
  }

  if (fidelity) {
    if (raw === undefined || raw === null) return "";
    return typeof raw === "boolean" ? (raw ? "TRUE" : "FALSE") : String(raw);
  }

  if (raw === undefined || raw === null || raw === "") {
    return type === "布尔值" ? false : (type === "数字" ? 0 : "");
  }
  if (type === "数字") { const n = Number(raw); return isNaN(n) ? String(raw) : n; }
  if (type === "布尔值") {
    if (typeof raw === "boolean") return raw;
    const s = String(raw).trim().toLowerCase();
    return ["true", "yes", "是", "1", "y"].includes(s);
  }
  if (type === "日期") {
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const t = Date.parse(s);
    if (!isNaN(t)) return new Date(t).toISOString().split("T")[0];
    return s;
  }
  return String(raw);
}

function normalizeTypeLabel(s) {
  const k = String(s || "").trim().toLowerCase();
  const map = {
    "text": "文本", "string": "文本", "str": "文本", "文本": "文本", "字符串": "文本",
    "number": "数字", "num": "数字", "int": "数字", "integer": "数字", "float": "数字", "数字": "数字", "数": "数字",
    "date": "日期", "datetime": "日期", "日期": "日期", "时间": "日期",
    "bool": "布尔值", "boolean": "布尔值", "布尔": "布尔值", "布尔值": "布尔值",
    "email": "邮箱", "邮箱": "邮箱", "邮件": "邮箱",
    "url": "url", "link": "url", "链接": "url"
  };
  const v = map[k];
  if (v === "url") return "URL";
  return v || "文本";
}

function parseBulkFields(text) {
  return text.split(/\n+/).map(l => l.trim()).filter(Boolean).map(line => {
    let m = line.match(/^(.+?)\s*[:：]\s*(.+)$/);
    if (m) return { name: m[1].trim(), type: normalizeTypeLabel(m[2]) };
    m = line.match(/^(.+?)\s*[((]\s*(.+?)\s*[))]\s*$/);
    if (m) return { name: m[1].trim(), type: normalizeTypeLabel(m[2]) };
    return { name: line, type: "文本" };
  });
}

/* ============================================================
   IndexedDB 封装
   ============================================================ */

const IDB_NAME = "claudeDBSystem";
const IDB_VERSION = 1;
const META_STORE = "meta";
const RECORDS_STORE = "records";

let _idbPromise = null;
function openIDB() {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "name" });
      }
      if (!db.objectStoreNames.contains(RECORDS_STORE)) {
        const s = db.createObjectStore(RECORDS_STORE, { keyPath: "_id", autoIncrement: true });
        s.createIndex("dbName", "dbName", { unique: false });
      }
    };
  });
  return _idbPromise;
}

async function idbAllMeta() {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readonly");
    const req = tx.objectStore(META_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function idbPutMeta(meta) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDeleteDb(name) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, RECORDS_STORE], "readwrite");
    tx.objectStore(META_STORE).delete(name);
    const idx = tx.objectStore(RECORDS_STORE).index("dbName");
    const req = idx.openCursor(IDBKeyRange.only(name));
    req.onsuccess = (e) => { const c = e.target.result; if (c) { c.delete(); c.continue(); } };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbAddRecord(dbName, rec) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDS_STORE, "readwrite");
    const req = tx.objectStore(RECORDS_STORE).add({ ...rec, dbName });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbBulkAdd(dbName, records, onProgress) {
  const db = await openIDB();
  const CHUNK = 1000;
  let done = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(RECORDS_STORE, "readwrite");
      const store = tx.objectStore(RECORDS_STORE);
      chunk.forEach(r => store.add({ ...r, dbName }));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    done += chunk.length;
    if (onProgress) onProgress(done, records.length);
  }
}
async function idbAllRecords(dbName) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDS_STORE, "readonly");
    const idx = tx.objectStore(RECORDS_STORE).index("dbName");
    const req = idx.getAll(IDBKeyRange.only(dbName));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function idbCountRecords(dbName) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDS_STORE, "readonly");
    const idx = tx.objectStore(RECORDS_STORE).index("dbName");
    const req = idx.count(IDBKeyRange.only(dbName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDeleteRecord(id) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDS_STORE, "readwrite");
    tx.objectStore(RECORDS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbClearRecords(dbName) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDS_STORE, "readwrite");
    const idx = tx.objectStore(RECORDS_STORE).index("dbName");
    const req = idx.openCursor(IDBKeyRange.only(dbName));
    req.onsuccess = (e) => { const c = e.target.result; if (c) { c.delete(); c.continue(); } };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function migrateFromLocalStorage() {
  try {
    const v = localStorage.getItem("dbs");
    if (!v) return;
    const old = JSON.parse(v);
    const existing = await idbAllMeta();
    const exists = new Set(existing.map(m => m.name));
    for (const [name, data] of Object.entries(old)) {
      if (exists.has(name)) continue;
      await idbPutMeta({ name, fields: data.fields });
      if (data.records && data.records.length) {
        await idbBulkAdd(name, data.records.map(r => { const { _id, ...rest } = r; return rest; }));
      }
    }
    localStorage.removeItem("dbs");
  } catch (e) { console.warn("迁移失败", e); }
}

/* -------- SheetJS 动态加载 -------- */
let _xlsxModulePromise = null;
async function loadXLSX() {
  if (!_xlsxModulePromise) {
    _xlsxModulePromise = import("xlsx").catch((e) => {
      _xlsxModulePromise = null;
      console.error("xlsx 加载失败：", e);
      throw new Error("解析 Excel 需要 xlsx 库，请先运行：npm install xlsx");
    });
  }
  return _xlsxModulePromise;
}

/* ============================================================
   核心：按工作表真实范围构建完整二维网格
   ============================================================ */
function buildFullGrid(XLSX, sheet, fidelity) {
  const ref = sheet["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const nRows = range.e.r - range.s.r + 1;
  const nCols = range.e.c - range.s.c + 1;
  const grid = Array.from({ length: nRows }, () => Array(nCols).fill(""));

  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = sheet[addr];
      if (!cell) continue;
      let val;
      if (fidelity) {
        if (cell.w !== undefined && cell.w !== null) val = cell.w;
        else if (cell.v instanceof Date) {
          const d = cell.v;
          val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        } else val = cell.v;
      } else {
        val = cell.v !== undefined ? cell.v : (cell.w !== undefined ? cell.w : "");
      }
      grid[R - range.s.r][C - range.s.c] = val ?? "";
    }
  }

  const merges = sheet["!merges"] || [];
  for (const m of merges) {
    const top = grid[m.s.r - range.s.r]?.[m.s.c - range.s.c];
    if (top === undefined) continue;
    for (let R = m.s.r; R <= m.e.r; R++) {
      for (let C = m.s.c; C <= m.e.c; C++) {
        const gr = R - range.s.r, gc = C - range.s.c;
        if (grid[gr]) grid[gr][gc] = top;
      }
    }
  }
  return grid;
}

function detectHeaderRow(rows) {
  const scanLimit = Math.min(rows.length, 10);
  const maxCols = Math.max(...rows.slice(0, scanLimit).map(r => r.length));
  let bestIdx = 0, bestScore = -Infinity;
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i];
    const nonEmpty = row.filter(c => c !== "" && c !== null && c !== undefined);
    if (nonEmpty.length === 0) continue;
    const stringCells = nonEmpty.filter(c => typeof c === "string" && String(c).trim().length > 0 && String(c).trim().length < 50);
    const fillRatio = row.length / maxCols;
    const stringRatio = stringCells.length / nonEmpty.length;
    const score = fillRatio * 2 + stringRatio * 3 - i * 0.1;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

function sheetToTable(XLSX, sheet, sourceTag, options = {}) {
  const fidelity = options.fidelity !== false;
  const headerMode = options.headerMode || "auto";
  const keepBlankRows = options.keepBlankRows !== undefined
    ? options.keepBlankRows : fidelity;

  let grid = buildFullGrid(XLSX, sheet, fidelity);
  const totalRowsInSheet = grid.length;
  if (totalRowsInSheet === 0) throw new Error(`${sourceTag} 为空`);

  let filteredBlankCount = 0;
  if (!keepBlankRows) {
    const before = grid.length;
    grid = grid.filter(r => r.some(c => c !== "" && c !== null && c !== undefined));
    filteredBlankCount = before - grid.length;
  }
  if (grid.length === 0) throw new Error(`${sourceTag} 没有有效数据行`);

  const maxCols = Math.max(...grid.map(r => r.length));

  let headerRowIdx;
  if (headerMode === "none") headerRowIdx = -1;
  else if (headerMode === "manual" && typeof options.headerRow === "number"
           && options.headerRow >= 0 && options.headerRow < grid.length) {
    headerRowIdx = options.headerRow;
  } else {
    headerRowIdx = detectHeaderRow(grid);
  }

  let headers, dataRows;
  if (headerRowIdx === -1) {
    headers = Array.from({ length: maxCols }, (_, i) => `列${i + 1}`);
    dataRows = grid;
  } else {
    const headerRow = grid[headerRowIdx] || [];
    headers = headerRow.map((h, i) => {
      const s = String(h ?? "").trim();
      return s || `字段${i + 1}`;
    });
    while (headers.length < maxCols) headers.push(`字段${headers.length + 1}`);
    dataRows = grid.slice(headerRowIdx + 1);
  }

  const seen = {};
  const uniqHeaders = headers.map(h => {
    if (seen[h] === undefined) { seen[h] = 0; return h; }
    seen[h]++; return `${h}_${seen[h]}`;
  });

  const fields = uniqHeaders.map((h, i) => ({
    name: h,
    type: fidelity ? "文本" : detectFieldType(dataRows.slice(0, 200).map(r => r[i]))
  }));

  const records = dataRows.map(row => {
    const r = {};
    fields.forEach((f, i) => { r[f.name] = coerceValue(row[i], f.type, fidelity); });
    return r;
  });

  const headerCandidates = grid.slice(0, Math.min(8, grid.length)).map(r =>
    r.map(c => c instanceof Date
      ? c.toISOString().split("T")[0]
      : String(c ?? ""))
  );

  return {
    fields, records, sourceType: sourceTag,
    headerRowIdx, headerCandidates,
    fidelity, headerMode, keepBlankRows,
    totalRowsInSheet, filteredBlankCount,
    dataColCount: maxCols
  };
}

async function parseUploadedFile(file, options = {}) {
  if (typeof options === "string") options = { sheetName: options };
  const { sheetName } = options;
  const fidelity = options.fidelity !== false;

  const name = file.name.toLowerCase();
  const isExcel = /\.(xlsx|xls|xlsm|xlsb|ods)$/i.test(name);
  const isJSON = name.endsWith(".json");

  if (isExcel) {
    const XLSX = await loadXLSX();
    const buf = await file.arrayBuffer();
    const sig = new Uint8Array(buf.slice(0, 8));
    const isRealZip = sig[0] === 0x50 && sig[1] === 0x4B;
    const isRealOLE = sig[0] === 0xD0 && sig[1] === 0xCF && sig[2] === 0x11 && sig[3] === 0xE0;
    const readOpts = { type: "array", cellDates: true, cellNF: true, cellText: true };
    if (isRealOLE) readOpts.codepage = options.codepage || 936;
    else if (options.codepage) readOpts.codepage = options.codepage;

    const wb = XLSX.read(buf, readOpts);
    if (!wb.SheetNames.length) throw new Error("Excel 工作簿为空");
    const useSheet = sheetName && wb.Sheets[sheetName] ? sheetName : wb.SheetNames[0];
    const realFormat = isRealZip ? (name.endsWith(".ods") ? "ODS" : "XLSX")
                      : isRealOLE ? "XLS"
                      : (name.match(/\.(\w+)$/)?.[1].toUpperCase() || "EXCEL");
    const ext = name.match(/\.(\w+)$/)?.[1].toUpperCase() || "EXCEL";
    const mismatch = (ext === "XLSX" && isRealOLE) ? `（注意：后缀 .xlsx 实为老 .xls）` : "";

    const result = sheetToTable(XLSX, wb.Sheets[useSheet], realFormat + mismatch, options);
    return {
      ...result,
      sheets: wb.SheetNames,
      currentSheet: useSheet,
      codepage: readOpts.codepage,
      realFormat,
      _wbReadOpts: { codepage: readOpts.codepage }
    };
  }

  const text = await file.text();
  if (isJSON || text.trim().startsWith("{") || text.trim().startsWith("[")) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) {
      if (!isJSON) return parseDelimitedText(text, file.name, fidelity);
      throw new Error("JSON 格式错误：" + e.message);
    }
    if (!Array.isArray(data)) {
      const arrKey = Object.keys(data).find(k => Array.isArray(data[k]));
      if (arrKey) data = data[arrKey];
      else throw new Error("JSON 必须是对象数组");
    }
    if (data.length === 0) throw new Error("JSON 中没有数据");
    if (typeof data[0] !== "object") throw new Error("JSON 元素必须是对象");
    const keySet = new Set();
    data.forEach(o => Object.keys(o).forEach(k => keySet.add(k)));
    const keys = [...keySet].filter(k => k !== "_id" && k !== "dbName");
    const fields = keys.map(k => ({
      name: k,
      type: fidelity ? "文本" : detectFieldType(data.slice(0, 200).map(o => o[k]))
    }));
    const records = data.map(o => {
      const r = {};
      fields.forEach(f => { r[f.name] = coerceValue(o[f.name], f.type, fidelity); });
      return r;
    });
    return { fields, records, sourceType: "JSON", fidelity, totalRowsInSheet: data.length, dataColCount: keys.length, filteredBlankCount: 0 };
  }

  return parseDelimitedText(text, file.name, fidelity);
}

function parseDelimitedText(text, fileName, fidelity = true) {
  const isTSV = /\.tsv$/i.test(fileName || "");
  const delim = isTSV ? "\t" : detectDelimiter(text);
  const rows = parseDelimited(text, delim);
  if (rows.length < 1) throw new Error("文件为空");
  const maxCols = Math.max(...rows.map(r => r.length));
  const headers = rows[0].map((h, i) => String(h).trim() || `字段${i + 1}`);
  while (headers.length < maxCols) headers.push(`字段${headers.length + 1}`);
  const dataRows = rows.slice(1);
  const fields = headers.map((h, i) => ({
    name: h,
    type: fidelity ? "文本" : detectFieldType(dataRows.slice(0, 200).map(r => r[i]))
  }));
  const records = dataRows.map(row => {
    const r = {};
    fields.forEach((f, i) => { r[f.name] = coerceValue(row[i], f.type, fidelity); });
    return r;
  });
  const tag = delim === "\t" ? "TSV" : (delim === ";" ? "CSV(分号)" : delim === "|" ? "CSV(竖线)" : "CSV");
  return { fields, records, sourceType: tag, fidelity, totalRowsInSheet: rows.length, dataColCount: maxCols, filteredBlankCount: 0 };
}

async function parseAllSheets(file, options = {}) {
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const sig = new Uint8Array(buf.slice(0, 8));
  const isRealOLE = sig[0] === 0xD0 && sig[1] === 0xCF && sig[2] === 0x11 && sig[3] === 0xE0;
  const readOpts = { type: "array", cellDates: true, cellNF: true, cellText: true };
  if (isRealOLE) readOpts.codepage = options.codepage || 936;
  else if (options.codepage) readOpts.codepage = options.codepage;
  const wb = XLSX.read(buf, readOpts);
  const out = [];
  for (const sn of wb.SheetNames) {
    try {
      const t = sheetToTable(XLSX, wb.Sheets[sn], "XLSX", options);
      if (t.records.length > 0 || t.fields.length > 0) out.push({ sheetName: sn, ...t });
    } catch { /* 跳过空表 */ }
  }
  return out;
}

/* -------- 导出 -------- */
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function recordsToCSV(fields, records) {
  const esc = (v) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = fields.map(f => esc(f.name)).join(",");
  const body = records.map(r => fields.map(f => esc(r[f.name])).join(",")).join("\n");
  return head + "\n" + body;
}
function recordsToJSON(fields, records) {
  return JSON.stringify(records.map(r => {
    const o = {};
    fields.forEach(f => { o[f.name] = r[f.name]; });
    return o;
  }), null, 2);
}

/* ============================================================
   侧边栏列表组件（支持上下分栏可调）
   ============================================================ */
function SidebarList({
  metas, counts, activeDb, openDb,
  expandedGroups, setExpandedGroups,
  hoverGroup, setHoverGroup, deleteGroup,
  sidebarSplit, startDragSplit
}) {
  const wrapRef = useRef(null);

  const names = Object.keys(metas);
  const ungrouped = names.filter(n => !metas[n].group);
  const groups = {};
  for (const n of names) {
    const g = metas[n].group;
    if (!g) continue;
    (groups[g] = groups[g] || []).push(n);
  }
  const hasUngrouped = ungrouped.length > 0;
  const hasGroups = Object.keys(groups).length > 0;
  const splitable = hasUngrouped && hasGroups;

  const renderItem = (name, inFolder) => (
    <div key={name} onClick={() => openDb(name)}
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: inFolder ? "6px 16px 6px 30px" : "7px 16px", cursor: "pointer", background: activeDb === name ? "#eff6ff" : "transparent", borderLeft: activeDb === name ? "2px solid #3b82f6" : "2px solid transparent" }}>
      <span style={{ color: activeDb === name ? "#1d4ed8" : "#6b7280", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
        {inFolder ? "📄 " : ""}{metas[name].display || name}
      </span>
      <span style={{ fontSize: 11, color: "#9ca3af", background: "#f3f4f6", padding: "1px 6px", borderRadius: 10, border: "1px solid #e5e7eb", flexShrink: 0, marginLeft: 6 }}>
        {counts[name] >= 1000 ? `${(counts[name] / 1000).toFixed(1)}k` : counts[name]}
      </span>
    </div>
  );

  if (names.length === 0) {
    return (
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ padding: "12px 16px", color: "#aaa", fontSize: 12, lineHeight: 1.6 }}>暂无数据库<br />点击上方创建或导入</div>
      </div>
    );
  }

  if (!splitable) {
    return (
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {hasUngrouped && ungrouped.map(n => renderItem(n, false))}
        {hasGroups && Object.keys(groups).map(g => renderGroup(g, groups, expandedGroups, setExpandedGroups, hoverGroup, setHoverGroup, deleteGroup, counts, renderItem))}
      </div>
    );
  }

  return (
    <div ref={wrapRef} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
      <div style={{ flex: `${sidebarSplit} 1 0`, overflowY: "auto", padding: "8px 0", minHeight: 40 }}>
        <div style={{ padding: "2px 16px 4px", fontSize: 10, color: "#9ca3af", fontFamily: "monospace", letterSpacing: "0.05em" }}>未分组</div>
        {ungrouped.map(n => renderItem(n, false))}
      </div>

      <div
        onMouseDown={(e) => {
          const h = wrapRef.current?.clientHeight || 300;
          startDragSplit(e, h);
        }}
        title="拖动以调整上下区域比例"
        style={{
          height: 6,
          cursor: "ns-resize",
          background: "#e5e7eb",
          borderTop: "1px solid #d1d5db",
          borderBottom: "1px solid #d1d5db",
          flexShrink: 0,
          position: "relative"
        }}
        onMouseEnter={e => e.currentTarget.style.background = "#bfdbfe"}
        onMouseLeave={e => e.currentTarget.style.background = "#e5e7eb"}
      >
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: 24, height: 2, background: "#9ca3af", borderRadius: 1, pointerEvents: "none" }} />
      </div>

      <div style={{ flex: `${1 - sidebarSplit} 1 0`, overflowY: "auto", padding: "8px 0", minHeight: 40 }}>
        <div style={{ padding: "2px 16px 4px", fontSize: 10, color: "#9ca3af", fontFamily: "monospace", letterSpacing: "0.05em" }}>文件夹</div>
        {Object.keys(groups).map(g => renderGroup(g, groups, expandedGroups, setExpandedGroups, hoverGroup, setHoverGroup, deleteGroup, counts, renderItem))}
      </div>
    </div>
  );
}

function renderGroup(g, groups, expandedGroups, setExpandedGroups, hoverGroup, setHoverGroup, deleteGroup, counts, renderItem) {
  const open = expandedGroups.has(g);
  const total = groups[g].reduce((sum, n) => sum + (counts[n] || 0), 0);
  const isHover = hoverGroup === g;
  return (
    <div key={"grp-" + g}>
      <div
        onMouseEnter={() => setHoverGroup(g)}
        onMouseLeave={() => setHoverGroup(null)}
        onClick={() => setExpandedGroups(prev => {
          const s = new Set(prev);
          s.has(g) ? s.delete(g) : s.add(g);
          return s;
        })}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 8px 7px 14px", cursor: "pointer", background: isHover ? "#e5e7eb" : "#f3f4f6", borderTop: "1px solid #e5e7eb", borderBottom: "1px solid #e5e7eb", transition: "background .12s" }}>
        <span style={{ fontSize: 10, color: "#9ca3af", width: 10, transition: "transform .15s", transform: open ? "rotate(90deg)" : "none" }}>▶</span>
        <span style={{ fontSize: 13 }}>📁</span>
        <span style={{ flex: 1, color: "#374151", fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g}</span>
        <span style={{ fontSize: 10, color: "#9ca3af" }}>{groups[g].length}表 · {total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total}</span>
        <button
          onClick={(e) => { e.stopPropagation(); deleteGroup(g); }}
          title={`删除整个文件夹「${g}」及其中 ${groups[g].length} 张表`}
          style={{
            border: "1px solid " + (isHover ? "#fecaca" : "transparent"),
            background: isHover ? "#fff" : "transparent",
            color: isHover ? "#ef4444" : "transparent",
            cursor: "pointer",
            fontSize: 11,
            padding: "2px 7px",
            borderRadius: 4,
            transition: "all .12s",
            flexShrink: 0,
            fontWeight: 500
          }}
        >🗑 删除</button>
      </div>
      {open && groups[g].map(n => renderItem(n, true))}
    </div>
  );
}

/* ============================================================
   主组件
   ============================================================ */

  function App() {
  const [metas, setMetas] = useState({});
  const [counts, setCounts] = useState({});
  const [records, setRecords] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  const [activeDb, setActiveDb] = useState(null);
  const [view, setView] = useState("list");
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [hoverGroup, setHoverGroup] = useState(null);

  /* —— 尺寸调节 state —— */
  const [appSize, setAppSize] =useState({ w: window.innerWidth - 24, h: window.innerHeight - 24 });
  const [sidebarW, setSidebarW] = useState(220);
  const [sidebarSplit, setSidebarSplit] = useState(0.5);
  const dragRef = useRef(null);

  const [createMode, setCreateMode] = useState("manual");
  const [newDbName, setNewDbName] = useState("");
  const [fields, setFields] = useState([{ name: "", type: "文本" }]);
  const [bulkFieldText, setBulkFieldText] = useState("");
  const [importPreview, setImportPreview] = useState(null);
  const [importFile, setImportFile] = useState(null);
  const [dbErr, setDbErr] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const fileInputRef = useRef(null);
  const importIntoExistingRef = useRef(null);

  const [fidelityMode, setFidelityMode] = useState(true);
  const [headerMode, setHeaderMode] = useState("auto");
  const [keepBlankRows, setKeepBlankRows] = useState(true);

  const [newRecord, setNewRecord] = useState({});
  const [recErr, setRecErr] = useState("");

  const [filters, setFilters] = useState([{ field: "", op: "包含", value: "" }]);
  const [filterActive, setFilterActive] = useState(false);
  const [quickSearch, setQuickSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  useEffect(() => {
    if (!exportMenuOpen) return;
    const close = () => setExportMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [exportMenuOpen]);

  /* —— 统一拖拽处理 —— */
  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (d.type === "app") {
        setAppSize({
          w: Math.max(720, Math.min(window.innerWidth - 20, d.startW + dx)),
          h: Math.max(420, Math.min(window.innerHeight - 20, d.startH + dy))
        });
      } else if (d.type === "sidebar") {
        setSidebarW(Math.max(160, Math.min(480, d.startW + dx)));
      } else if (d.type === "split") {
        const next = (d.startSplit * d.sidebarH + dy) / d.sidebarH;
        setSidebarSplit(Math.max(0.15, Math.min(0.85, next)));
      }
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startDragApp = (e) => {
    dragRef.current = { type: "app", startX: e.clientX, startY: e.clientY, startW: appSize.w, startH: appSize.h };
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  };
  const startDragSidebar = (e) => {
    dragRef.current = { type: "sidebar", startX: e.clientX, startY: e.clientY, startW: sidebarW };
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  };
  const startDragSplit = (e, sidebarH) => {
    dragRef.current = { type: "split", startX: e.clientX, startY: e.clientY, startSplit: sidebarSplit, sidebarH };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  };

  useEffect(() => {
    (async () => {
      try {
        await migrateFromLocalStorage();
        const all = await idbAllMeta();
        const metasObj = {}; const countsObj = {};
        for (const m of all) {
          metasObj[m.name] = m;
          countsObj[m.name] = await idbCountRecords(m.name);
        }
        setMetas(metasObj);
        setCounts(countsObj);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!activeDb) { setRecords([]); return; }
    setRecordsLoading(true);
    idbAllRecords(activeDb).then(r => {
      setRecords(r);
      setRecordsLoading(false);
      setPage(1);
      setSortBy(null);
      setQuickSearch("");
      setFilterActive(false);
    });
  }, [activeDb]);

  const processed = useMemo(() => {
    let r = records;
    if (quickSearch.trim()) {
      const q = quickSearch.trim().toLowerCase();
      r = r.filter(rec => {
        for (const k in rec) {
          if (k === "_id" || k === "dbName") continue;
          if (String(rec[k] ?? "").toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }
    if (filterActive) {
      const valid = filters.filter(f => f.field && f.value);
      if (valid.length) r = r.filter(rec => valid.every(f => matchesFilter(rec, f)));
    }
    if (sortBy) {
      const meta = metas[activeDb];
      const f = meta?.fields.find(x => x.name === sortBy);
      const t = f?.type || "文本";
      r = [...r].sort((a, b) => {
        let av = a[sortBy], bv = b[sortBy];
        if (t === "数字") { av = Number(av) || 0; bv = Number(bv) || 0; }
        else { av = String(av ?? "").toLowerCase(); bv = String(bv ?? "").toLowerCase(); }
        if (av < bv) return sortDir === "asc" ? -1 : 1;
        if (av > bv) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
    }
    return r;
  }, [records, quickSearch, filterActive, filters, sortBy, sortDir, metas, activeDb]);

  const totalPages = Math.max(1, Math.ceil(processed.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const pagedRecords = processed.slice((curPage - 1) * pageSize, curPage * pageSize);

  const reloadCount = async (name) => {
    const c = await idbCountRecords(name);
    setCounts(prev => ({ ...prev, [name]: c }));
  };

  const createDb = async (overrideFields, overrideRecords) => {
    const name = newDbName.trim();
    if (!name) return setDbErr("请输入数据库名称");
    if (metas[name]) return setDbErr("数据库已存在");

    let useFields = overrideFields || fields;
    if (createMode === "bulk" && !overrideFields) {
      useFields = parseBulkFields(bulkFieldText);
      if (!useFields.length) return setDbErr("请粘贴至少一个字段");
    }
    if (useFields.some(f => !f.name.trim())) return setDbErr("请填写所有字段名");
    const nameSet = new Set();
    for (const f of useFields) {
      if (nameSet.has(f.name)) return setDbErr(`字段名重复：${f.name}`);
      nameSet.add(f.name);
    }

    try {
      await idbPutMeta({ name, fields: useFields });
      if (overrideRecords && overrideRecords.length) {
        setImporting(true);
        setImportProgress({ done: 0, total: overrideRecords.length });
        await idbBulkAdd(name, overrideRecords, (done, total) => setImportProgress({ done, total }));
        setImporting(false);
      }
      setMetas(prev => ({ ...prev, [name]: { name, fields: useFields } }));
      setCounts(prev => ({ ...prev, [name]: overrideRecords?.length || 0 }));
      setNewDbName(""); setFields([{ name: "", type: "文本" }]);
      setBulkFieldText(""); setImportPreview(null); setImportFile(null); setDbErr("");
      setCreateMode("manual");
      setActiveDb(name); setView("records");
    } catch (e) {
      setImporting(false);
      setDbErr("创建失败：" + e.message);
    }
  };

  const createGroupedSheets = async () => {
    if (!importFile) return;
    setDbErr("");
    try {
      const all = await parseAllSheets(importFile, {
        fidelity: fidelityMode, headerMode, keepBlankRows,
        codepage: importPreview?.codepage
      });
      if (!all.length) return setDbErr("没有可导入的工作表");

      const group = newDbName.trim() || importFile.name.replace(/\.[^.]+$/, "");
      setImporting(true);
      let firstName = null;
      const newMetas = {}, newCounts = {};
      for (const s of all) {
        let dbName = `${group} · ${s.sheetName}`;
        let n = 1;
        while (metas[dbName] || newMetas[dbName]) dbName = `${group} · ${s.sheetName} (${++n})`;
        const m = { name: dbName, fields: s.fields, group, display: s.sheetName };
        await idbPutMeta(m);
        if (s.records.length) {
          setImportProgress({ done: 0, total: s.records.length });
          await idbBulkAdd(dbName, s.records, (done, total) => setImportProgress({ done, total }));
        }
        newMetas[dbName] = m;
        newCounts[dbName] = s.records.length;
        if (!firstName) firstName = dbName;
      }
      setImporting(false);
      setMetas(prev => ({ ...prev, ...newMetas }));
      setCounts(prev => ({ ...prev, ...newCounts }));
      setExpandedGroups(prev => new Set(prev).add(group));
      setImportPreview(null); setImportFile(null); setNewDbName("");
      setActiveDb(firstName); setView("records");
    } catch (e) {
      setImporting(false);
      setDbErr("文件夹导入失败：" + e.message);
    }
  };

  const createAllSheets = async () => {
    if (!importFile) return;
    setDbErr("");
    try {
      const all = await parseAllSheets(importFile, {
        fidelity: fidelityMode, headerMode, keepBlankRows,
        codepage: importPreview?.codepage
      });
      if (!all.length) return setDbErr("没有可导入的工作表");
      const base = importFile.name.replace(/\.[^.]+$/, "");
      setImporting(true);
      let firstName = null;
      const newMetas = {}, newCounts = {};
      for (const s of all) {
        let dbName = `${base} · ${s.sheetName}`;
        let n = 1;
        while (metas[dbName] || newMetas[dbName]) dbName = `${base} · ${s.sheetName} (${++n})`;
        const m = { name: dbName, fields: s.fields };
        await idbPutMeta(m);
        if (s.records.length) {
          setImportProgress({ done: 0, total: s.records.length });
          await idbBulkAdd(dbName, s.records, (done, total) => setImportProgress({ done, total }));
        }
        newMetas[dbName] = m;
        newCounts[dbName] = s.records.length;
        if (!firstName) firstName = dbName;
      }
      setImporting(false);
      setMetas(prev => ({ ...prev, ...newMetas }));
      setCounts(prev => ({ ...prev, ...newCounts }));
      setImportPreview(null); setImportFile(null);
      setActiveDb(firstName); setView("records");
    } catch (e) {
      setImporting(false);
      setDbErr("全部工作表导入失败：" + e.message);
    }
  };

  const deleteGroup = async (group) => {
    const names = Object.keys(metas).filter(n => metas[n].group === group);
    if (!names.length) return;
    const totalRecords = names.reduce((sum, n) => sum + (counts[n] || 0), 0);
    const msg = `确认删除文件夹「${group}」？\n\n` +
      `将一并删除：\n` +
      `  • ${names.length} 张表\n` +
      `  • ${totalRecords.toLocaleString()} 条记录\n\n` +
      `此操作不可撤销。`;
    if (!window.confirm(msg)) return;
    for (const n of names) await idbDeleteDb(n);
    setMetas(prev => { const x = { ...prev }; names.forEach(n => delete x[n]); return x; });
    setCounts(prev => { const x = { ...prev }; names.forEach(n => delete x[n]); return x; });
    setExpandedGroups(prev => { const s = new Set(prev); s.delete(group); return s; });
    if (activeDb && names.includes(activeDb)) { setActiveDb(null); setView("list"); }
  };

  const deleteDb = async (name) => {
    await idbDeleteDb(name);
    const next = { ...metas }; delete next[name];
    const nextC = { ...counts }; delete nextC[name];
    setMetas(next); setCounts(nextC);
    if (activeDb === name) { setActiveDb(null); setView("list"); }
  };

  const clearDbRecords = async () => {
    if (!activeDb) return;
    if (!window.confirm(`清空「${activeDb}」中所有 ${counts[activeDb] || 0} 条记录？此操作不可撤销。`)) return;
    await idbClearRecords(activeDb);
    setRecords([]);
    reloadCount(activeDb);
  };

  const addRecord = async () => {
    const meta = metas[activeDb];
    for (const f of meta.fields) {
      if (f.type !== "布尔值" && String(newRecord[f.name] ?? "").trim() === "") return setRecErr(`请填写「${f.name}」`);
      if (!validate(newRecord[f.name], f.type)) return setRecErr(`「${f.name}」格式不正确`);
    }
    const rec = {};
    meta.fields.forEach(f => { rec[f.name] = coerceValue(newRecord[f.name], f.type, false); });
    await idbAddRecord(activeDb, rec);
    const updated = await idbAllRecords(activeDb);
    setRecords(updated);
    reloadCount(activeDb);
    setNewRecord({}); setRecErr(""); setView("records");
  };

  const deleteRecord = async (id) => {
    await idbDeleteRecord(id);
    setRecords(records.filter(r => r._id !== id));
    reloadCount(activeDb);
  };

  const importOpts = () => ({ fidelity: fidelityMode, headerMode, keepBlankRows });

  const handleFilePick = async (e, intoExisting = false) => {
    const file = e.target.files[0];
    if (!file) return;
    setDbErr("");
    try {
      const parsed = await parseUploadedFile(file, importOpts());
      parsed.fileName = file.name;
      if (intoExisting) {
        const meta = metas[activeDb];
        const remapped = parsed.records.map(rec => {
          const out = {};
          meta.fields.forEach(f => { out[f.name] = coerceValue(rec[f.name], f.type, fidelityMode); });
          return out;
        });
        if (!window.confirm(`将向「${activeDb}」追加 ${remapped.length} 条记录，继续？`)) {
          e.target.value = ""; return;
        }
        setImporting(true);
        setImportProgress({ done: 0, total: remapped.length });
        await idbBulkAdd(activeDb, remapped, (done, total) => setImportProgress({ done, total }));
        setImporting(false);
        const updated = await idbAllRecords(activeDb);
        setRecords(updated);
        reloadCount(activeDb);
      } else {
        setImportPreview(parsed);
        setImportFile(file);
        if (!newDbName.trim()) {
          let base = file.name.replace(/\.[^.]+$/, "");
          if (parsed.sheets && parsed.sheets.length > 1) base += " · " + parsed.currentSheet;
          setNewDbName(base);
        }
      }
    } catch (err) {
      setDbErr("解析失败：" + err.message);
    }
    e.target.value = "";
  };

  const reparse = async (extra = {}) => {
    if (!importFile) return;
    try {
      const parsed = await parseUploadedFile(importFile, {
        ...importOpts(),
        sheetName: importPreview?.currentSheet,
        codepage: importPreview?.codepage,
        ...extra
      });
      parsed.fileName = importFile.name;
      setImportPreview(parsed);
      if (extra.sheetName) {
        let base = importFile.name.replace(/\.[^.]+$/, "");
        if (parsed.sheets && parsed.sheets.length > 1) base += " · " + parsed.currentSheet;
        setNewDbName(base);
      }
    } catch (err) {
      setDbErr("重新解析失败：" + err.message);
    }
  };

  const exportDb = async (format) => {
    const meta = metas[activeDb];
    if (!meta) return;
    if (format === "xlsx") {
      const XLSX = await loadXLSX();
      const aoa = [
        meta.fields.map(f => f.name),
        ...records.map(r => meta.fields.map(f => r[f.name]))
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, activeDb.slice(0, 31));
      XLSX.writeFile(wb, `${activeDb}.xlsx`);
      return;
    }
    const out = format === "csv" ? recordsToCSV(meta.fields, records) : recordsToJSON(meta.fields, records);
    const ext = format === "csv" ? "csv" : "json";
    const mime = format === "csv" ? "text/csv;charset=utf-8" : "application/json";
    downloadFile(`${activeDb}.${ext}`, out, mime);
  };

  const initAddRecord = () => {
    const meta = metas[activeDb];
    const init = {};
    meta.fields.forEach(f => { init[f.name] = defaultValueFor(f.type); });
    setNewRecord(init); setRecErr(""); setView("addRecord");
  };

  const openDb = (name) => { setActiveDb(name); setView("records"); };

  const toggleSort = (fieldName) => {
    if (sortBy !== fieldName) { setSortBy(fieldName); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortBy(null); setSortDir("asc"); }
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "#888", fontFamily: "monospace", fontSize: 14 }}>
      正在加载数据…
    </div>
  );

  const meta = activeDb ? metas[activeDb] : null;

  return (
    <div style={{ padding: 12, background: "#f1f5f9", minHeight: "100%", boxSizing: "border-box" }}>
      <div style={{
        position: "relative",
        display: "flex",
        width: appSize.w,
        height: appSize.h,
        maxWidth: "100%",
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        background: "#fff",
        color: "#1a1a1a",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        overflow: "hidden"
      }}>
        {/* Sidebar */}
        <div style={{ width: sidebarW, borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column", flexShrink: 0, background: "#fafafa", position: "relative" }}>
          <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #e5e7eb" }}>
            <div style={{ fontFamily: "monospace", fontSize: 11, color: "#888", letterSpacing: "0.08em", marginBottom: 8 }}>数据库</div>
            <button onClick={() => { setView("create"); setDbErr(""); setNewDbName(""); setFields([{ name: "", type: "文本" }]); setBulkFieldText(""); setImportPreview(null); setImportFile(null); setCreateMode("manual"); }}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "#fff", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", color: "#374151", fontSize: 13 }}>
              ＋ 新建数据库
            </button>
          </div>

          <SidebarList
            metas={metas}
            counts={counts}
            activeDb={activeDb}
            openDb={openDb}
            expandedGroups={expandedGroups}
            setExpandedGroups={setExpandedGroups}
            hoverGroup={hoverGroup}
            setHoverGroup={setHoverGroup}
            deleteGroup={deleteGroup}
            sidebarSplit={sidebarSplit}
            startDragSplit={startDragSplit}
          />

          <div style={{ padding: "10px 14px", borderTop: "1px solid #e5e7eb", fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>
            IDB · 完整保真导入
          </div>

          {/* 侧边栏右边缘:拖拽改变宽度 */}
          <div
            onMouseDown={startDragSidebar}
            title="拖动以调整侧边栏宽度"
            style={{
              position: "absolute",
              top: 0,
              right: -3,
              width: 6,
              height: "100%",
              cursor: "ew-resize",
              zIndex: 5,
              background: "transparent"
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(59,130,246,0.15)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          />
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

          {view === "list" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#9ca3af" }}>
              <div style={{ fontSize: 36 }}>🗄️</div>
              <div style={{ fontSize: 15, color: "#374151" }}>选择或创建数据库</div>
              <div style={{ fontSize: 13 }}>Excel / CSV / JSON 完整保真导入 · 零数据丢失</div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 8, padding: "8px 14px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, lineHeight: 1.6 }}>
                💡 <b>尺寸调节</b>:右下角拖拽改变整体大小 · 侧边栏右缘拖拽改变宽度 · 中间横条拖拽改变上下区域比例
              </div>
            </div>
          )}

          {view === "create" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
              <div style={{ maxWidth: 760 }}>
                <div style={{ fontFamily: "monospace", fontSize: 11, color: "#888", letterSpacing: "0.08em", marginBottom: 16 }}>创建新数据库</div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 6 }}>数据库名称</label>
                  <input value={newDbName} onChange={e => setNewDbName(e.target.value)} placeholder="例如：用户信息、产品列表…"
                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }} />
                </div>

                <div style={{ display: "flex", gap: 0, marginBottom: 14, borderBottom: "1px solid #e5e7eb" }}>
                  {[
                    { id: "manual", label: "手动添加字段" },
                    { id: "bulk", label: "批量粘贴字段" },
                    { id: "import", label: "导入文件" }
                  ].map(t => (
                    <button key={t.id} onClick={() => { setCreateMode(t.id); setDbErr(""); }}
                      style={{
                        padding: "8px 14px", fontSize: 13, background: "transparent",
                        border: "none", borderBottom: createMode === t.id ? "2px solid #3b82f6" : "2px solid transparent",
                        color: createMode === t.id ? "#1d4ed8" : "#6b7280", cursor: "pointer", marginBottom: -1
                      }}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {createMode === "manual" && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <label style={{ fontSize: 12, color: "#6b7280" }}>字段定义</label>
                      <button onClick={() => setFields([...fields, { name: "", type: "文本" }])}
                        style={{ fontSize: 12, padding: "3px 10px", border: "1px solid #d1d5db", borderRadius: 5, cursor: "pointer", background: "#fff" }}>
                        ＋ 添加字段
                      </button>
                    </div>
                    {fields.map((f, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                        <div style={{ width: 28, height: 28, background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", fontSize: 11, color: "#6b7280", flexShrink: 0 }}>
                          {typeIcon[f.type]}
                        </div>
                        <input value={f.name} onChange={e => { const nf = [...fields]; nf[i].name = e.target.value; setFields(nf); }}
                          placeholder="字段名称" style={{ flex: 1, padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 5, fontSize: 13 }} />
                        <select value={f.type} onChange={e => { const nf = [...fields]; nf[i].type = e.target.value; setFields(nf); }} style={{ padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 5, fontSize: 13 }}>
                          {FIELD_TYPES.map(t => <option key={t}>{t}</option>)}
                        </select>
                        {fields.length > 1 && (
                          <button onClick={() => setFields(fields.filter((_, j) => j !== i))} style={{ padding: "4px 8px", color: "#ef4444", border: "none", background: "transparent", cursor: "pointer", fontSize: 14 }}>
                            🗑
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {createMode === "bulk" && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                      每行一个字段,格式:<code style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>字段名:类型</code> 或 <code style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>字段名(类型)</code>
                    </label>
                    <textarea value={bulkFieldText} onChange={e => setBulkFieldText(e.target.value)} rows={10}
                      placeholder={"姓名\n年龄:数字\n邮箱:email\n注册日期:date\n是否激活:bool\n个人主页:url"}
                      style={{ width: "100%", boxSizing: "border-box", padding: "10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, fontFamily: "monospace", resize: "vertical" }} />
                    {bulkFieldText.trim() && (
                      <div style={{ marginTop: 10, padding: "10px 12px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6 }}>
                        <div style={{ fontSize: 11, color: "#888", fontFamily: "monospace", marginBottom: 6 }}>预览 ({parseBulkFields(bulkFieldText).length} 个字段)</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {parseBulkFields(bulkFieldText).map((f, i) => (
                            <span key={i} style={{ fontSize: 12, padding: "3px 8px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 4, color: "#374151" }}>
                              <span style={{ fontFamily: "monospace", color: "#9ca3af", marginRight: 4 }}>{typeIcon[f.type]}</span>
                              {f.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {createMode === "import" && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                        <input type="checkbox" id="fid" checked={fidelityMode}
                          onChange={e => { setFidelityMode(e.target.checked); if (importFile) setTimeout(() => reparse({ fidelity: e.target.checked }), 0); }}
                          style={{ marginTop: 3, width: 16, height: 16, cursor: "pointer" }} />
                        <label htmlFor="fid" style={{ cursor: "pointer", flex: 1 }}>
                          <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 600 }}>完整保真导入(推荐)</div>
                          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, lineHeight: 1.5 }}>
                            按工作表真实范围逐格读取,取 Excel 显示文本原样导入,<b>不做任何类型转换</b>。
                            前导零、长 ID、超长小数、科学计数、原始日期格式全部保留;合并单元格自动填充;不裁列。
                          </div>
                        </label>
                      </div>
                      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", paddingLeft: 26 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12, color: "#64748b" }}>表头:</span>
                          <select value={headerMode}
                            onChange={e => { setHeaderMode(e.target.value); if (importFile) setTimeout(() => reparse({ headerMode: e.target.value }), 0); }}
                            style={{ fontSize: 12, padding: "3px 6px", border: "1px solid #cbd5e1", borderRadius: 5 }}>
                            <option value="auto">自动识别</option>
                            <option value="manual">手动指定行</option>
                            <option value="none">无表头(列1…)</option>
                          </select>
                        </div>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b", cursor: "pointer" }}>
                          <input type="checkbox" checked={keepBlankRows}
                            onChange={e => { setKeepBlankRows(e.target.checked); if (importFile) setTimeout(() => reparse({ keepBlankRows: e.target.checked }), 0); }}
                            style={{ cursor: "pointer" }} />
                          保留空行
                        </label>
                      </div>
                    </div>

                    {!importPreview ? (
                      <div style={{ border: "2px dashed #d1d5db", borderRadius: 8, padding: "32px 20px", textAlign: "center", background: "#fafafa" }}>
                        <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
                        <div style={{ fontSize: 14, color: "#374151", marginBottom: 4 }}>选择数据文件</div>
                        <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>Excel (xlsx, xls, xlsm, xlsb) · CSV · TSV · JSON · ODS</div>
                        <div style={{ fontSize: 11, color: "#bdbdbd", marginBottom: 14, fontFamily: "monospace" }}>多工作表可整本导入或单独切换</div>
                        <input ref={fileInputRef} type="file"
                          accept=".csv,.tsv,.json,.txt,.xlsx,.xls,.xlsm,.xlsb,.ods"
                          onChange={e => handleFilePick(e, false)} style={{ display: "none" }} />
                        <button onClick={() => fileInputRef.current?.click()}
                          style={{ padding: "8px 20px", background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
                          选择文件
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, marginBottom: 12, flexWrap: "wrap" }}>
                          <span>✓</span>
                          <span style={{ fontSize: 13, color: "#166534" }}>
                            已解析 <b>{importPreview.fileName}</b>({importPreview.sourceType}
                            {importPreview.fidelity ? " · 保真" : " · 智能"}):
                            <b>{importPreview.fields.length}</b> 列 · <b>{importPreview.records.length}</b> 条记录
                            {typeof importPreview.totalRowsInSheet === "number" &&
                              <span style={{ color: "#15803d" }}>(工作表共 {importPreview.totalRowsInSheet} 行)</span>}
                          </span>
                          <div style={{ flex: 1 }} />
                          <button onClick={() => { setImportPreview(null); setImportFile(null); }} style={{ fontSize: 11, padding: "2px 8px", background: "#fff", border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer" }}>重选</button>
                        </div>

                        {importPreview.filteredBlankCount > 0 && (
                          <div style={{ padding: "6px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, marginBottom: 12, fontSize: 12, color: "#92400e" }}>
                            ⚠ 已过滤 {importPreview.filteredBlankCount} 个空行。如需完整保留,请勾选上方"保留空行"。
                          </div>
                        )}

                        {(importPreview.realFormat === "XLS" || importPreview.sourceType?.includes("XLS")) && (
                          <div style={{ padding: "8px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, marginBottom: 12 }}>
                            <div style={{ fontSize: 12, color: "#991b1b", marginBottom: 6, fontWeight: 500 }}>🆘 数据看起来乱码?点下面试试不同编码:</div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {[
                                { cp: 936, label: "GBK (简中)" },
                                { cp: 950, label: "Big5 (繁中)" },
                                { cp: 932, label: "Shift-JIS (日)" },
                                { cp: 949, label: "EUC-KR (韩)" },
                                { cp: 65001, label: "UTF-8" }
                              ].map(o => (
                                <button key={o.cp} onClick={() => reparse({ codepage: o.cp })}
                                  style={{
                                    fontSize: 11, padding: "3px 10px",
                                    background: importPreview.codepage === o.cp ? "#fee2e2" : "#fff",
                                    border: "1px solid " + (importPreview.codepage === o.cp ? "#fca5a5" : "#fecaca"),
                                    color: importPreview.codepage === o.cp ? "#991b1b" : "#7f1d1d",
                                    borderRadius: 4, cursor: "pointer"
                                  }}>
                                  {o.label} {importPreview.codepage === o.cp && "✓"}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {importPreview.sheets && importPreview.sheets.length > 1 && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, marginBottom: 12, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 12, color: "#92400e", fontWeight: 500 }}>📑 工作表:</span>
                            {importPreview.sheets.map(s => (
                              <button key={s} onClick={() => reparse({ sheetName: s })}
                                style={{
                                  fontSize: 12, padding: "3px 10px",
                                  background: s === importPreview.currentSheet ? "#fef3c7" : "#fff",
                                  border: "1px solid " + (s === importPreview.currentSheet ? "#fbbf24" : "#e5e7eb"),
                                  color: s === importPreview.currentSheet ? "#92400e" : "#6b7280",
                                  borderRadius: 4, cursor: "pointer"
                                }}>
                                {s}
                              </button>
                            ))}
                            <span style={{ fontSize: 11, color: "#a16207", marginLeft: "auto" }}>共 {importPreview.sheets.length} 个工作表</span>
                            <div style={{ flexBasis: "100%", fontSize: 11, color: "#a16207", marginTop: 4, lineHeight: 1.5 }}>
                              上方按钮可切换单表预览;底部「📁 导入为一个文件夹」会把每张工作表都建成独立的表,并归到同一个文件夹里,侧边栏点文件夹即可展开查看每张表。
                            </div>
                          </div>
                        )}

                        {importPreview.headerMode !== "none" && importPreview.headerCandidates && importPreview.headerCandidates.length > 1 && (
                          <div style={{ padding: "10px 12px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, marginBottom: 12 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                              <span style={{ fontSize: 12, color: "#075985", fontWeight: 500 }}>🏷 表头行(当前第 {importPreview.headerRowIdx + 1} 行)</span>
                              <span style={{ fontSize: 11, color: "#0369a1" }}>识别错了就点正确的那行</span>
                            </div>
                            <div style={{ overflowX: "auto", border: "1px solid #e0f2fe", borderRadius: 4, background: "#fff" }}>
                              <table style={{ borderCollapse: "collapse", fontSize: 11, minWidth: "100%" }}>
                                <tbody>
                                  {importPreview.headerCandidates.map((row, i) => {
                                    const isHeader = i === importPreview.headerRowIdx;
                                    return (
                                      <tr key={i}
                                        onClick={() => reparse({ headerMode: "manual", headerRow: i })}
                                        style={{
                                          cursor: "pointer",
                                          background: isHeader ? "#dbeafe" : (i % 2 === 0 ? "#fff" : "#fafafa"),
                                          fontWeight: isHeader ? 500 : 400,
                                          color: isHeader ? "#1e40af" : "#374151"
                                        }}>
                                        <td style={{ padding: "3px 8px", borderRight: "1px solid #e0f2fe", width: 32, textAlign: "center", color: "#9ca3af", fontFamily: "monospace", fontSize: 10, userSelect: "none" }}>
                                          {isHeader ? "▶" : ""}{i + 1}
                                        </td>
                                        {row.map((c, j) => (
                                          <td key={j} style={{ padding: "3px 8px", borderRight: "1px solid #f3f4f6", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c}</td>
                                        ))}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        <div style={{ marginBottom: 8, fontSize: 12, color: "#6b7280" }}>
                          识别出的字段
                          {importPreview.fidelity && <span style={{ color: "#9ca3af" }}>(保真模式统一为文本,可手动改类型)</span>}:
                        </div>
                        {importPreview.fields.map((f, i) => (
                          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                            <div style={{ width: 28, height: 28, background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", fontSize: 11, color: "#6b7280", flexShrink: 0 }}>
                              {typeIcon[f.type]}
                            </div>
                            <input value={f.name} onChange={e => {
                              const next = { ...importPreview };
                              next.fields = [...next.fields]; next.fields[i] = { ...next.fields[i], name: e.target.value };
                              setImportPreview(next);
                            }} style={{ flex: 1, padding: "5px 8px", border: "1px solid #d1d5db", borderRadius: 5, fontSize: 13 }} />
                            <select value={f.type} onChange={e => {
                              const next = { ...importPreview };
                              const newType = e.target.value;
                              next.fields = [...next.fields]; next.fields[i] = { ...next.fields[i], type: newType };
                              next.records = next.records.map(r => ({ ...r, [f.name]: coerceValue(r[f.name], newType, false) }));
                              setImportPreview(next);
                            }} style={{ padding: "5px 8px", border: "1px solid #d1d5db", borderRadius: 5, fontSize: 13 }}>
                              {FIELD_TYPES.map(t => <option key={t}>{t}</option>)}
                            </select>
                          </div>
                        ))}

                        <div style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 6, overflow: "auto", maxHeight: 220 }}>
                          <div style={{ padding: "6px 10px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", fontSize: 11, color: "#888", fontFamily: "monospace" }}>数据预览(前 8 条)</div>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                            <thead>
                              <tr style={{ background: "#fafafa" }}>
                                {importPreview.fields.map(f => <th key={f.name} style={{ padding: "5px 10px", textAlign: "left", borderBottom: "1px solid #e5e7eb", color: "#6b7280", fontWeight: 500, whiteSpace: "nowrap" }}>{f.name}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {importPreview.records.slice(0, 8).map((r, i) => (
                                <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                                  {importPreview.fields.map(f => <td key={f.name} style={{ padding: "4px 10px", whiteSpace: "nowrap", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{String(r[f.name] ?? "")}</td>)}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {dbErr && <div style={{ marginBottom: 12, color: "#ef4444", fontSize: 13 }}>{dbErr}</div>}

                {importing && (
                  <div style={{ marginBottom: 12, padding: "10px 12px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6 }}>
                    <div style={{ fontSize: 12, color: "#1d4ed8", marginBottom: 6 }}>正在导入… {importProgress.done} / {importProgress.total}</div>
                    <div style={{ height: 4, background: "#dbeafe", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${(importProgress.done / Math.max(1, importProgress.total)) * 100}%`, height: "100%", background: "#3b82f6", transition: "width 0.2s" }} />
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => {
                    if (createMode === "import" && importPreview) createDb(importPreview.fields, importPreview.records);
                    else createDb();
                  }} disabled={importing}
                    style={{ padding: "8px 20px", background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", borderRadius: 6, cursor: importing ? "not-allowed" : "pointer", opacity: importing ? 0.6 : 1 }}>
                    {createMode === "import" && importPreview ? `创建并导入 ${importPreview.records.length} 条` : "创建数据库"}
                  </button>
                  {createMode === "import" && importPreview && importPreview.sheets && importPreview.sheets.length > 1 && (
                    <>
                      <button onClick={createGroupedSheets} disabled={importing}
                        style={{ padding: "8px 16px", background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", borderRadius: 6, cursor: importing ? "not-allowed" : "pointer", opacity: importing ? 0.6 : 1 }}>
                        📁 导入为一个文件夹({importPreview.sheets.length} 张表归到一组)
                      </button>
                      <button onClick={createAllSheets} disabled={importing}
                        style={{ padding: "8px 16px", background: "#fff", border: "1px solid #e5e7eb", color: "#6b7280", borderRadius: 6, cursor: importing ? "not-allowed" : "pointer", opacity: importing ? 0.6 : 1 }}>
                        平铺导入(不分组)
                      </button>
                    </>
                  )}
                  <button onClick={() => setView("list")} disabled={importing} style={{ padding: "8px 16px", border: "1px solid #e5e7eb", borderRadius: 6, cursor: "pointer", background: "#fff" }}>取消</button>
                </div>
              </div>
            </div>
          )}

          {(view === "records" || view === "search") && meta && (
            <>
              <div style={{ padding: "12px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontFamily: "monospace", fontSize: 13, color: "#111", fontWeight: 500 }}>
                  {meta.group
                    ? <span><span style={{ color: "#9ca3af" }}>📁 {meta.group} /</span> {meta.display || activeDb}</span>
                    : activeDb}
                </div>
                <div style={{ fontSize: 11, color: "#9ca3af", background: "#f3f4f6", padding: "2px 8px", borderRadius: 10, border: "1px solid #e5e7eb" }}>
                  {meta.fields.length} 字段 · {counts[activeDb] ?? 0} 条记录
                  {processed.length !== records.length && ` · 筛选后 ${processed.length}`}
                </div>
                <input value={quickSearch} onChange={e => { setQuickSearch(e.target.value); setPage(1); }} placeholder="🔍 快速搜索全部字段…"
                  style={{ flex: 1, minWidth: 200, padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 13 }} />
                <button onClick={() => setView(view === "search" ? "records" : "search")}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 6, cursor: "pointer", background: view === "search" ? "#eff6ff" : "#fff" }}>
                  ⚙ 高级筛选
                </button>
                <input type="file"
                  accept=".csv,.tsv,.json,.txt,.xlsx,.xls,.xlsm,.xlsb,.ods"
                  onChange={e => handleFilePick(e, true)} ref={importIntoExistingRef} style={{ display: "none" }} />
                <button onClick={() => importIntoExistingRef.current?.click()} disabled={importing}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 6, cursor: importing ? "not-allowed" : "pointer", background: "#fff" ,color: "#1d4ed8"}}>
                  📥 导入数据
                </button>
                <div style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => setExportMenuOpen(!exportMenuOpen)}
                    style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 6, cursor: "pointer", background: exportMenuOpen ? "#f9fafb" : "#fff" ,color: "#1d4ed8"}}>
                    📤 导出 ▾
                  </button>
                  {exportMenuOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.08)", zIndex: 10, minWidth: 140, overflow: "hidden" }}>
                      {[
                        { fmt: "xlsx", label: "Excel (.xlsx)", hint: "推荐" },
                        { fmt: "csv", label: "CSV (.csv)" },
                        { fmt: "json", label: "JSON (.json)" }
                      ].map(o => (
                        <button key={o.fmt} onClick={() => { exportDb(o.fmt); setExportMenuOpen(false); }}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "8px 12px", fontSize: 13, border: "none", background: "transparent", cursor: "pointer", color: "#374151", textAlign: "left" }}
                          onMouseEnter={e => e.currentTarget.style.background = "#f9fafb"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <span>{o.label}</span>
                          {o.hint && <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace" }}>{o.hint}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={initAddRecord} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", fontSize: 13, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", borderRadius: 6, cursor: "pointer" }}>
                  ＋ 添加记录
                </button>
                <button onClick={clearDbRecords} title="清空记录" style={{ padding: "6px 10px", color: "#f59e0b", border: "none", background: "transparent", cursor: "pointer" }}>
                  🧹
                </button>
                <button onClick={() => { if (window.confirm(`确认删除数据库「${activeDb}」?所有数据将被清除。`)) deleteDb(activeDb); }} style={{ padding: "6px 10px", color: "#ef4444", border: "none", background: "transparent", cursor: "pointer" }}>
                  🗑
                </button>
              </div>

              {view === "search" && (
                <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e7eb", background: "#fafafa" }}>
                  <div style={{ fontFamily: "monospace", fontSize: 11, color: "#888", letterSpacing: "0.08em", marginBottom: 10 }}>筛选条件</div>
                  {filters.map((f, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <select value={f.field} onChange={e => { const nf = [...filters]; nf[i].field = e.target.value; setFilters(nf); }} style={{ minWidth: 110, padding: "5px 8px", border: "1px solid #d1d5db", borderRadius: 5 }}>
                        <option value="">选择字段</option>
                        {meta.fields.map(df => <option key={df.name}>{df.name}</option>)}
                      </select>
                      <select value={f.op} onChange={e => { const nf = [...filters]; nf[i].op = e.target.value; setFilters(nf); }} style={{ minWidth: 80, padding: "5px 8px", border: "1px solid #d1d5db", borderRadius: 5 }}>
                        {["包含", "等于", "大于", "小于", "不含"].map(o => <option key={o}>{o}</option>)}
                      </select>
                      <input value={f.value} onChange={e => { const nf = [...filters]; nf[i].value = e.target.value; setFilters(nf); }} placeholder="值" style={{ flex: 1, minWidth: 120, padding: "5px 8px", border: "1px solid #d1d5db", borderRadius: 5 }} />
                      {filters.length > 1 && (
                        <button onClick={() => setFilters(filters.filter((_, j) => j !== i))} style={{ padding: "4px 8px", color: "#6b7280", border: "none", background: "transparent", cursor: "pointer" }}>✕</button>
                      )}
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <button onClick={() => setFilters([...filters, { field: meta.fields[0]?.name || "", op: "包含", value: "" }])} style={{ fontSize: 12, padding: "4px 10px", border: "1px solid #d1d5db", borderRadius: 5, cursor: "pointer", background: "#fff" }}>
                      ＋ 添加条件
                    </button>
                    <button onClick={() => { setFilterActive(true); setPage(1); setView("records"); }} style={{ fontSize: 12, padding: "4px 14px", background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", borderRadius: 5, cursor: "pointer" }}>
                      应用筛选
                    </button>
                    {filterActive && (
                      <button onClick={() => { setFilterActive(false); setFilters([{ field: "", op: "包含", value: "" }]); }} style={{ fontSize: 12, padding: "4px 10px", border: "1px solid #e5e7eb", borderRadius: 5, cursor: "pointer", background: "#fff", color: "#6b7280" }}>
                        清除筛选
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
                {recordsLoading ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#9ca3af", fontSize: 13 }}>正在加载记录…</div>
                ) : processed.length === 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 200, gap: 8, color: "#9ca3af" }}>
                    <div style={{ fontSize: 30 }}>📭</div>
                    <div style={{ fontSize: 13 }}>{records.length > 0 ? "没有匹配结果" : "暂无记录,点击添加或导入数据"}</div>
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f9fafb", position: "sticky", top: 0, zIndex: 1 }}>
                        {meta.fields.map(f => (
                          <th key={f.name} onClick={() => toggleSort(f.name)}
                            style={{ padding: "9px 14px", textAlign: "left", fontWeight: 500, borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap", color: "#6b7280", cursor: "pointer", userSelect: "none" }}>
                            <span style={{ fontFamily: "monospace", fontSize: 11, marginRight: 5, color: "#9ca3af" }}>{typeIcon[f.type]}</span>
                            {f.name}
                            {sortBy === f.name && (
                              <span style={{ marginLeft: 5, color: "#3b82f6", fontSize: 11 }}>{sortDir === "asc" ? "↑" : "↓"}</span>
                            )}
                          </th>
                        ))}
                        <th style={{ padding: "9px 10px", borderBottom: "1px solid #e5e7eb", width: 40, position: "sticky", right: 0, background: "#f9fafb" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {pagedRecords.map((rec, ri) => (
                        <tr key={rec._id} style={{ borderBottom: "1px solid #f3f4f6", background: ri % 2 === 0 ? "transparent" : "#fafafa" }}>
                          {meta.fields.map(f => (
                            <td key={f.name} style={{ padding: "8px 14px", color: "#1a1a1a", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {f.type === "布尔值" ? (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, padding: "2px 8px", borderRadius: 10, background: rec[f.name] ? "#f0fdf4" : "#f3f4f6", color: rec[f.name] ? "#16a34a" : "#6b7280", border: "1px solid #e5e7eb" }}>
                                  {rec[f.name] ? "✓ 是" : "✗ 否"}
                                </span>
                              ) : f.type === "URL" && rec[f.name] ? (
                                <a href={rec[f.name]} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "none" }}>
                                  {rec[f.name]}
                                </a>
                              ) : (
                                String(rec[f.name] ?? "")
                              )}
                            </td>
                          ))}
                          <td style={{ padding: "8px 10px", position: "sticky", right: 0, background: ri % 2 === 0 ? "#fff" : "#fafafa" }}>
                            <button onClick={() => deleteRecord(rec._id)} style={{ padding: "3px 6px", color: "#9ca3af", border: "none", background: "transparent", cursor: "pointer" }}>
                              🗑
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {importing && (
                  <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", padding: "10px 16px", background: "#1f2937", color: "#fff", borderRadius: 8, fontSize: 12, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
                    <div style={{ width: 80, height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${(importProgress.done / Math.max(1, importProgress.total)) * 100}%`, height: "100%", background: "#60a5fa" }} />
                    </div>
                    正在导入 {importProgress.done.toLocaleString()} / {importProgress.total.toLocaleString()}
                  </div>
                )}
              </div>

              {processed.length > 0 && (
                <div style={{ padding: "8px 20px", borderTop: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 10, background: "#fafafa", fontSize: 12 }}>
                  <span style={{ color: "#6b7280" }}>
                    每页
                    <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ margin: "0 6px", padding: "2px 6px", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 12 }}>
                      {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    条
                  </span>
                  <div style={{ flex: 1 }} />
                  <span style={{ color: "#6b7280" }}>
                    {((curPage - 1) * pageSize + 1).toLocaleString()}–{Math.min(curPage * pageSize, processed.length).toLocaleString()} / {processed.length.toLocaleString()}
                  </span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => setPage(1)} disabled={curPage === 1} style={{ padding: "3px 8px", border: "1px solid #e5e7eb", borderRadius: 4, background: "#fff", cursor: curPage === 1 ? "not-allowed" : "pointer", opacity: curPage === 1 ? 0.4 : 1 }}>«</button>
                    <button onClick={() => setPage(curPage - 1)} disabled={curPage === 1} style={{ padding: "3px 8px", border: "1px solid #e5e7eb", borderRadius: 4, background: "#fff", cursor: curPage === 1 ? "not-allowed" : "pointer", opacity: curPage === 1 ? 0.4 : 1 }}>‹</button>
                    <span style={{ padding: "3px 10px", color: "#374151" }}>
                      <input type="number" value={curPage} min={1} max={totalPages}
                        onChange={e => { const v = Number(e.target.value); if (v >= 1 && v <= totalPages) setPage(v); }}
                        style={{ width: 50, padding: "1px 4px", border: "1px solid #d1d5db", borderRadius: 3, fontSize: 12, textAlign: "center" }} />
                      {" / "}{totalPages}
                    </span>
                    <button onClick={() => setPage(curPage + 1)} disabled={curPage === totalPages} style={{ padding: "3px 8px", border: "1px solid #e5e7eb", borderRadius: 4, background: "#fff", cursor: curPage === totalPages ? "not-allowed" : "pointer", opacity: curPage === totalPages ? 0.4 : 1 }}>›</button>
                    <button onClick={() => setPage(totalPages)} disabled={curPage === totalPages} style={{ padding: "3px 8px", border: "1px solid #e5e7eb", borderRadius: 4, background: "#fff", cursor: curPage === totalPages ? "not-allowed" : "pointer", opacity: curPage === totalPages ? 0.4 : 1 }}>»</button>
                  </div>
                </div>
              )}
            </>
          )}

          {view === "addRecord" && meta && (
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
              <div style={{ maxWidth: 520 }}>
                <div style={{ fontFamily: "monospace", fontSize: 11, color: "#888", letterSpacing: "0.08em", marginBottom: 16 }}>添加记录 → {activeDb}</div>
                {meta.fields.map(f => (
                  <div key={f.name} style={{ marginBottom: 14 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 10, background: "#f3f4f6", padding: "1px 5px", borderRadius: 4, border: "1px solid #e5e7eb" }}>{typeIcon[f.type]}</span>
                      {f.name}
                      <span style={{ color: "#9ca3af" }}>({f.type})</span>
                    </label>
                    {f.type === "布尔值" ? (
                      <div style={{ display: "flex", gap: 8 }}>
                        {["是", "否"].map(opt => (
                          <button key={opt} onClick={() => setNewRecord({ ...newRecord, [f.name]: opt === "是" })}
                            style={{ padding: "6px 18px", background: (newRecord[f.name] === true && opt === "是") || (newRecord[f.name] === false && opt === "否") ? "#eff6ff" : "transparent", border: "1px solid #d1d5db", borderRadius: 6, color: (newRecord[f.name] === true && opt === "是") || (newRecord[f.name] === false && opt === "否") ? "#1d4ed8" : "#6b7280", cursor: "pointer" }}>
                            {opt}
                          </button>
                        ))}
                      </div>
                    ) : f.type === "日期" ? (
                      <input type="date" value={newRecord[f.name] || ""} onChange={e => setNewRecord({ ...newRecord, [f.name]: e.target.value })} style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6 }} />
                    ) : f.type === "数字" ? (
                      <input type="number" value={newRecord[f.name] ?? ""} onChange={e => setNewRecord({ ...newRecord, [f.name]: e.target.value })} style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6 }} />
                    ) : (
                      <input type={f.type === "邮箱" ? "email" : f.type === "URL" ? "url" : "text"} value={newRecord[f.name] || ""} onChange={e => setNewRecord({ ...newRecord, [f.name]: e.target.value })} style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6 }} placeholder={f.type === "邮箱" ? "name@example.com" : f.type === "URL" ? "https://..." : ""} />
                    )}
                  </div>
                ))}
                {recErr && <div style={{ marginBottom: 12, color: "#ef4444", fontSize: 13 }}>{recErr}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button onClick={addRecord} style={{ padding: "8px 20px", background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", borderRadius: 6, cursor: "pointer" }}>
                    保存记录
                  </button>
                  <button onClick={() => setView("records")} style={{ padding: "8px 16px", border: "1px solid #e5e7eb", borderRadius: 6, cursor: "pointer", background: "#fff" }}>取消</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 右下角拖拽手柄:调节整个系统的宽高 */}
        <div
          onMouseDown={startDragApp}
          title="拖动以调整窗口大小"
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: 18,
            height: 18,
            cursor: "nwse-resize",
            background: "linear-gradient(135deg, transparent 0%, transparent 45%, #94a3b8 45%, #94a3b8 55%, transparent 55%, transparent 65%, #94a3b8 65%, #94a3b8 75%, transparent 75%, transparent 85%, #94a3b8 85%, #94a3b8 95%, transparent 95%)",
            zIndex: 20
          }}
        />
      </div>
    </div>
  );
}
function LoginPage({ onLogin }) {
  const [tab, setTab] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const submit = async () => {
    setErr(""); setOk("");
    if (!username.trim() || !password.trim()) return setErr("用户名和密码不能为空");
    if (tab === "register") {
      if (password !== confirm) return setErr("两次密码不一致");
      if (password.length < 6) return setErr("密码至少 6 位");
    }
    setLoading(true);
    try {
      if (tab === "register") {
        const res = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username.trim(), password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "注册失败");
        setOk("注册成功！请登录"); setTab("login"); setPassword(""); setConfirm("");
      } else {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username.trim(), password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "登录失败");
        localStorage.setItem("token", data.token);
        localStorage.setItem("username", username.trim());
        onLogin(username.trim());
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ width: 360, background: "#fff", borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", padding: "36px 28px", border: "1px solid #e5e7eb" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 36 }}>🗄️</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginTop: 8 }}>数据库系统</div>
        </div>
        <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", marginBottom: 20 }}>
          {[{ id: "login", label: "登录" }, { id: "register", label: "注册" }].map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setErr(""); setOk(""); }}
              style={{ flex: 1, padding: "8px 0", background: "transparent", border: "none", borderBottom: tab === t.id ? "2px solid #3b82f6" : "2px solid transparent", color: tab === t.id ? "#1d4ed8" : "#6b7280", fontSize: 14, fontWeight: tab === t.id ? 600 : 400, cursor: "pointer", marginBottom: -1 }}>
              {t.label}
            </button>
          ))}
        </div>
        {["用户名", "密码"].map((label, idx) => (
          <div key={label} style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 6 }}>{label}</label>
            <input type={idx === 1 ? "password" : "text"}
              value={idx === 0 ? username : password}
              onChange={e => idx === 0 ? setUsername(e.target.value) : setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              placeholder={idx === 1 && tab === "register" ? "至少 6 位" : ""}
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
          </div>
        ))}
        {tab === "register" && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 6 }}>确认密码</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14 }} />
          </div>
        )}
        {err && <div style={{ marginBottom: 12, padding: "8px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, fontSize: 13, color: "#991b1b" }}>{err}</div>}
        {ok  && <div style={{ marginBottom: 12, padding: "8px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 13, color: "#166534" }}>{ok}</div>}
        <button onClick={submit} disabled={loading}
          style={{ width: "100%", padding: "10px 0", background: loading ? "#93c5fd" : "#3b82f6", color: "#fff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", marginTop: 4 }}>
          {loading ? "请稍候…" : tab === "login" ? "登 录" : "注 册"}
        </button>
      </div>
    </div>
  );
}

export default function Root() {
  const [user, setUser] = useState(() => localStorage.getItem("username") || null);

  useEffect(() => {
    if (!localStorage.getItem("token")) setUser(null);
  }, []);

  if (!user) return <LoginPage onLogin={(u) => setUser(u)} />;

  return (
    <>
      <div style={{ position: "fixed", top: 10, right: 14, zIndex: 9999, display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.95)", border: "1px solid #e5e7eb", borderRadius: 20, padding: "5px 12px 5px 10px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", fontSize: 13 }}>
        <span>👤</span>
        <span style={{ color: "#374151", fontWeight: 500 }}>{user}</span>
        <button onClick={() => { localStorage.removeItem("token"); localStorage.removeItem("username"); setUser(null); }}
          style={{ padding: "3px 10px", background: "transparent", border: "1px solid #e5e7eb", borderRadius: 12, color: "#6b7280", fontSize: 12, cursor: "pointer" }}>
          退出
        </button>
      </div>
      <App />
    </>
  );
}
function LoginPage({ onLogin }) {
  const [tab, setTab] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const submit = async () => {
    setErr(""); setOk("");
    if (!email.trim() || !password.trim()) return setErr("邮箱和密码不能为空");
    if (!emailValid) return setErr("邮箱格式不正确");
    if (tab === "register") {
      if (password.length < 6) return setErr("密码至少 6 位");
      if (password !== confirm) return setErr("两次密码不一致");
    }
    setLoading(true);
    try {
      const url = tab === "register" ? "/api/register" : "/api/login";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || (tab === "register" ? "注册失败" : "登录失败"));
      if (tab === "register") {
        setOk("注册成功！请登录"); setTab("login"); setPassword(""); setConfirm("");
      } else {
        localStorage.setItem("token", data.token);
        localStorage.setItem("username", email.trim());
        onLogin(email.trim());
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  /* ---------- 样式 ---------- */
  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 14px",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    fontSize: 14,
    background: "#fff",
    color: "#111827",
    colorScheme: "light",
    outline: "none",
    transition: "border-color .15s, box-shadow .15s, background .15s",
  };
  const onFocus = (e) => {
    e.target.style.borderColor = "#6366f1";
    e.target.style.boxShadow = "0 0 0 3px rgba(99,102,241,0.12)";
    e.target.style.background = "#fff";
  };
  const onBlur = (e) => {
    e.target.style.borderColor = "#e5e7eb";
    e.target.style.boxShadow = "none";
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 50%, #5b6df0 100%)",
      backgroundSize: "200% 200%",
      animation: "bgShift 18s ease infinite",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* 背景装饰光斑 */}
      <div style={{ position: "absolute", width: 500, height: 500, top: -150, left: -150, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", width: 400, height: 400, bottom: -120, right: -100, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,0.12), transparent 70%)", pointerEvents: "none" }} />

      <style>{`
        @keyframes bgShift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(16px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .login-card {
          animation: cardIn .45s cubic-bezier(.4,0,.2,1);
        }
        .login-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 25px rgba(99,102,241,0.45);
        }
        .login-btn:active:not(:disabled) {
          transform: translateY(0);
        }
        .tab-btn:hover {
          color: #4f46e5 !important;
        }
      `}</style>

      <div className="login-card" style={{
        width: "100%",
        maxWidth: 400,
        background: "rgba(255,255,255,0.96)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderRadius: 20,
        boxShadow: "0 20px 60px rgba(0,0,0,0.25), 0 1px 0 rgba(255,255,255,0.6) inset",
        padding: "40px 32px 32px",
        border: "1px solid rgba(255,255,255,0.6)",
        position: "relative",
        zIndex: 1,
      }}>
        {/* Logo / 标题 */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            width: 60, height: 60, margin: "0 auto 12px",
            borderRadius: 16,
            background: "linear-gradient(135deg, #667eea, #764ba2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 30, boxShadow: "0 8px 20px rgba(102,126,234,0.4)",
          }}>🗄️</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#111827", letterSpacing: "-0.01em" }}>数据库系统</div>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            {tab === "login" ? "登录以访问你的数据库" : "创建账号，开始使用"}
          </div>
        </div>

        {/* Tab 切换 */}
        <div style={{ display: "flex", background: "#f3f4f6", borderRadius: 10, padding: 4, marginBottom: 22 }}>
          {[{ id: "login", label: "登录" }, { id: "register", label: "注册" }].map(t => (
            <button
              key={t.id}
              className="tab-btn"
              onClick={() => { setTab(t.id); setErr(""); setOk(""); }}
              style={{
                flex: 1,
                padding: "8px 0",
                background: tab === t.id ? "#fff" : "transparent",
                border: "none",
                borderRadius: 8,
                color: tab === t.id ? "#4f46e5" : "#6b7280",
                fontSize: 14,
                fontWeight: tab === t.id ? 600 : 500,
                cursor: "pointer",
                transition: "all .2s",
                boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 邮箱 */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, color: "#374151", marginBottom: 6, fontWeight: 500 }}>邮箱</label>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            onFocus={onFocus}
            onBlur={onBlur}
            placeholder="name@example.com"
            style={inputStyle}
          />
        </div>

        {/* 密码 */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, color: "#374151", marginBottom: 6, fontWeight: 500 }}>密码</label>
          <div style={{ position: "relative" }}>
            <input
              type={showPwd ? "text" : "password"}
              autoComplete={tab === "register" ? "new-password" : "current-password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              onFocus={onFocus}
              onBlur={onBlur}
              placeholder={tab === "register" ? "至少 6 位" : ""}
              style={{ ...inputStyle, paddingRight: 44 }}
            />
            <button
              type="button"
              onClick={() => setShowPwd(s => !s)}
              tabIndex={-1}
              style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                width: 30, height: 30, border: "none", background: "transparent",
                cursor: "pointer", color: "#9ca3af", fontSize: 15, borderRadius: 6,
              }}
              title={showPwd ? "隐藏" : "显示"}
            >
              {showPwd ? "🙈" : "👁"}
            </button>
          </div>
        </div>

        {/* 确认密码 */}
        {tab === "register" && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, color: "#374151", marginBottom: 6, fontWeight: 500 }}>确认密码</label>
            <input
              type={showPwd ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              onFocus={onFocus}
              onBlur={onBlur}
              style={inputStyle}
            />
          </div>
        )}

        {/* 提示 */}
        {err && (
          <div style={{
            marginBottom: 14, padding: "9px 12px",
            background: "#fef2f2", border: "1px solid #fecaca",
            borderRadius: 8, fontSize: 13, color: "#991b1b",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span>⚠</span>{err}
          </div>
        )}
        {ok && (
          <div style={{
            marginBottom: 14, padding: "9px 12px",
            background: "#f0fdf4", border: "1px solid #bbf7d0",
            borderRadius: 8, fontSize: 13, color: "#166534",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span>✓</span>{ok}
          </div>
        )}

        {/* 提交按钮 */}
        <button
          className="login-btn"
          onClick={submit}
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px 0",
            background: loading
              ? "linear-gradient(135deg, #a5b4fc, #c4b5fd)"
              : "linear-gradient(135deg, #6366f1, #8b5cf6)",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "0.02em",
            cursor: loading ? "not-allowed" : "pointer",
            boxShadow: "0 4px 14px rgba(99,102,241,0.35)",
            transition: "transform .15s, box-shadow .2s",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            marginTop: 4,
          }}
        >
          {loading && (
            <span style={{
              width: 14, height: 14, borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.4)",
              borderTopColor: "#fff",
              animation: "spin .7s linear infinite",
            }} />
          )}
          {loading ? "请稍候…" : tab === "login" ? "登 录" : "注 册"}
        </button>

        {/* 底部辅助 */}
        <div style={{ textAlign: "center", marginTop: 18, fontSize: 12, color: "#9ca3af" }}>
          {tab === "login" ? (
            <>还没有账号？<span onClick={() => { setTab("register"); setErr(""); setOk(""); }} style={{ color: "#6366f1", cursor: "pointer", fontWeight: 500 }}>立即注册</span></>
          ) : (
            <>已有账号？<span onClick={() => { setTab("login"); setErr(""); setOk(""); }} style={{ color: "#6366f1", cursor: "pointer", fontWeight: 500 }}>去登录</span></>
          )}
        </div>
      </div>
    </div>
  );
}