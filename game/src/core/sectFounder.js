/* ============================================================
 * sectFounder.js —— 玩家自建宗门（武学重制 S2）
 *
 * 设计要点：
 *   - 数据全部存 player.mySect（随玩家存档走），绝不写进全局 data.sects，
 *     因此不影响其它玩家 / 静态门派，也无需改 serialize 的 sects 处理。
 *   - 宗门驻地 = 动态房间，挂进 p.homes 走既有的 playerHomes 持久化通道。
 *   - 招募的成员只记 NPC 的 defId（玩家私有），不污染 NPC 的静态 def.sect。
 *   - 现有「门派」指令面板对自建宗门做特判渲染，复用 p.sect 字段但不依赖 getSect。
 * ============================================================ */

const homeMod = require('./home');

const CREATE_COST = 5000;       // 开宗立派的开办银
const DRILL_MP = 30;            // 主持演武耗内力

function mySect(world) { return world.player && world.player.mySect; }

/* ---------------- 战力估算 ---------------- */
function powerOf(world, defId) {
  const inst = world.instances && world.instances.npcs
    ? Object.values(world.instances.npcs).find(n => n.defId === defId) : null;
  if (inst) {
    const learned = Object.keys(inst.learned || {}).length;
    return Math.round((inst.atk || 0) + (inst.defFinal || 0) + (inst.maxHp || 0) / 8 + learned * 10);
  }
  const d = world.data.npcs[defId];
  if (d) {
    const sk = (d.skills ? d.skills.length : 0) + (d.startSkills ? d.startSkills.length : 0);
    return Math.round((d.atk || 10) + (d.def || 8) + ((d.maxHp || 100) / 8) + sk * 10);
  }
  return 0;
}

function memberName(world, defId) {
  const inst = world.instances && world.instances.npcs
    ? Object.values(world.instances.npcs).find(n => n.defId === defId) : null;
  if (inst && inst.name) return inst.name;
  const d = world.data.npcs[defId];
  return d ? d.name : defId;
}

function playerPower(p) {
  const learned = Object.keys(p.learned || {}).length;
  return Math.round((p.atk || 0) + (p.defFinal || 0) + (p.maxHp || 0) / 8 + learned * 10);
}

/* ============================================================
 * 一、创宗
 * ============================================================ */
function createSect(world, name) {
  const p = world.player;
  if (!p) return { ok: false, lines: [{ kind: 'warn', text: '请先创建角色。' }] };
  if (p.mySect) return { ok: false, lines: [{ kind: 'warn', text: `你已创立「${p.mySect.name}」，无须再建。` }] };
  name = (name || '').trim();
  if (name.length < 2) return { ok: false, lines: [{ kind: 'warn', text: '宗门之名至少两个字，如「凌霄阁」。' }] };
  if (p.money < CREATE_COST) return { ok: false, lines: [{ kind: 'warn', text: `创立宗门需 ${CREATE_COST} 文开办银，你只有 ${p.money} 文。` }] };

  p.money -= CREATE_COST;
  const id = 'sect_my_' + Date.now().toString(36);
  const hmId = 'sect_base_' + id;
  const host = homeMod.findHostFang(world, hmId);
  let baseId = null;
  if (host) {
    world.data.rooms[hmId] = {
      id: hmId, name: name + '·山门', region: host.region,
      desc: `青石山门巍然矗立，匾额上书「${name}」三字。门前一对石狮，门下弟子往来进出，气象俨然。`,
      exits: {}, owner: 'player', private: true,
      homeTier: 'estate', homeCapacity: 30, furniture: [],
    };
    world.data.rooms[host.fang].exits[host.dir] = hmId;
    const BACK = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw' };
    const bk = BACK[host.dir];
    if (bk) world.data.rooms[hmId].exits[bk] = host.fang;
    if (!p.homes) p.homes = [];
    p.homes.push({ id: hmId, name: name + '·山门', tier: 'estate', price: 0, boughtAt: world.clockMinutes || 0 });
    baseId = hmId;
  }

  p.mySect = {
    id, name, founder: p.name, members: [],
    prestige: 0, base: baseId, createdAt: world.clockMinutes || 0,
    drills: 0, wins: 0, losses: 0,
  };
  p.sect = id; p.rank = 0; p.sectContribution = 0;

  const lines = [
    { kind: 'title', text: '【 开 宗 立 派 】' },
    { kind: 'story', text: `你耗 ${CREATE_COST} 文开办银，于江湖中创立「${name}」，自任宗主。` },
    { kind: 'sys', text: `宗门：${name}　威望：0` },
  ];
  if (baseId) lines.push({ kind: 'hint', text: `山门已立（${host.region}）。发「宗门」看详情，发「招贤 <人名>」邀江湖同道入伙，发「演武」聚徒习武。` });
  else lines.push({ kind: 'hint', text: '（城中暂无名下驻地，宗门仍立，可日后置产作驻足之地。）' });
  return { ok: true, lines };
}

