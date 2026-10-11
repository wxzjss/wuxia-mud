/* ==========================================================================
   武侠行 · 本地 Mod 文件夹（File System Access API）
   --------------------------------------------------------------------------
   做什么：让用户在网页里授权一个本地文件夹（比如 D:\wuxia-mods），之后
          「下载 Mod」就直接写进那个文件夹，「本地 Mod」也能从那里读取加载。

   为什么要授权：浏览器沙箱不允许网页随便往硬盘写文件。File System Access
   API 让用户**主动选一次**目录，之后 JS 拿到目录句柄，就能在里面建文件了。
   句柄存在 IndexedDB 里，下次打开网页只要权限没被撤销就还能用。

   兼容性：Chrome / Edge 86+ 支持；Firefox / Safari 不支持。
          不支持时全部功能优雅降级成「普通下载到下载文件夹」。

   零依赖，纯浏览器 API。
   ========================================================================== */
(function (global) {
  'use strict';

  const DB_NAME = 'wuxia-mods';
  const DB_STORE = 'handles';
  const DB_KEY = 'modDir';

  /* ------------------------------------------------------------------ *
   *  能力检测
   *
   *  ⚠️ 手机浏览器**一律没有** showDirectoryPicker（移动端 Chrome 也没有，
   *     官方明确不打算支持），所以「文件夹授权」在手机上永远走不通。
   *     别把它当 bug，检测到不支持就走**挑文件**那条路（见 start.js）。
   * ------------------------------------------------------------------ */
  function supported() {
    return typeof global.showDirectoryPicker === 'function' &&
      typeof global.indexedDB !== 'undefined';
  }

  /** 是否是触屏 / 移动端（用来改文案，不改行为） */
  function isMobile() {
    try {
      if (global.navigator && global.navigator.userAgentData &&
        typeof global.navigator.userAgentData.mobile === 'boolean') {
        return global.navigator.userAgentData.mobile;
      }
      const ua = (global.navigator && global.navigator.userAgent) || '';
      return /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|MicroMessenger|QQ\//i.test(ua);
    } catch (e) { return false; }
  }

  /* ------------------------------------------------------------------ *
   *  IndexedDB：持久保存目录句柄（句柄不能存 localStorage，只能存 IDB）
   * ------------------------------------------------------------------ */
  function openDB() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) return reject(new Error('浏览器不支持 IndexedDB'));
      const req = global.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('打开 IndexedDB 失败'));
    });
  }

  async function idbPut(key, val) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(val, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbDel(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ------------------------------------------------------------------ *
   *  句柄状态
   * ------------------------------------------------------------------ */
  let _handle = null;      /* FileSystemDirectoryHandle */

  /**
   * 查询权限，不弹窗。
   * @returns {'granted'|'prompt'|'denied'|'none'}
   */
  async function permissionState() {
    if (!supported()) return 'none';
    if (!_handle) {
      try {
        const h = await idbGet(DB_KEY);
        if (h) _handle = h; else return 'none';
      } catch (e) { return 'none'; }
    }
    try {
      return await _handle.queryPermission({ mode: 'readwrite' });
    } catch (e) {
      return 'prompt';
    }
  }

  /** 当前是否已拿到可写句柄 */
  async function isReady() {
    return (await permissionState()) === 'granted';
  }

  /** 当前文件夹名（没授权返回 ''） */
  function folderName() {
    return _handle && _handle.name ? _handle.name : '';
  }

  /**
   * 让用户挑一个文件夹并申请读写权限。
   * ⚠️ 手机浏览器没有 showDirectoryPicker，返回**可读的**错误码 `unsupported`，
   *    调用方据此改走「挑文件」（别只弹一句「不支持」就完事）。
   * @returns {{ok:boolean, name?:string, error?:string, code?:string, aborted?:boolean}}
   */
  async function pickFolder() {
    if (!supported()) {
      return {
        ok: false, code: 'unsupported',
        error: isMobile()
          ? '手机浏览器不支持文件夹授权，请改用「从文件安装」（挑 zIP/json）'
          : '当前浏览器不支持文件夹授权（请用电脑版 Chrome / Edge）'
      };
    }
    let handle;
    try {
      handle = await global.showDirectoryPicker({ mode: 'readwrite', id: 'wuxia-mods' });
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.name === 'NotAllowedError')) {
        return { ok: false, aborted: true, error: '已取消' };
      }
      return { ok: false, error: e.message || String(e) };
    }
    _handle = handle;
    try { await idbPut(DB_KEY, handle); } catch (e) { /* 存不下也能用，只是刷新后要重选 */ }
    return { ok: true, name: handle.name };
  }

  /** 恢复已保存的句柄并请求权限（用户手势中调用才能弹窗） */
  async function restore(interactive) {
    if (!supported()) return { ok: false, error: '不支持' };
    if (!_handle) {
      try { _handle = await idbGet(DB_KEY); } catch (e) { _handle = null; }
    }
    if (!_handle) return { ok: false, error: '尚未授权任何文件夹' };

    let state;
    try { state = await _handle.queryPermission({ mode: 'readwrite' }); }
    catch (e) { state = 'prompt'; }

    if (state === 'granted') return { ok: true, name: _handle.name };

    if (interactive) {
      try {
        const req = await _handle.requestPermission({ mode: 'readwrite' });
        if (req === 'granted') return { ok: true, name: _handle.name };
        return { ok: false, error: '权限被拒绝' };
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
    }
    return { ok: false, needGesture: true, error: '需要重新授权' };
  }

  /** 忘掉这个文件夹 */
  async function forget() {
    _handle = null;
    try { await idbDel(DB_KEY); } catch (e) { }
    return true;
  }

  /* ------------------------------------------------------------------ *
   *  写 / 读文件
   * ------------------------------------------------------------------ */

  /** 确保目录存在（逐级创建），返回该目录句柄 */
  async function ensureDir(parent, name) {
    return parent.getDirectoryHandle(name, { create: true });
  }

  /**
   * 写一个文件到授权文件夹。
   * @param {string} relPath 相对路径，如 'my_mod/mod.json' 或 'a.zip'
   * @param {Blob|ArrayBuffer|string} data
   */
  async function writeFile(relPath, data) {
    const st = await permissionState();
    if (st !== 'granted') return { ok: false, error: '还没有文件夹写入权限' };

    const parts = String(relPath).split('/').filter(Boolean);
    const fname = parts.pop();
    if (!fname) return { ok: false, error: '文件名不合法' };

    let dir = _handle;
    for (const p of parts) dir = await ensureDir(dir, p);

    const fh = await dir.getFileHandle(fname, { create: true });
    const w = await fh.createWritable();
    if (typeof data === 'string') await w.write(new Blob([data]));
    else await w.write(data);
    await w.close();
    return { ok: true, path: parts.concat(fname).join('/') };
  }

  /** 读一个文本文件，不存在返回 null */
  async function readFile(relPath) {
    const st = await permissionState();
    if (st !== 'granted') return null;
    try {
      const parts = String(relPath).split('/').filter(Boolean);
      const fname = parts.pop();
      let dir = _handle;
      for (const p of parts) dir = await dir.getDirectoryHandle(p);
      const fh = await dir.getFileHandle(fname);
      const f = await fh.getFile();
      return await f.text();
    } catch (e) {
      return null;
    }
  }

  /** 把 Blob 存成文件；若没授权则降级为浏览器普通下载 */
  async function saveOrDownload(blob, filename, relDir) {
    if (await isReady()) {
      const p = relDir ? (relDir + '/' + filename) : filename;
      try {
        const r = await writeFile(p, blob);
        if (r.ok) return { ok: true, mode: 'folder', path: r.path };
      } catch (e) {
        /* 写失败就退回下载 */
      }
    }
    /* 降级：普通下载 */
    const a = document.createElement('a');
    const u = URL.createObjectURL(blob);
    a.href = u; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(u), 5000);
    return { ok: true, mode: 'download', path: filename };
  }

  /* ------------------------------------------------------------------ *
   *  扫描文件夹里的 Mod
   *
   *  认两种结构：
   *    1) 子文件夹里放 mod.json   → my_mod/mod.json   （kind: 'folder'）
   *    2) 根目录下的 .json 文件   → some_mod.json     （kind: 'json'）
   *
   *  @returns {Promise<Array>} 直接返回数组（空数组表示没有 / 没权限）
   *    每项： { kind:'folder'|'json', id, name, version, author,
   *             category, desc, json, files:[{path, file:File}] }
   * ------------------------------------------------------------------ */
  async function scanMods() {
    const st = await permissionState();
    if (st !== 'granted') return [];

    const mods = [];
    try {
      for await (const entry of _handle.values()) {
        if (entry.kind === 'directory') {
          /* 情况 1：子目录里有 mod.json → 整目录当作一个 folder 型 Mod */
          let manifest = null;
          try {
            const fh = await entry.getFileHandle('mod.json');
            const f = await fh.getFile();
            manifest = JSON.parse(await f.text());
          } catch (e) { continue; /* 没 mod.json，跳过 */ }

          /* 递归收集目录下所有文件（相对该子目录） */
          const files = [];
          await collectFiles(entry, '', files);

          const meta = (manifest && manifest._mod) || manifest || {};
          mods.push({
            kind: 'folder',
            folder: entry.name,
            json: manifest,
            files,
            id: String(manifest.id || meta.id || entry.name),
            name: manifest.name || meta.name || entry.name,
            version: manifest.version || meta.version || '1.0.0',
            author: manifest.author || meta.author || '佚名',
            category: manifest.category || meta.category || '综合',
            desc: manifest.desc || manifest.description || meta.desc || ''
          });
        } else if (entry.kind === 'file' && /\.json$/i.test(entry.name)) {
          /* 情况 2：根目录下的 .json 单文件 Mod */
          try {
            const f = await entry.getFile();
            const json = JSON.parse(await f.text());
            if (json && (json.id || json.rooms || json.npcs || json.skills || json.items)) {
              const meta = json._mod || json;
              mods.push({
                kind: 'json',
                folder: '',
                json,
                files: [{ path: 'mod.json', file: f }],
                id: String(json.id || meta.id || entry.name.replace(/\.json$/i, '')),
                name: json.name || meta.name || entry.name,
                version: json.version || meta.version || '1.0.0',
                author: json.author || meta.author || '佚名',
                category: json.category || meta.category || '综合',
                desc: json.desc || json.description || meta.desc || ''
              });
            }
          } catch (e) { /* 非法 JSON 跳过 */ }
        }
      }
    } catch (e) {
      return mods;
    }
    return mods;
  }

  /** 递归收集目录下所有文件，装满 [{path, file}] */
  async function collectFiles(dirHandle, prefix, out) {
    for await (const entry of dirHandle.values()) {
      const rel = prefix ? (prefix + '/' + entry.name) : entry.name;
      if (entry.kind === 'directory') {
        if (entry.name.startsWith('.')) continue;
        await collectFiles(entry, rel, out);
      } else {
        if (entry.name.startsWith('.') || entry.name === 'Thumbs.db') continue;
        try { out.push({ path: rel, file: await entry.getFile() }); } catch (e) { }
      }
    }
    return out;
  }

  /** 单纯读一个文件夹（不要求是 Mod），用于「加载本地文件夹」的原始遍历 */
  async function listDir(relPath) {
    const st = await permissionState();
    if (st !== 'granted') return [];
    let dir = _handle;
    const parts = String(relPath || '').split('/').filter(Boolean);
    for (const p of parts) {
      try { dir = await dir.getDirectoryHandle(p); } catch (e) { return []; }
    }
    const out = [];
    for await (const e of dir.values()) out.push({ name: e.name, kind: e.kind });
    return out;
  }

  /* ------------------------------------------------------------------ *
   *  导出
   * ------------------------------------------------------------------ */
  global.WXLOCAL = {
    supported, isMobile, permissionState, isReady, folderName,
    pickFolder, restore, forget,
    writeFile, readFile, saveOrDownload, scanMods, collectFiles, listDir,
    ensureDir
  };
})(typeof window !== 'undefined' ? window : this);
