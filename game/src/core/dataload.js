/* ==========================================================================
 * game/src/core/dataload.js —— 数据加载层（闸一 · fail-fast）
 * --------------------------------------------------------------------------
 * 为什么要把加载层从 world.js 里抽出来：
 *
 *   `World#loadBaseData()` 原来长这样（world.js:232-261 的旧实现）：
 *
 *       try { JSON.parse(raw) } catch (e) { this.modLog.push({level:'error', …}) }
 *
 *   —— **坏 JSON 被吞掉，只往 modLog 塞一条 error，引擎照常启动、游戏照常能玩，
 *      而那半个文件里的内容一条都取不到。**
 *   实测代价（2026-10-11，见 tools/check-data-load.js 头注）：
 *   `102_classic_quests.json` 5 处引号写成单引号 ⇒ 5 条任务全部取不到，
 *   表现为「接任务 → 没有这个任务」，**不崩、不报错**，回归 131 套全绿。
 *
 *   内容大改（房间重写 200 间、NPC 台词 453→2500、武学 761→180）是一次
 *   **几百个文件同时动手**的手术。加载层还在「吞错」的话，写错一个引号
 *   的代价是「那一片内容静默消失」，且要等有人玩到那儿才发现。
 *   所以加载层的第一原则改成：**宁可起不来，不许静默少内容。**
 *
 * 这个模块守四件事：
 *   ① JSON 解析失败 ⇒ 抛错，错误里带 **文件名 + 行号 + 列号 + 原始片段**（不再静默）
 *   ② 结构不合法（集合键是原语 / 数组条目缺 id）⇒ 抛错，同样带文件名
 *   ③ 分片按 **数值前缀** 排序（`10_` 在 `101_` 之前，旧版字典序正相反）
 *   ④ 分片叠加是 **深合并**（`mergeData`/`mergeEntry` 走 utils.deepMerge，
 *      后一片「只补 exits」不会把前一片的 name 冲掉）—— 由
 *      tools/data-load-check.js 端对端断言，并有浅合并反向对照
 *
 * ⚠️ 边界：本模块只管「把 JSON 读进来 + 校验形状」。
 *    合并语义（`mergeData` / `mergeEntry`）仍在 world.js —— 那是被
 *    Mod 系统共用的入口，动它要连 Mod 一起验。本模块只调用它。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { deepMerge } = require('./utils');

/**
 * 受管集合键。**必须与 world.js#mergeData 里的 `collections` 逐一对应。**
 * 漂移由 tools/data-load-check.js 直接读 world.js 源码比对守住（第 ⑦ 组）。
 */
const COLLECTIONS = ['attrs', 'traits', 'items', 'skills', 'books', 'recipes', 'sects', 'npcs',
  'rooms', 'regions', 'quests', 'dialogues', 'shops', 'events', 'stories', 'endings',
  'achievements', 'monsters', 'herbs', 'songs', 'ranks'];

/** 每个文件最多报多少条结构问题（防一个文件刷屏，剩下的给总数） */
const MAX_PROBLEMS_PER_FILE = 5;

/* ---------------------------------------------------------------- *
 * 来源标记 —— 主数据与 Mod **分级不同**，报错里必须一眼分得清
 *
 *   game/data/ 是我们自己的内容：坏了就**硬失败**（宁可起不来，不许静默少内容）。
 *   mods/      是玩家装的：坏了要**响亮地报出来**，但**不许拖垮 boot** ——
 *              不能因为某个玩家装了个坏 Mod，游戏就起不来。
 *   两条路的错误信息因此必须各自点名自己的来源，否则排查时第一件事
 *   「这是我们的锅还是 Mod 的锅」都答不上来。
 * ---------------------------------------------------------------- */
const SRC_BASE = '主数据(game/data/)';
const SRC_MOD = 'Mod(mods/)';

/* ---------------------------------------------------------------- *
 * 错误类型
 * ---------------------------------------------------------------- */

class DataLoadError extends Error {
  constructor(message, problems) {
    super(message);
    this.name = 'DataLoadError';
    /* `loadMods` 的 catch 用这个标记区分「该抛的」和「可以记一笔继续的」 */
    this.isDataLoadError = true;
    this.problems = problems || [];
  }
}

/* ---------------------------------------------------------------- *
 * 定位：位置 ⇄ 行列、原始片段
 * ---------------------------------------------------------------- */

/** 把字符串偏移换算成 1 基的 {line, col} */
function locate(text, pos) {
  const p = Math.max(0, Math.min(pos, text.length));
  const before = text.slice(0, p);
  const lines = before.split(/\r\n|\r|\n/);
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;
  return { line, col };
}