/* ============================================================
 * 二、信息
 * ============================================================ */
function sectInfo(world) {
  const s = mySect(world);
  if (!s) return null;
  const members = s.members.map(defId => ({ defId, name: memberName(world, defId), power: powerOf(world, defId) }));
  return {
    id: s.id, name: s.name, founder: s.founder, prestige: s.prestige,
    base: s.base, wins: s.wins, losses: s.losses, drills: s.drills, members,
  };
}

/* ============================================================
 * 三、招贤 / 逐出
 * ============================================================ */
function recruit(world, npc) {
  const p = world.player, s = mySect(world);
  if (!s) return { ok: false, lines: [{ kind: 'warn', text: '你尚未创立宗门。' }] };
  if (!npc || !npc.defId) return { ok: false, lines: [{ kind: 'warn', text: '这里没有可招揽的人。' }] };
  if (npc.isPlayer) return { ok: false, lines: [{ kind: 'warn', text: '你不能招自己入门。' }] };
  if (s.members.includes(npc.defId)) return { ok: false, lines: [{ kind: 'warn', text: `${npc.name}已在你宗门之中。` }] };
  s.members.push(npc.defId);
  if (typeof npc.favor !== 'number') npc.favor = 0;
  npc.favor += 20;
  return { ok: true, lines: [
    { kind: 'sys', text: `${npc.name}感你知遇，拜入${s.name}。` },
    { kind: 'hint', text: `现门下共 ${s.members.length} 人。` },
  ] };
}

function expel(world, npc) {
  const s = mySect(world);
  if (!s) return { ok: false, lines: [{ kind: 'warn', text: '你尚未创立宗门。' }] };
  if (!npc || !npc.defId) return { ok: false, lines: [{ kind: 'warn', text: '这里没有可逐出的人。' }] };
  const i = s.members.indexOf(npc.defId);
  if (i < 0) return { ok: false, lines: [{ kind: 'warn', text: `${npc.name}本就不是你宗门的人。` }] };
  s.members.splice(i, 1);
  return { ok: true, lines: [{ kind: 'sys', text: `${npc.name}被你逐出${s.name}。` }] };
}

/* ============================================================
 * 四、演武（宗门活动）
 * ============================================================ */
function drill(world) {
  const p = world.player, s = mySect(world);
  if (!s) return { ok: false, lines: [{ kind: 'warn', text: '你尚未创立宗门。' }] };
  if (p.mp < DRILL_MP) return { ok: false, lines: [{ kind: 'warn', text: `你内力不足（需 ${DRILL_MP}），无法主持演武。` }] };
  p.mp -= DRILL_MP;
  if (world.advanceTime) world.advanceTime(30);

  /* 给门下成员实例的武学添些火候（优先在场同房间者） */
  let touched = 0;
  for (const defId of s.members) {
    const inst = world.instances && world.instances.npcs
      ? Object.values(world.instances.npcs).find(n => n.defId === defId) : null;
    if (!inst) continue;
    const ids = Object.keys(inst.learned || {});
    if (ids.length) { inst.gainSkillExp(ids[0], 30); touched++; }
    if (typeof inst.favor === 'number') inst.favor += 5;
  }
  s.prestige += 8; s.drills += 1;
  return { ok: true, lines: [
    { kind: 'title', text: '【 宗 门 演 武 】' },
    { kind: 'story', text: `你于${s.base ? '山门' : '驻地'}召集门人演武切磋，气氛热烈。` },
    { kind: 'sys', text: `宗门威望 +8（现 ${s.prestige}），门下 ${touched} 人武学精进。` },
  ] };
}

