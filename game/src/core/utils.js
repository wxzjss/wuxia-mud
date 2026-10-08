/**
 * utils.js — 通用工具
 */
'use strict';

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/** 可复现随机数（种子） */
class RNG {
  constructor(seed) {
    this.seed = (seed >>> 0) || (Date.now() >>> 0);
    this._s = this.seed;
  }
  next() {
    // xorshift32
    let x = this._s;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    this._s = x;
    return x / 4294967296;
  }
  int(min, max) { return Math.floor(this.next() * (max - min + 1)) + min; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  weighted(list) {
    // list: [{w:number, v:any}]
    const total = list.reduce((s, i) => s + (i.w || 1), 0);
    let r = this.next() * total;
    for (const it of list) { r -= (it.w || 1); if (r <= 0) return it.v; }
    return list[list.length - 1].v;
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

let _gid = 0;
function uid(prefix) { _gid++; return `${prefix || 'id'}_${Date.now().toString(36)}_${_gid.toString(36)}`; }

/** 深合并：数组按规则处理 */
function deepMerge(base, over, opts) {
  opts = opts || {};
  if (over === undefined) return base;
  if (base === undefined) return over;
  if (Array.isArray(base) || Array.isArray(over)) {
    if (Array.isArray(base) && Array.isArray(over)) {
      const mode = opts.arrayMode || 'replace';
      if (mode === 'append') return base.concat(over);
      if (mode === 'prepend') return over.concat(base);
      return over;
    }
    return over;
  }
  if (typeof base === 'object' && typeof over === 'object' && base && over) {
    const out = Object.assign({}, base);
    for (const k of Object.keys(over)) {
      out[k] = deepMerge(base[k], over[k], opts);
    }
    return out;
  }
  return over;
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

/** 中文数字/时间格式化 */
function fmtTime(minutes) {
  const day = Math.floor(minutes / 1440) + 1;
  const m = minutes % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return { day, clock: `${hh}:${mm}`, text: `第${day}日 ${hh}:${mm}` };
}

/** 时辰名 */
const SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
function shichen(minutes) {
  const m = minutes % 1440;
  let idx = Math.floor((m + 60) / 120) % 12;
  return SHICHEN[idx] + '时';
}

/** 把玩家输入的指令切成 segments，支持中文引号与"引号" */
function tokenize(input) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) { quote = null; } else cur += ch;
    } else if (ch === '"' || ch === '\u201c') {
      if (ch === '"') quote = '"'; else quote = '\u201d';
      if (cur) { out.push(cur); cur = ''; }
    } else if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ''; }
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** 编辑距离（用于模糊匹配指令/物品名） */
function lev(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

/** 中文口语指令归一化：
 *  「往北走」「向北走」「去北边」「看看背包」「查看背包」→ 「n」「i」
 *  只做无损拆分，识别不了就原样返回，交给正常指令表处理。 */
const DIR_CN = {
  '北': 'n', '南': 's', '东': 'e', '西': 'w', '上': 'u', '下': 'd',
  '东北': 'ne', '西北': 'nw', '东南': 'se', '西南': 'sw',
  '北边': 'n', '南边': 's', '东边': 'e', '西边': 'w',
  '上面': 'u', '下面': 'd', '楼上': 'u', '楼下': 'd',
  '北方': 'n', '南方': 's', '东方': 'e', '西方': 'w',
};
/* 口语动词前缀，直接剥掉 */
const VERB_LEAD = /^(?:我想|我要|帮我|请|麻烦)?(?:前往|走到|走去|走进|走向|走向|进入|去|往|向|朝|走)/;
/* 「查看X」「看看X」→ X */
const LOOK_LEAD = /^(?:查看一下|看一看|看一眼|看一遍|查看|看看|瞧瞧|瞅瞅|看下|查一下|查查|查|看|瞧)/;
/* 「上楼」「下楼」「进屋」「出门」等固定动作 */
const ACT_ALIAS = {
  '上楼': 'u', '上去': 'u', '往上走': 'u', '上楼上': 'u',
  '下楼': 'd', '下去': 'd', '往下走': 'd',
  '出门': 'out', '出去': 'out', '进来': 'in', '进屋': 'in', '进去': 'in',
  '进入': 'in', '走出去': 'out', '走进去': 'in',
  '休息': 'sleep', '睡觉': 'sleep', '打坐': 'meditate', '运功': 'meditate', '练功': 'train',
  '清屏': 'clear', '重来': 'rebirth',
};
/* X 的口语同义词 → 标准指令 */
const NOUN_ALIAS = {
  '背包': 'i', '包裹': 'i', '行囊': 'i', '物品': 'i', '身上东西': 'i', '身上的东西': 'i',
  '状态': 'score', '属性': 'attr', '自身': 'score', '自己': 'score', '面板': 'score',
  '武学': 'skills', '功夫': 'skills', '武功': 'skills', '技能': 'skills',
  '装备': 'eq', '兵刃': 'eq', '武器': 'eq',
  '地图': 'map', '任务': 'quests', '门派': 'sect', '时间': 'time',
  '状态效果': 'affects', '效果': 'affects', 'buff': 'affects',
  '帮助': 'help', '存档': 'save', '读档': 'load', '设置': 'settings',
  '周围': 'look', '四周': 'look', '环境': 'look', '这里': 'look', '附近': 'look',
};
function normalizeCmd(raw) {
  if (!raw) return raw;
  let s = String(raw).trim();
  if (!s) return s;
  /* 已经是英文 / 标准指令，先看看能不能直通 */
  if (/^[a-zA-Z_][a-zA-Z0-9_:/-]*$/.test(s)) return s;

  /* 1) 「看X」→ X 的标准指令或 look X */
  const lm = s.match(LOOK_LEAD);
  if (lm) {
    const rest = s.slice(lm[0].length).replace(/[了着一下吧啊呀哦]$/, '').trim();
    if (!rest) return 'look';
    if (NOUN_ALIAS[rest]) return NOUN_ALIAS[rest];
    return 'look ' + rest;
  }

  /* 2) 「查看X」这类已在上面处理；这里处理纯名词口语 */
  if (NOUN_ALIAS[s]) return NOUN_ALIAS[s];

  /* 2.5) 固定动作口语：「上楼」「出门」「打坐」 */
  if (ACT_ALIAS[s]) return ACT_ALIAS[s];

  /* 3) 方向：「往北走」「去北边」「朝东北」 */
  const dm = s.match(VERB_LEAD);
  if (dm) {
    const rest = s.slice(dm[0].length).replace(/[走了吧啊呀哦]$/, '').trim();
    if (!rest) return s;
    if (DIR_CN[rest]) return DIR_CN[rest];
    if (NOUN_ALIAS[rest]) return NOUN_ALIAS[rest];
    return 'go ' + rest;
  }

  /* 4) 纯方向词：「北」「北边」「东北」 */
  if (DIR_CN[s]) return DIR_CN[s];

  /* 5) 「去<房间名>」 */
  const gm = s.match(/^(?:去|到|前往|走到)(.+)$/);
  if (gm) {
    const rest = gm[1].replace(/[了吧啊呀哦]$/, '').trim();
    if (DIR_CN[rest]) return DIR_CN[rest];
    return 'go ' + rest;
  }

  return s;
}

/** 模糊查找：返回最匹配的项 */
function fuzzyFind(list, keyword, nameOf) {
  if (!keyword) return null;
  nameOf = nameOf || (x => x.name);
  const kw = String(keyword).toLowerCase();
  // 1 精确
  let hit = list.find(x => nameOf(x).toLowerCase() === kw);
  if (hit) return hit;
  // 2 包含
  const contains = list.filter(x => nameOf(x).toLowerCase().includes(kw));
  if (contains.length) return contains[0];
  // 3 id 包含
  const byId = list.filter(x => String(x.id || '').toLowerCase().includes(kw));
  if (byId.length) return byId[0];
  // 4 模糊
  let best = null, bestD = Infinity;
  for (const x of list) {
    const d = lev(nameOf(x).toLowerCase(), kw);
    if (d < bestD) { bestD = d; best = x; }
  }
  if (best && bestD <= Math.max(1, Math.floor(kw.length / 2))) return best;
  return null;
}

/** 星级显示 */
function stars(n, max) {
  max = max || 5;
  return '★'.repeat(clamp(n, 0, max)) + '☆'.repeat(Math.max(0, max - n));
}

function pct(v, total) { return total <= 0 ? 0 : clamp(Math.round((v / total) * 100), 0, 100); }

module.exports = { clamp, RNG, uid, deepMerge, clone, fmtTime, shichen, tokenize, fuzzyFind, stars, pct, lev, SHICHEN, normalizeCmd };