/** 取错误行前后各一行，并在错误列下面打一个 ^ */
function snippet(text, line, col) {
  const lines = text.split(/\r\n|\r|\n/);
  const i = Math.max(0, Math.min(line - 1, lines.length - 1));
  const from = Math.max(0, i - 1);
  const to = Math.min(lines.length - 1, i + 1);
  const out = [];
  const width = String(to + 1).length;
  for (let n = from; n <= to; n++) {
    const mark = (n === i) ? '>' : ' ';
    out.push(mark + ' ' + String(n + 1).padStart(width) + ' | ' + lines[n]);
    if (n === i) {
      out.push('  ' + ' '.repeat(width) + ' | ' + ' '.repeat(Math.max(0, col - 1)) + '^');
    }
  }
  return out.join('\n');
}

/* ---------------------------------------------------------------- *
 * 兜底扫描器：V8 有一部分 JSON 错误不给 position
 *
 * 实测（Node 22 / V8 12.x）两类消息：
 *   带位置： "…in JSON at position 22 (line 4 column 1)"   ← 直接用
 *   不带位置："Unexpected token ''', …\" is not valid JSON" ← 正是历史上
 *              `102_classic_quests.json` 那次引号写错的类型！
 * 所以必须有一个兜底：这里做一个**只查形状不做完整解析**的扫描，
 * 抓三类最常见的：字符串里的裸控制字符、字符串没闭合、串外出现非法字符
 * （单引号 / 裸 token / 重复逗号 / 逗号后直接闭合）。
 * ---------------------------------------------------------------- */
function scanJsonErrorPosition(text) {
  let i = 0;
  const n = text.length;
  const isWs = c => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  /* 串外允许出现的结构字符与值首字符 */
  const OK_OUTSIDE = '{}[],:"\'+-.0123456789eEtrufalsn';
  while (i < n) {
    const c = text[i];
    if (isWs(c)) { i++; continue; }
    if (c === '"') {
      i++;
      let closed = false;
      while (i < n) {
        const d = text[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '"') { i++; closed = true; break; }
        const code = text.charCodeAt(i);
        if (code < 0x20) return { pos: i, why: '字符串里出现了裸换行/制表符（要用 \\n / \\t 转义）' };
        i++;
      }
      if (!closed) return { pos: Math.min(n, i), why: '字符串没有闭合（引号不成对，多半是把 " 写成了 \'）' };
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < n && isWs(text[j])) j++;
      if (j >= n) return { pos: i, why: '逗号后面没有内容' };
      if (text[j] === '}' || text[j] === ']') return { pos: j, why: '多余逗号（最后一个元素后面多了个 ,）' };
      if (text[j] === ',') return { pos: j, why: '连续两个逗号' };
      i = j;
      continue;
    }
    if (c === ':') {
      let j = i + 1;
      while (j < n && isWs(text[j])) j++;
      if (j >= n) return { pos: i, why: '冒号后面没有值' };
      if (text[j] === '}' || text[j] === ']') return { pos: j, why: '冒号后面直接闭合了（缺值）' };
      i = j;
      continue;
    }
    if (OK_OUTSIDE.indexOf(c) < 0) {
      return { pos: i, why: '不该出现的字符 ' + JSON.stringify(c) + '（多半是把 " 写成了 \'）' };
    }
    /* 单引号在串外是合法的「下一个 token」起点吗？不是 —— JSON 里字符串
       只能用双引号。上面 OK_OUTSIDE 放行它是为了走到这里给一句人话。 */
    if (c === "'") return { pos: i, why: '单引号 —— JSON 的字符串必须用双引号 "' };
    /* 数字/字面量：整段吞掉，交由 JSON.parse 判定细节 */
    i++;
  }
  return null;
}

/* ---------------------------------------------------------------- *
 * 读 + 解析（fail-fast）
 * ---------------------------------------------------------------- */

/**
 * 解析一个数据文件。失败时抛 DataLoadError（带文件名/行列/片段/来源）。
 * @param {string} source 来源标记（SRC_BASE / SRC_MOD），决定错误信息的抬头
 * @returns {{json:*, bom:boolean}}
 */
function parseJsonFile(file, label, source) {
  const src = source || SRC_BASE;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new DataLoadError('[' + src + '] 读不到数据文件 ' + file + '：' + e.message,
      [{ file, source: src, text: '读不到：' + e.message }]);
  }
  /* BOM 是编码产物不是内容，剥掉后可以正常解析 —— 但**不静默**，
     记一条 warn 点名文件，让作者知道该另存为「无 BOM UTF-8」。 */
  const bom = raw.charCodeAt(0) === 0xFEFF;
  if (bom) raw = raw.slice(1);

  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw syntaxError(file, raw, e, src);
  }
  return { json, bom, label: label || path.basename(file) };
}

