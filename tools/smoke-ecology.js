/* 第 5 批：性格 + 心情 + 目击反应 + 生死规则（晕倒/补刀） 冒烟测试 */
const { GameEngine } = require('../game/src/core/engine.js');
const personality = require('../game/src/core/personality.js');

let fail = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '✔' : '✘') + ' ' + name + (cond ? '' : ('  → ' + (extra !== undefined ? extra : 'FAIL'))));
  if (!cond) fail++;
};
const section = (t) => console.log('\n== ' + t + ' ==');

/* ============ 1. 性格系统 ============ */
section('1. 性格系统');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;
  ok('玩家有性格', !!p.personality, p.personality);
  // 不同身份 NPC 不同性格
  const n1 = w.spawnNpc('npcv_111', 'jiangnan_street', 1, true); // child → 豪爽
  const n2 = w.spawnNpc('npcv_009', 'jiangnan_street', 1, true); // merchant → 油滑
  /* ⚠️ 性格规则 2026-10-08 升级了：**画像语气优先**，其次才是身份 tag。
     原来这里直接断言「child → 豪爽」，可 npcv_111 的画像写的是「讷」——
     画像比 tag 猜得准（主人：『npc 性格与其画像背景性格核对了吗』），所以断言跟着规则走。 */
  const ruleOf = n => personality.personaFromVoice(n) || personality.TAG_PERSONALITY[n.tag] || 'mune';
  ok('child 性格与规则一致（画像优先、其次身份）', n1.personality === ruleOf(n1), n1.personality + ' vs ' + ruleOf(n1));
  ok('merchant 性格与规则一致', n2.personality === ruleOf(n2), n2.personality + ' vs ' + ruleOf(n2));
  // 说话动词不同
  /* 说话动词必须**跟着这个人实际的性格**走（不再假设 n1 一定是豪爽） */
  const per1 = personality.PERSONALITIES[n1.personality];
  ok('说话动词跟性格走', !per1 || personality.sayVerb(n1) === per1.say, personality.sayVerb(n1) + ' / ' + (per1 && per1.say));
  ok('油滑说嘻嘻笑道', personality.sayVerb(n2) === '嘻嘻笑道', personality.sayVerb(n2));
}

/* ============ 2. 心情系统 ============ */
section('2. 心情系统');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;
  const n = w.spawnNpc('npcv_111', 'jiangnan_street', 1, true);
  ok('初始心情 50（心平气和）', personality.moodTier(n.mood).name === '心平气和', n.mood);
  // 心情低落 → 说话消沉
  personality.addMood(n, -47); // 50 → 3
  ok('心情大跌到万念俱灰', personality.moodTier(n.mood).name === '万念俱灰', n.mood);
  ok('抑郁时喃喃道', personality.sayVerb(n).includes('喃喃'), personality.sayVerb(n));
  ok('抑郁判定', personality.isDepressed(n));
  // 心情上限/下限
  personality.addMood(n, 999);
  ok('心情封顶 100', n.mood === 100, n.mood);
  personality.addMood(n, -999);
  ok('心情下限 0', n.mood === 0, n.mood);
}

/* ============ 3. 送礼加心情 ============ */
section('3. 送礼加心情');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;
  p.room = 'jiangnan_street';
  const n = w.spawnNpc('npcv_111', 'jiangnan_street', 1, true);
  n.mood = 50;
  w.giveItem(p, 'roast_meat', 1);
  e.exec('give 烤肉 to ' + n.name);
  ok('送礼后心情上升', n.mood > 50, 'mood=' + n.mood);
}

/* ============ 4. 晕倒不致死 ============ */
section('4. 晕倒不致死');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;
  p.room = 'jiangnan_street';
  const n = w.spawnNpc('npcv_111', 'jiangnan_street', 1, true);
  w.onNpcDown(n, null);
  ok('晕倒标记 knockedOut', !!n.knockedOut);
  ok('晕倒后实例还在', !!w.instances.npcs[n.id], '（未删除）');
  ok('晕倒不产生尸体', Object.keys(w.instances.corpses).length === 0);
}

