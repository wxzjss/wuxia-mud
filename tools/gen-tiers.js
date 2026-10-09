/* SPRINT-A 步骤5：NPC 分层打标 + 邻里/门槛字段
 *
 * 分层标准（对齐 design/09）：
 *   A 层 核心人物：掌门/ Boss / 有画像 / rank≥3。住宅保留在地图上。
 *   B 层 有身份者：有名有姓 + 固定职业（掌柜/郎中/镖师/官员/和尚…），
 *        有买卖/教学/差事等专属交互，画像写六项。
 *   C 层 背景人：npcv_* 纯背景群众，只有五项（姓名/年龄/身份/一句话癖好/邻里）。
 *   mob_* 是战斗单位，不参与分层（tier='mob'）。
 *
 * 幂等：每次全量重算 tier/neighbors/unlock。
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'game', 'data');
const NPCF = path.join(DIR, '40_npcs.json');
const MAPF = path.join(DIR, '50_map.json');

const j = JSON.parse(fs.readFileSync(NPCF, 'utf8'));
const N = j.npcs || j;
const map = JSON.parse(fs.readFileSync(MAPF, 'utf8'));
const R = map.rooms || {};

const JOB = {
  innkeeper: '掌柜', doctor: '郎中', vendor: '货郎', smith: '铁匠', waiter: '店伙',
  merchant: '行商', groom: '马夫', madam: '鸨母', monk: '僧人', scholar: '书生',
  farmer: '农人', richman: '富户', escort: '镖师', constable: '捕快', official: '官吏',
  thief: '盗贼', hunter: '猎户', nun: '尼姑', actor: '戏子', boatman: '艄公',
  gambler: '赌徒', swordsman: '游侠', taoist: '道士',
};

/* tag 生成器的明显错配：desc 与 tag 不符时按 desc 纠正 */
const TAG_FIX = {
  swordsman: /守卫|捕快|差役|兵丁|门卫/,
  official: /掌柜|货郎|铁匠|农人/,
  merchant: /郎中|铁匠|和尚|尼姑/,
};
function fixTag(n, jobKey) {
  if (!jobKey) return jobKey;
  const d = String(n.desc || '') + String(n.name || '');
  /* 名字/描述里点名身份的，直接改判（比 tag 可靠） */
  const byName = [
    ['constable', /守卫|捕快|门卫|巡城/],
    ['official', /官员|县令|知府|主簿|师爷|官吏|太监|总管/],
    ['innkeeper', /掌柜|店主|老板/],
    ['doctor', /郎中|大夫|药师|药翁/],
    ['smith', /铁匠|锻工/],
    ['monk', /和尚|僧人|老僧|禅师/],
    ['nun', /尼姑|师太|庵主/],
    ['taoist', /道士|道长|道人/],
  ];
  for (const [key, re] of byName) {
    if (re.test(d)) return key;
  }
  const re2 = TAG_FIX[jobKey];
  if (!re2 || !re2.test(d)) return jobKey;
  for (const t of String(n.tag || '').split(/[,，;；]/).map(s => s.trim())) {
    if (t && t !== jobKey && JOB[t]) return t;
  }
  return jobKey;
}

/* 门槛：不同身份要见到私宅的难易不同 */
const UNLOCK = {
  richman: { favor: 80, note: '需极大交情或有大价钱' },
  official: { favor: 50, note: '需其在城中有些脸面' },
  escort: { favor: 40, note: '需得过命的交情' },
  monk: { favor: 25, note: '寺中不拒善缘' },
  nun: { favor: 25, note: '庵中不拒善缘' },
  taoist: { favor: 25, note: '道观不拒善缘' },
  innkeeper: { favor: 20, note: '常来常往便可' },
  doctor: { favor: 20, note: '常来常往便可' },
  madam: { favor: 60, note: '青楼规矩，非熟客不得入内院' },
};

function isMob(id) { return /^mob_/.test(id) || /^animal_/.test(id); }

/* C 层只留「无固定职业」的纯背景：commoner/child/refugee/palace 之类
 * 值是给 C 层人物补的身份称呼（原文案），不是数字 */
const PLAIN = {
  commoner: '寻常百姓', child: '孩童', refugee: '流民', villager: '村民',
  passenger: '过客', traveler: '行脚人', eunuch: '内侍', palace: '宫中内人',
  consort: '嫔妃', courtesan: '青楼女子', singer: '歌伎',
};