function syntaxError(file, raw, e, src) {
  const msg = String((e && e.message) || e);
  let pos = NaN, line = NaN, col = NaN, why = 'JSON 语法错误';

  const mLC = /\(line (\d+) column (\d+)\)/.exec(msg);
  const mPos = /\bat position (\d+)\b/.exec(msg);
  if (mLC) { line = parseInt(mLC[1], 10); col = parseInt(mLC[2], 10); }
  if (mPos) pos = parseInt(mPos[1], 10);

  if (!Number.isFinite(line)) {
    if (!Number.isFinite(pos)) {
      const scan = scanJsonErrorPosition(raw);
      if (scan) { pos = scan.pos; why = scan.why; }
      else pos = 0;
    }
    const lc = locate(raw, pos);
    line = lc.line; col = lc.col;
  }
  if (!Number.isFinite(pos)) pos = 0;

  /* V8 的句子是英文的（"Expected ',' or '}' after property value in JSON"），
     对改数据的同学不友好，翻成一句人话挂在后面。 */
  const hint = humanizeSyntax(msg, why);
  const block = snippet(raw, line, col);
  const text = '第 ' + line + ' 行第 ' + col + ' 列 · ' + hint + '\n' + block;
  return new DataLoadError(
    '[' + src + '] 数据文件解析失败：' + file + '（第 ' + line + ' 行第 ' + col + ' 列）\n' + hint + '\n' + block,
    [{ file, source: src, line, col, text: text, raw: msg }]
  );
}

function humanizeSyntax(msg, scanWhy) {
  if (scanWhy && /单引号|没有闭合|裸换行|多余逗号|连续两个逗号/.test(scanWhy)) return scanWhy + '（原文：' + msg + '）';
  if (/Bad control character/.test(msg)) return '字符串里出现了裸换行/制表符，要用 \\n / \\t 转义';
  if (/Expected double-quoted property name/.test(msg)) return '这里该是一个 "键名"，多半是多了个逗号';
  if (/after property value|Expected ',' or '}'/.test(msg)) return '一个键值对写完了却没闭合，多半是漏了 } 或多了逗号';
  if (/Unexpected end of JSON input/.test(msg)) return '文件没写完（括号没配平就到结尾了）';
  if (/is not valid JSON/.test(msg)) return 'JSON 结构不成立（原文：' + msg + '）';
  return msg;
}

/* ---------------------------------------------------------------- *
 * 结构校验（fail-fast）：只查「会被加载器静默丢掉」的那几种形状
 * ---------------------------------------------------------------- */

/**
 * @returns {string[]} 问题列表（空数组 = 通过）
 */