/* ============ 5. 补刀真死 ============ */
section('5. 晕倒补刀才死');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;
  p.room = 'jiangnan_street';
  const n = w.spawnNpc('npcv_111', 'jiangnan_street', 1, true);
  w.onNpcDown(n, null);       // 先晕
  w.onNpcKilled(n, null);     // 补刀
  ok('补刀后实例被删除', !w.instances.npcs[n.id]);
  ok('补刀后留尸体', Object.keys(w.instances.corpses).length > 0);
}

/* ============ 6. 野兽直接死 ============ */
section('6. 野兽直接死（可切割）');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;
  p.room = 'wild_forest_2';
  const wolf = w.spawnNpc('mob_wolf', 'wild_forest_2', 1, true);
  w.onNpcKilled(wolf, null); // 野兽直接死
  const corpses = Object.values(w.instances.corpses).filter(c => c.kind === 'beast');
  ok('野兽死亡留 beast 尸体', corpses.length > 0);
}

/* ============ 7. 目击反应 ============ */
section('7. 目击反应');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;
  p.room = 'jiangnan_street';
  const victim = w.spawnNpc('npcv_111', 'jiangnan_street', 1, true); // 狗蛋 child
  const wit1 = w.spawnNpc('npcv_009', 'jiangnan_street', 1, true);   // 熊时 merchant
  wit1.mood = 50;
  // 捕获 storyline 输出
  let reacted = 0;
  const oldEmit = w.emit.bind(w);
  w.emit = (ev, payload) => { if (ev === 'storyline') reacted++; oldEmit(ev, payload); };
  w.witnessReaction(victim);
  w.emit = oldEmit;
  ok('目击者有反应', reacted > 0, reacted + ' 条反应');
  ok('目击者心情大跌', wit1.mood < 50, 'mood=' + wit1.mood);
}

/* ============ 8. 饭点吃饭 ============ */
section('8. 饭点吃饭');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world;
  w.clockMinutes = 12 * 60;
  ok('午时是饭点', w.isMealTime());
  w.clockMinutes = 15 * 60;
  ok('申时不是饭点', !w.isMealTime());
  ok('能找到最近客栈', !!w.nearestEatery('jn_farm_1'), w.nearestEatery('jn_farm_1'));
}

/* ============ 9. 官府抓犯人 ============ */
section('9. 官府抓犯人');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;
  p.room = 'jn_yamen_gate';
  const thief = Object.values(w.data.npcs).find(d => d.tag === 'thief');
  const off = Object.values(w.data.npcs).find(d => d.tag === 'constable');
  const t = w.spawnNpc(thief.id, 'jn_yamen_gate', 1, true);
  w.spawnNpc(off.id, 'jn_yamen_gate', 1, true);
  w.onNpcDown(t, null);
  ok('犯人被抓进牢', !!w.jail[thief.id], JSON.stringify(w.jail));
  ok('犯人从原地消失', !w.instances.npcs[t.id]);
}

/* ============ 10. 赎人 ============ */
section('10. 牢里赎人');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;
  p.money = 99999;
  const thief = Object.values(w.data.npcs).find(d => d.tag === 'thief');
  w.jail[thief.id] = { name: thief.name, ransom: 200, since: 0 };
  p.room = 'jn_yamen_prison';
  e.exec('赎人 ' + thief.name);
  ok('赎人后牢房清空', !w.jail[thief.id]);
  ok('赎出的 NPC 好感大增', social_add_favor_check(w, thief.id) > 0);
}

function social_add_favor_check(w, defId) {
  const def = w.data.npcs[defId];
  return def ? (def.favor || 0) : 0;
}

/* ============ 11. 通缉 ============ */
section('11. 通缉告示');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;
  p.room = 'jn_yamen_office';
  const r = e.exec('通缉');
  ok('通缉告示列出要犯', (r.lines || []).some(l => /通缉要犯/.test(l.text || '')), (r.lines || []).map(l => l.text).join(''));
  // 接悬赏
  const thief = Object.values(w.data.npcs).find(d => d.tag === 'thief');
  e.exec('接悬赏 ' + thief.name);
  ok('接悬赏后记录目标', p.bounty === thief.id, p.bounty);
}

console.log('\n' + '='.repeat(42));
console.log(fail === 0 ? '✅ 全部通过' : '❌ 失败 ' + fail + ' 项');
process.exitCode = fail === 0 ? 0 : 1;