function isA(n) {
  return !!(n && (
    n.portrait ||
    (typeof n.rank === 'number' && n.rank >= 3) ||
    (n.sect && typeof n.rank === 'number' && n.rank >= 2)
  ));
}

/* 职业标签 → 中文；命中 JOB 表才算有固定职业 */
const JOB_CN = Object.assign({}, JOB, PLAIN);

function jobOf(n) {
  const tags = String(n.tag || '').split(/[,，;；]/).map(s => s.trim()).filter(Boolean);
  for (const t of tags) if (JOB[t]) return { key: t, label: JOB[t], real: true };
  for (const t of tags) if (JOB_CN[t]) return { key: null, label: JOB_CN[t], real: false };
  if (n.title) return { key: null, label: n.title, real: false };
  return { key: null, label: '', real: false };
}

/* 每区域的邻里：同区域其他有名字的 NPC */
const byRegion = {};
Object.keys(N).forEach(id => {
  const n = N[id];
  if (!n || isMob(id)) return;
  const reg = n.district || (n.room && R[n.room] && R[n.room].region);
  if (!reg) return;
  (byRegion[reg] = byRegion[reg] || []).push(id);
});

let stat = { A: 0, B: 0, C: 0, mob: 0 };
Object.keys(N).forEach(id => {
  const n = N[id];
  if (!n) return;

  if (isMob(id)) {
    n.tier = 'mob';
    stat.mob++;
    return;
  }

  /* 分层：有固定职业 → B；纯背景 → C；A 层优先 */
  const job = jobOf(n);
  let tier;
  if (isA(n)) tier = 'A';
  else if (job.real) tier = 'B';
  else tier = 'C';
  n.tier = tier;
  stat[tier]++;

  /* 职业：先纠正 tag，再落 title（顺序不能反，否则写错的名字会留下） */
  const tagged = job.key ? fixTag(n, job.key) : null;
  if (tagged) n.job = tagged;
  if (job.label && !n.title) n.title = (tagged && JOB[tagged]) || job.label;

  /* 所属州域 */
  const reg = n.district || (n.room && R[n.room] && R[n.room].region);
  if (reg && map.regions[reg]) {
    n.district = reg;
    n.province = map.regions[reg].province || map.regions[reg].name;
  }

  /* 住宅：A 层留真房间；B/C 层用虚拟住宅标记 */
  if (tier === 'A') {
    const home = n.house || n.home;
    if (typeof home === 'string' && home.startsWith('house:') && R[home]) {
      n.house = home;
      delete n.home;
    }
  } else {
    const real = (n.house && R[n.house]) || (n.home && R[n.home]);
    if (!real) {
      n.house = 'house:' + id;
      if (n.home) delete n.home;
    } else if (n.house && !R[n.house]) {
      n.house = real;
      delete n.home;
    }
  }

  /* 拜访门槛 */
  const u = UNLOCK[n.job];
  if (tier === 'C') {
    n.unlock = { favor: 30 };
  } else if (tier === 'B') {
    n.unlock = u ? { favor: u.favor } : { favor: 25 };
    if (u && u.note) n.unlock.note = u.note;
  } else {
    n.unlock = { favor: 20 };
  }

  /* 邻里：同区域其他分层 NPC，最多 4 个 */
  const myReg = n.district;
  if (myReg && byRegion[myReg]) {
    const peers = byRegion[myReg].filter(x => x !== id && N[x] && N[x].tier !== 'mob').slice(0, 4);
    n.neighbors = peers.map(x => N[x].name).filter(Boolean);
  }

  /* 清理死引用 */
  if (n.room && !R[n.room]) n.room = n.district ? null : n.room;
  if (n.schedule) {
    ['day', 'night', 'work'].forEach(k => {
      const t = n.schedule[k];
      if (typeof t === 'string' && !R[t]) delete n.schedule[k];
    });
    if (!Object.keys(n.schedule).length) delete n.schedule;
  }
});

fs.writeFileSync(NPCF, JSON.stringify(j, null, 2));
console.log('A=' + stat.A + ' B=' + stat.B + ' C=' + stat.C + ' mob=' + stat.mob);