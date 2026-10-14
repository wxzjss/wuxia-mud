/**
 * modloader.js — Mod 加载器 / 管理器后端
 *
 * Mod 格式（一个 .zip 或 一个文件夹）：
 *   mymod/
 *     mod.json          ← 必须有，元数据 + 内容（也可以拆成多个 json 文件）
 *     items.json        ← 可选，分散数据
 *     skills.json
 *     npcs.json
 *     rooms.json
 *     quests.json
 *     stories.json
 *     fns.json          ← 声明式函数（安全，无需写代码）
 *     script.js         ← 可选，高级 mod（沙箱执行）
 *     README.md
 *     icon.png
 *
 * mod.json 结构：
 * {
 *   "_mod": {
 *     "id": "wuxing_mountain",
 *     "name": "五行山",
 *     "version": "1.0.0",
 *     "author": "某某",
 *     "description": "新增五行山区域与散人武学",
 *     "category": "地图",        // 地图/剧情/功能/功法/物品/综合
 *     "tags": ["地图","门派"],
 *     "dependencies": [],         // 依赖的 mod id
 *     "conflicts": [],            // 冲突的 mod id
 *     "gameVersion": ">=1.0.0",
 *     "priority": 0               // 越大越后加载（覆盖别人）
 *   },
 *   "items": {...},
 *   "skills": {...},
 *   ...
 * }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zip = require('./zipmini');

const CATEGORIES = ['剧情', '地图', '功能', '功法', '物品', '门派', '任务', '综合', '美化'];

/* 本地私有 Mod 的命名空间目录名。
   来自浏览器授权文件夹的 Mod 都放这里面，和市场下载的 Mod 隔开，
   也不会被「导出 / 上传到 Mod 站」带走。 */
const LOCAL_NS = '_local';

class ModLoader {
  constructor(rootDir) {
    this.root = rootDir;                 // mods/ 目录
    this.statePath = path.join(rootDir, '..', 'mods-state.json');
    this.mods = [];                      // 已发现 mod
    this.state = { enabled: {}, order: [], installedFromWeb: {} };
    this.ensureDirs();
    this.loadState();
    this.scan();
  }

  ensureDirs() {
    if (!fs.existsSync(this.root)) fs.mkdirSync(this.root, { recursive: true });
  }