function validateDataFile(json, label) {
  const out = [];
  const push = s => { if (out.length < MAX_PROBLEMS_PER_FILE) out.push(s); };
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    out.push(label + '：顶层必须是 JSON 对象（{}），实际是 ' + (Array.isArray(json) ? '数组' : typeof json));
    return out;
  }
  for (const k of COLLECTIONS) {
    if (!Object.prototype.hasOwnProperty.call(json, k)) continue;
    const v = json[k];
    if (v === null || typeof v !== 'object') {
      /* 旧实现：`typeof json[k] === 'object'` 不成立 ⇒ 整个键被跳过，
         一个字都不说。这里必须响。 */
      push(label + '：键 "' + k + '" 必须是对象或数组，实际是 ' + (v === null ? 'null' : typeof v)
        + '（写成这样整个键会被加载器静默忽略）');
      continue;
    }
    if (!Array.isArray(v)) continue;
    for (let i = 0; i < v.length; i++) {
      const it = v[i];
      if (!it || typeof it !== 'object') {
        push(label + '：' + k + '[' + i + '] 不是对象（数组形式每条都得是一个带 id 的记录）');
        continue;
      }
      if (!it.id || typeof it.id !== 'string') {
        /* 旧实现：`if (!item || !item.id) continue;` —— 缺 id 的条目**直接丢**，
           这就是「改内容改到一半，那几条就是不在了」的入口。 */
        push(label + '：' + k + '[' + i + '] 缺 id —— 无 id 的条目会被加载器静默丢弃');
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------- *
 * 文件名排序：数值前缀优先
 *
 * 旧实现用 `.sort()`（字典序）：`"101_classic_npcs.json" < "10_skills.json"`，
 * 因为第 3 个字符 '1'(0x31) < '_'(0x5F)。于是**编号大反而先加载**，
 * 分片「谁覆盖谁」完全看不出规律。改成分两段比：先比数字，再比剩余部分。
 * ---------------------------------------------------------------- */
function compareDataFileName(a, b) {
  const ma = /^(\d+)_/.exec(a), mb = /^(\d+)_/.exec(b);
  const na = ma ? parseInt(ma[1], 10) : Number.MAX_SAFE_INTEGER;
  const nb = mb ? parseInt(mb[1], 10) : Number.MAX_SAFE_INTEGER;
  if (na !== nb) return na - nb;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** 列出一个数据目录里该被加载的文件（已排序） */
function listDataFiles(dir) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.startsWith('.') && /^\d+_/.test(f))
    .sort(compareDataFileName);
}

/* ---------------------------------------------------------------- *
 * 主入口
 * ---------------------------------------------------------------- */

/**
 * 加载基础数据。与旧实现的两点不同：
 *   1) 先「全读全验」再「逐个合并」—— 坏文件一次全点名，不用修一个跑一次；
 *   2) 有任何问题 ⇒ 抛 DataLoadError，不再 push 一条 error 然后继续。
 * @returns {number} 合并进来的文件数
 */
function loadBaseData(world) {
  const problems = [];
  const loaded = [];

  for (const dir of (world.dataDirs || [])) {
    if (!fs.existsSync(dir)) continue;
    for (const f of listDataFiles(dir)) {
      const fp = path.join(dir, f);
      let r;
      try {
        r = parseJsonFile(fp, f, SRC_BASE);
      } catch (e) {
        if (e && e.isDataLoadError && e.problems && e.problems.length) {
          for (const p of e.problems) problems.push(p);
        } else {
          problems.push({ file: fp, source: SRC_BASE, text: String((e && e.message) || e) });
        }
        continue;
      }
      if (r.bom) {
        world.modLog.push({ level: 'warn', msg: r.label + ' 带 BOM，已剥掉后解析（建议另存为无 BOM UTF-8）' });
      }
      for (const p of validateDataFile(r.json, f)) problems.push({ file: fp, source: SRC_BASE, text: p });
      loaded.push({ file: fp, name: f, json: r.json });
    }
    /* 命名不合规的文件：保持旧行为，只警告不拦（它本来就没被加载） */
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.json') && (f.startsWith('.') || !/^\d+_/.test(f))) {
        world.modLog.push({ level: 'warn', msg: `数据目录里的 ${f} 命名不合规范（应为 NN_名字.json），已跳过。` });
      }
    }
  }

  if (problems.length) {
    /* 抬头**点名来源**：主数据硬失败，Mod 不在此列（Mod 走 loadMods 的记错路径）。
       排查时「这是我们的锅还是 Mod 的锅」必须是第一眼就能答上来的事。 */
    const head = '【主数据加载失败 · 来自 game/data/】' + problems.length + ' 处问题，拒绝带着半个世界继续跑：';
    const body = problems.map((p, i) => {
      const where = p.file + (p.line ? '（第 ' + p.line + ' 行第 ' + p.col + ' 列）' : '');
      return '  ' + (i + 1) + ') ' + where + '\n     ' + String(p.text).split('\n').join('\n     ');
    }).join('\n');
    const msg = head + '\n' + body;
    /* 仍然记一笔：万一上层 catch 了，modLog 里也留得下现场 */
    world.modLog.push({ level: 'error', msg: head + '（详见抛出的 DataLoadError）' });
    throw new DataLoadError(msg, problems);
  }

  for (const it of loaded) {
    world.mergeData(it.json, { name: '基础数据:' + it.name, base: true });
  }
  return loaded.length;
}

/** 把 problems 排成一段能直接贴进工单的文本（守卫脚本用） */
function formatProblems(problems) {
  return (problems || []).map((p, i) =>
    (i + 1) + ') ' + p.file + (p.line ? ':' + p.line + ':' + p.col : '') + '  ' + p.text
  ).join('\n');
}

module.exports = {
  COLLECTIONS,
  DataLoadError,
  SRC_BASE,
  SRC_MOD,
  compareDataFileName,
  listDataFiles,
  locate,
  snippet,
  scanJsonErrorPosition,
  parseJsonFile,
  validateDataFile,
  loadBaseData,
  formatProblems,
  /* 供守卫脚本做「深合并 vs 浅合并」对照用（合并语义本身仍在 world.js） */
  deepMerge,
};