/* ============================================================
 * 五、门派大比
 * ============================================================ */
function contest(world) {
  const p = world.player, s = mySect(world);
  if (!s) return { ok: false, lines: [{ kind: 'warn', text: '你尚未创立宗门。' }] };
  if (s.members.length < 1) return { ok: false, lines: [{ kind: 'warn', text: '门下无人，如何去比？先「招贤」聚几位同道。' }] };

  const builtSects = Object.keys(world.data.sects || {}).filter(id => !id.startsWith('sect_my_'));
  if (!builtSects.length) return { ok: false, lines: [{ kind: 'warn', text: '江湖上竟无其它门派可约战。' }] };
  const rivalId = builtSects[Math.floor(world.rng ? world.rng.next() : Math.random()) * builtSects.length | 0];
  const rival = world.data.sects[rivalId];

  const myPower = playerPower(p) + s.members.reduce((a, d) => a + powerOf(world, d), 0) + s.prestige * 3;
  const rivalNpcs = Object.keys(world.data.npcs).filter(k => world.data.npcs[k].sect === rivalId);
  const rivalPower = rivalNpcs.reduce((a, k) => a + powerOf(world, k), 0) + (rival.rankCost || 300) * 5;

  const win = myPower >= rivalPower * 0.9;  // 略作放水，鼓励玩家经营
  if (win) {
    s.prestige += 20; s.wins += 1; p.money += 2000;
    return { ok: true, lines: [
      { kind: 'title', text: '【 门 派 大 比 】' },
      { kind: 'story', text: `你率${s.name}赴${rival.name}之约，技压群雄，拔得头筹！` },
      { kind: 'sys', text: `威望 +20（现 ${s.prestige}），赏银 +2000 文。战绩 ${s.wins} 胜 ${s.losses} 负。` },
    ] };
  }
  s.prestige = Math.max(0, s.prestige - 5); s.losses += 1;
  return { ok: true, lines: [
    { kind: 'title', text: '【 门 派 大 比 】' },
    { kind: 'story', text: `你率${s.name}赴${rival.name}之约，技不如人，铩羽而归。` },
    { kind: 'warn', text: `威望 -5（现 ${s.prestige}）。战绩 ${s.wins} 胜 ${s.losses} 负。` },
  ] };
}

/* ============================================================
 * 六、解散
 * ============================================================ */
function disband(world) {
  const p = world.player, s = mySect(world);
  if (!s) return { ok: false, lines: [{ kind: 'warn', text: '你本就没有宗门。' }] };
  // 摘掉山门房间与出口
  if (s.base) {
    const hr = world.getRoom(s.base);
    if (hr) {
      for (const d of Object.keys(hr.exits || {})) {
        const other = world.getRoom(hr.exits[d]);
        if (other && other.exits) for (const d2 of Object.keys(other.exits)) if (other.exits[d2] === hr.id) delete other.exits[d2];
      }
      delete world.data.rooms[hr.id];
    }
    p.homes = (p.homes || []).filter(h => h.id !== s.base);
  }
  p.sect = null; p.rank = 0; p.sectContribution = 0;
  const nm = s.name;
  p.mySect = null;
  return { ok: true, lines: [{ kind: 'story', text: `你遣散门人，从此「${nm}」不复存在。` }] };
}

module.exports = {
  CREATE_COST, DRILL_MP, mySect,
  createSect, sectInfo, recruit, expel, drill, contest, disband,
  powerOf, memberName, playerPower,
};