  loadState() {
    try {
      if (fs.existsSync(this.statePath)) {
        this.state = Object.assign(this.state, JSON.parse(fs.readFileSync(this.statePath, 'utf8')));
      }
    } catch (e) { /* ignore */ }
    /* 盘上快照：reconcileState 只清算**从盘上读来的** enabled 条目——
       构造之后内存里新塞的手动启用（测试预 boot 开 mod、未来 UI 预热路径）
       不算「过期状态」，boot 不得没收（smoke-rules enableModsInMem 判据连带）。 */
    this._diskEnabled = Object.assign({}, this.state.enabled);
  }
  saveState() {
    try { fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf8'); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ *
   * 扫描
   * ------------------------------------------------------------------ */
  scan() {
    this.mods = [];
    if (!fs.existsSync(this.root)) return this.mods;
    const entries = fs.readdirSync(this.root, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      /* `_local` 是本地私有 Mod 的独立命名空间，要扫进去（但不递归其它 _ 目录） */
      if (e.name === LOCAL_NS) {
        const nsDir = path.join(this.root, LOCAL_NS);
        let subs = [];
        try { subs = fs.readdirSync(nsDir, { withFileTypes: true }); } catch (_) { }
        for (const s of subs) {
          if (!s.isDirectory() || s.name.startsWith('.')) continue;
          const m = this.readModDir(path.join(nsDir, s.name));
          if (m) { m.local = true; this.mods.push(m); }
        }
        continue;
      }
      if (e.name.startsWith('.') || e.name.startsWith('_')) continue;
      const dir = path.join(this.root, e.name);
      const m = this.readModDir(dir);
      if (m) this.mods.push(m);
    }
    // 应用顺序
    this.applyOrder();
    /* state 清算（boot 时）——见 reconcileState 注释 */
    this.reconcileState();
    return this.mods;
  }

  /* ------------------------------------------------------------------ *
   * state 清算（主人真机 2026-10-18：新档仍见游侠×4）
   * ------------------------------------------------------------------ */
  /**
   * 过期 enabled 状态清算。根治发布沙箱复用带来的脏 mods-state.json：
   * 早期发布上传过一份 demo 开着的状态，沙箱是同一个（复用），服务端 boot
   * 每次都把它读回来 → demo mod 无中生有地开着 → 主人新档见游侠×4。
   * 口径（主人 2026-10-18 定）：mod.json 现为 enabledByDefault:false 的 mod，
   * state.enabled 里的条目**一律丢弃**（含手动开出来的 true）——
   * 手动启用只在**本会话**内有效（运行时 m.enabled），过期状态不复活 demo。
   * 幂等：干净 state 重跑是 no-op。@returns {string[]} 丢弃的 mod id
   */
  reconcileState() {
    const dropped = [];
    const disk = this._diskEnabled || {};
    for (const m of this.mods) {
      if (m.broken || m.defaultEnabled) continue;
      /* 只清盘上来的条目（脏 mods-state.json 的来路）；本会话内存里
         新加的启用不在快照里，不受清算——见 loadState 的快照注释。 */
      if (this.state.enabled[m.id] !== undefined && disk[m.id] !== undefined) {
        dropped.push(m.id);
        delete this.state.enabled[m.id];
        m.enabled = m.defaultEnabled;   // 回出厂默认（false）
      }
    }
    if (dropped.length) this.saveState();   // 清算结果落盘，脏条目不再回来
    return dropped;
  }

  readModDir(dir) {
    const metaPath = path.join(dir, 'mod.json');
    if (!fs.existsSync(metaPath)) {
      // 兼容：如果目录里只有一个 json，就当 mod.json
      const js = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      if (!js.length) return null;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, js[0]), 'utf8'));
        if (j._mod) return this.buildMod(dir, js[0], j);
      } catch (e) { return null; }
      return null;
    }
    try {
      const j = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      return this.buildMod(dir, 'mod.json', j);
    } catch (e) {
      return { id: path.basename(dir), name: path.basename(dir) + '（解析失败）', dir, broken: true, error: e.message, enabled: false };
    }
  }

  buildMod(dir, entryFile, json) {
    const meta = json._mod || {};
    /* id 取值：_mod.id > 顶层 id > 目录名。
       （手写的 mod.json 常常只有顶层 id，过去一律退化成目录名，
         导致「装进去的 id」和「列表显示的 id」对不上）*/
    const id = meta.id || json.id || path.basename(dir);
    // 找出所有数据文件
    const dataFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== entryFile);
    const files = dataFiles.length ? [entryFile].concat(dataFiles) : [entryFile];
    const readme = ['README.md', 'readme.md', 'README.txt'].map(f => path.join(dir, f)).find(f => fs.existsSync(f));
    let icon = null;
    for (const f of ['icon.png', 'icon.jpg', 'icon.svg', 'cover.png']) {
      if (fs.existsSync(path.join(dir, f))) { icon = path.join(dir, f); break; }
    }
    const stat = fs.statSync(dir);
    const mod = {
      id,
      /* 字段一律「_mod.* 优先，顶层兜底」——
         站上/手写的 mod.json 大多只写顶层字段，只读 _mod 会全退化成默认值 */
      name: meta.name || json.name || id,
      version: meta.version || json.version || '1.0.0',
      author: meta.author || json.author || '佚名',
      description: meta.description || json.description || json.desc || '',
      category: meta.category || json.category || '综合',
      tags: meta.tags || json.tags || [],
      dependencies: meta.dependencies || json.dependencies || json.requires || [],
      conflicts: meta.conflicts || json.conflicts || [],
      gameVersion: meta.gameVersion || json.gameVersion || '*',
      priority: meta.priority || json.priority || 0,
      arrayMode: meta.arrayMode || json.arrayMode || 'replace',
      dir,
      entryFile,
      files,
      dataFiles,
      hasScript: fs.existsSync(path.join(dir, 'script.js')),
      hasFns: files.some(f => f === 'fns.json'),
      icon, readme,
      size: this.dirSize(dir),
      mtime: stat.mtimeMs,
      broken: false,
      /* mod.json 的**出厂默认开关**（enabledByDefault，缺省=开）。
         reconcileState 要用它清算过期 state——单独存一份，别跟 m.enabled 混。 */
      defaultEnabled: ((meta.enabledByDefault !== undefined ? meta.enabledByDefault : json.enabledByDefault) !== false),
      enabled: this.state.enabled[id] !== undefined
        ? !!this.state.enabled[id]
        : ((meta.enabledByDefault !== undefined ? meta.enabledByDefault : json.enabledByDefault) !== false),
      counts: this.countContent(files, dir),
      /* 本地私有 Mod（来自浏览器授权文件夹）——不会被上传/导出带走 */
      local: !!(json.__local || meta.__local),
      localSource: json.__localSource || meta.__localSource || null,
    };
    return mod;
  }

  dirSize(dir) {
    let s = 0;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else { try { s += fs.statSync(p).size; } catch (_) { } }
      }
    };
    try { walk(dir); } catch (_) { }
    return s;
  }

  countContent(files, dir) {
    const c = { items: 0, skills: 0, npcs: 0, rooms: 0, quests: 0, regions: 0, sects: 0, stories: 0, events: 0, dialogues: 0, others: 0 };
    for (const f of files) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        for (const k of Object.keys(c)) {
          if (j[k]) c[k] += Array.isArray(j[k]) ? j[k].length : Object.keys(j[k]).length;
        }
      } catch (_) { }
    }
    return c;
  }

  /* ------------------------------------------------------------------ *
   * 启用 / 排序 / 依赖
   * ------------------------------------------------------------------ */
  applyOrder() {
    const order = this.state.order || [];
    this.mods.sort((a, b) => {
      const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return (a.priority - b.priority) || a.name.localeCompare(b.name);
    });
  }

  setEnabled(id, on) {
    this.state.enabled[id] = !!on;
    const m = this.mods.find(x => x.id === id);
    if (m) m.enabled = !!on;
    this.saveState();
    return { ok: true };
  }

  setOrder(ids) {
    this.state.order = ids.slice();
    for (const id of ids) {
      const m = this.mods.find(x => x.id === id);
      if (m) m.enabled = true;
    }
    this.saveState();
    this.applyOrder();
    return { ok: true, mods: this.mods.map(m => m.id) };
  }

  move(id, dir) {
    const ids = this.mods.map(m => m.id);
    const i = ids.indexOf(id);
    if (i < 0) return { ok: false };
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return { ok: false };
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return this.setOrder(ids);
  }

  /** 计算加载顺序（含依赖拓扑排序） */
  resolveLoadOrder() {
    const enabled = this.mods.filter(m => m.enabled && !m.broken);
    const byId = {};
    for (const m of this.mods) byId[m.id] = m;
    const out = [];
    const visiting = new Set(), done = new Set();
    const problems = [];
    const visit = (m, chain) => {
      if (done.has(m.id)) return;
      if (visiting.has(m.id)) { problems.push({ level: 'error', mod: m.id, msg: `依赖成环：${chain.join(' → ')} → ${m.id}` }); return; }
      visiting.add(m.id);
      for (const dep of m.dependencies) {
        const d = byId[dep];
        if (!d) { problems.push({ level: 'warn', mod: m.id, msg: `缺少依赖 mod「${dep}」，本 mod 可能无法正常运行` }); continue; }
        if (!d.enabled) { problems.push({ level: 'warn', mod: m.id, msg: `依赖的 mod「${d.name}」未启用，已自动启用` }); d.enabled = true; this.state.enabled[d.id] = true; }
        visit(d, chain.concat(m.id));
      }
      for (const cf of m.conflicts) {
        const c = byId[cf];
        if (c && c.enabled) problems.push({ level: 'error', mod: m.id, msg: `与已启用的 mod「${c.name}」冲突！` });
      }
      visiting.delete(m.id); done.add(m.id); out.push(m);
    };
    // 按用户顺序优先
    const ordered = this.mods.filter(m => m.enabled && !m.broken);
    for (const m of ordered) visit(m, []);
    this.saveState();
    return { order: out, problems };
  }

  /** 得到给 World.loadMods 的列表 */
  getEnabledModList() {
    const r = this.resolveLoadOrder();
    return r.order.map(m => ({
      dir: m.dir, enabled: true, priority: m.priority, id: m.id, name: m.name,
      version: m.version, files: m.files, arrayMode: m.arrayMode, meta: m,
    }));
  }

  /* ------------------------------------------------------------------ *
   * 导入 / 导出 / 删除
   * ------------------------------------------------------------------ */
  /** 从 zip 安装 */
  installFromZip(zipPath, opts) {
    opts = opts || {};
    let z;
    try { z = zip.readZip(zipPath); } catch (e) { return { ok: false, msg: '不是有效的 zip 文件：' + e.message }; }
    const entries = z.getEntries();
    // 找到 mod.json 的位置（可能在根或一层子目录）
    let manifestEntry = entries.find(e => e.entryName.replace(/\\/g, '/').endsWith('mod.json') && !e.isDirectory);
    let manifest = null, baseDir = '';
    if (manifestEntry) {
      try {
        manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
        baseDir = manifestEntry.entryName.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
      } catch (e) { return { ok: false, msg: 'mod.json 不是合法 JSON：' + e.message }; }
    } else {
      // 尝试找任何含 _mod 的 json
      const jsEntry = entries.find(e => !e.isDirectory && e.entryName.endsWith('.json'));
      if (!jsEntry) return { ok: false, msg: '压缩包内找不到 mod.json，不像是 mod 文件。' };
      try { manifest = JSON.parse(jsEntry.getData().toString('utf8')); } catch (e) { }
      if (!manifest || !manifest._mod) return { ok: false, msg: '压缩包内找不到有效的 mod.json（缺少 _mod 元数据）。' };
      baseDir = jsEntry.entryName.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    }
    const meta = manifest._mod || {};
    let id = (opts.id || meta.id || manifest.id || path.basename(zipPath, '.zip')).replace(/[^\w\u4e00-\u9fa5.-]/g, '_');
    /* namespace：装到子命名空间下（本地私有 Mod 用 '_local'） */
    const nsRoot = opts.namespace ? path.join(this.root, opts.namespace) : this.root;
    if (opts.namespace) { try { fs.mkdirSync(nsRoot, { recursive: true }); } catch (e) { } }
    let targetDir = path.join(nsRoot, id);
    if (fs.existsSync(targetDir) && opts.overwrite) {
      // 覆盖前备份
      try {
        const bak = targetDir + '.bak_' + Date.now();
        fs.renameSync(targetDir, bak);
      } catch (e) { }
    }
    if (fs.existsSync(targetDir)) {
      const old = this.readModDir(targetDir);
      const newerOk = opts.overwrite;
      if (!newerOk && !opts.allowReplace) {
        // 自动改名安装
        let i = 2;
        while (fs.existsSync(path.join(nsRoot, id + '_' + i))) i++;
        id = id + '_' + i;
        targetDir = path.join(nsRoot, id);
      }
    }
    try {
      fs.mkdirSync(targetDir, { recursive: true });
      const prefix = baseDir ? baseDir + '/' : '';
      for (const e of entries) {
        if (e.isDirectory) continue;
        let name = e.entryName.replace(/\\/g, '/');
        if (prefix && name.startsWith(prefix)) name = name.slice(prefix.length);
        if (!name || name.includes('..')) continue;
        if (name.startsWith('__MACOSX') || name.endsWith('.DS_Store')) continue;
        const outPath = path.join(targetDir, name);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, e.getData());
      }
    } catch (e) {
      return { ok: false, msg: '解压失败：' + e.message };
    }
    // 补 id / 本地标记（_mod.id 与顶层 id 都写，保持两边一致）
    try {
      const mf = path.join(targetDir, 'mod.json');
      if (fs.existsSync(mf)) {
        const j = JSON.parse(fs.readFileSync(mf, 'utf8'));
        j.id = id;
        j._mod = j._mod || {};
        j._mod.id = id;
        if (opts.markLocal) { j.__local = true; j.__localSource = 'browser-folder'; }
        fs.writeFileSync(mf, JSON.stringify(j, null, 2), 'utf8');
      }
    } catch (e) { }
    this.state.enabled[id] = opts.enable !== false;
    this.saveState();
    this.scan();
    const installed = this.mods.find(m => m.id === id);
    return { ok: true, mod: installed, id, msg: `Mod「${installed ? installed.name : id}」安装成功！` };
  }

  /** 从文件夹导入（拷贝） */
  installFromFolder(srcDir, opts) {
    opts = opts || {};
    const m = this.readModDir(srcDir);
    if (!m) return { ok: false, msg: '该文件夹里没有找到 mod.json。' };
    /* id 优先级：opts.id > mod.json 里的 _mod.id / 顶层 id > 文件夹名
       （buildMod 只认 _mod.id，所以这里要自己再读一遍顶层 id——
         本地文件夹里的 mod.json 大多是顶层 id）*/
    let id = opts.id || '';
    if (!id) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(srcDir, 'mod.json'), 'utf8'));
        id = (raw._mod && raw._mod.id) || raw.id || '';
      } catch (e) { }
    }
    if (!id) id = m.id;
    id = String(id).replace(/[^\w\u4e00-\u9fa5.-]/g, '_');
    const nsRoot = opts.namespace ? path.join(this.root, opts.namespace) : this.root;
    if (opts.namespace) { try { fs.mkdirSync(nsRoot, { recursive: true }); } catch (e) { } }
    let targetDir = path.join(nsRoot, id);
    if (fs.existsSync(targetDir) && opts.overwrite) {
      try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (e) { }
    }
    if (fs.existsSync(targetDir)) {
      let i = 2; while (fs.existsSync(path.join(nsRoot, id + '_' + i))) i++;
      id = id + '_' + i; targetDir = path.join(nsRoot, id);
    }
    try {
      this.copyDir(srcDir, targetDir);
    } catch (e) { return { ok: false, msg: '拷贝失败：' + e.message }; }
    /* 归一化 mod.json：id 落到 _mod.id 和顶层 id（两边都写，谁读都能读到） */
    try {
      const mf = path.join(targetDir, 'mod.json');
      if (fs.existsSync(mf)) {
        const j = JSON.parse(fs.readFileSync(mf, 'utf8'));
        j.id = id;
        j._mod = j._mod || {};
        j._mod.id = id;
        if (opts.markLocal) { j.__local = true; j.__localSource = 'browser-folder'; }
        fs.writeFileSync(mf, JSON.stringify(j, null, 2), 'utf8');
      }
    } catch (e) { }
    this.state.enabled[id] = true;
    this.saveState();
    this.scan();
    return { ok: true, id, msg: `Mod 安装成功！` };
  }

  copyDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const s = path.join(src, e.name), d = path.join(dst, e.name);
      if (e.isDirectory()) this.copyDir(s, d);
      else fs.copyFileSync(s, d);
    }
  }

  /** 打包成 zip（导出/上传用） */
  exportToZip(modId, outPath) {
    const m = this.mods.find(x => x.id === modId);
    if (!m) return { ok: false, msg: '找不到该 mod。' };
    /* 本地私有 Mod（浏览器官网文件夹授权来的）不允许导出/上传，
       避免把别人机器上的私有内容混进公共 Mod 站。 */
    if (m.local) return { ok: false, msg: '本地私有 Mod 不能导出或上传（只能自己用）。' };
    const w = new zip.ZipWriter();
    try {
      w.addFolder(m.dir, '');
      const size = w.writeZip(outPath);
      return { ok: true, path: outPath, size };
    } catch (e) { return { ok: false, msg: e.message }; }
  }

  remove(id, hard) {
    const m = this.mods.find(x => x.id === id);
    if (!m) return { ok: false, msg: '找不到该 mod。' };
    try {
      if (hard === false) {
        // 只禁用
        this.state.enabled[id] = false;
      } else {
        const trash = path.join(this.root, '..', '.mod-trash');
        fs.mkdirSync(trash, { recursive: true });
        const target = path.join(trash, id + '_' + Date.now());
        fs.renameSync(m.dir, target);
        delete this.state.enabled[id];
        this.state.order = (this.state.order || []).filter(x => x !== id);
      }
      this.saveState();
      this.scan();
      return { ok: true, msg: hard === false ? '已禁用。' : '已移入回收站。' };
    } catch (e) { return { ok: false, msg: e.message }; }
  }

  /** 校验一个 mod 目录（制作器 / 上传前用） */
  validateModDir(dir) {
    const res = { ok: true, errors: [], warnings: [], info: {} };
    const m = this.readModDir(dir);
    if (!m) { res.ok = false; res.errors.push('找不到 mod.json（或格式错误）'); return res; }
    if (!m.id) { res.ok = false; res.errors.push('缺少 mod id'); }
    if (/[^\w\u4e00-\u9fa5.-]/.test(m.id || '')) res.warnings.push('mod id 含有特殊字符，建议只用字母数字下划线');
    if (!m.name) res.warnings.push('建议填写 mod 名称');
    if (!m.description) res.warnings.push('建议填写 mod 简介（网站上会显示）');
    if (!CATEGORIES.includes(m.category)) res.warnings.push(`分类「${m.category}」不在推荐列表 ${CATEGORIES.join('/')} 中`);
    // 内容校验
    try {
      const c = countContentValidation(dir, m.files);
      res.info = c.info;
      res.errors = res.errors.concat(c.errors);
      res.warnings = res.warnings.concat(c.warnings);
    } catch (e) { res.warnings.push('内容校验跳过：' + e.message); }
    if (res.errors.length) res.ok = false;
    res.mod = m;
    return res;
  }
}

function countContentValidation(dir, files) {
  const info = { items: 0, skills: 0, npcs: 0, rooms: 0, quests: 0, regions: 0, sects: 0, dialogues: 0, stories: 0, events: 0 };
  const errors = [], warnings = [];
  const all = {};
  for (const f of files) {
    const fp = path.join(dir, f);
    if (!fs.existsSync(fp)) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(fp, 'utf8')); }
    catch (e) { errors.push(`${f} 不是合法 JSON：${e.message}`); continue; }
    for (const k of Object.keys(j)) {
      if (k === '_mod' || k === 'meta' || k === 'functions') continue;
      if (Array.isArray(j[k])) {
        all[k] = all[k] || {};
        for (const it of j[k]) { if (it && it.id) all[k][it.id] = it; }
      } else if (j[k] && typeof j[k] === 'object') {
        all[k] = Object.assign(all[k] || {}, j[k]);
      }
      if (info[k] !== undefined && all[k]) info[k] = Object.keys(all[k]).length;
    }
  }
  // 房间出口检查
  for (const id of Object.keys(all.rooms || {})) {
    const r = all.rooms[id];
    for (const d of Object.keys(r.exits || {})) {
      const ex = r.exits[d];
      const tid = typeof ex === 'string' ? ex : ex.to;
      if (tid && !(all.rooms[tid]) && !['__external__'].includes(tid)) {
        warnings.push(`房间「${r.name || id}」的出口 ${d} 指向 ${tid}（若是引用游戏原版房间可忽略此提示）`);
      }
    }
  }
  for (const id of Object.keys(all.npcs || {})) {
    const n = all.npcs[id];
    if (n.skills) for (const k of Object.keys(n.skills)) {
      if (n.skills[k] && !all.skills[n.skills[k]]) warnings.push(`NPC「${n.name || id}」引用的武学 ${n.skills[k]} 不在本 mod 中（可能来自原版或其它 mod）`);
    }
  }
  return { info, errors, warnings };
}

module.exports = { ModLoader, CATEGORIES };
