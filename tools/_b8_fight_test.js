// B8 批间实测：起真引擎，玩家（新手）对代表 NPC 打一场，报回合数与双方血量。
// 用法：node tools/_b8_fight_test.js <npcId> ...
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

async function main() {
  const ids = process.argv.slice(2);
  for (const id of ids) {
    const e = new GameEngine({ seed: 42, saveDir: path.join(ROOT, 'saves', '_b8test') });
    e.boot();
    e.newGame({ name: '压级试炼', sect: null });
    const w = e.world;
    const p = w.player;
    // 拉齐到前期段：level 3
    p.level = 3;
    // 给玩家基本战斗配置：武器 + 通用功法 30 级（模拟入门玩家）
    if (p.learned) {
      p.learned['jh_fist'] = { level: 30, exp: 0 };
      p.learned['jh_parry'] = { level: 30, exp: 0 };
      p.learned['basic_force'] = { level: 30, exp: 0 };
    }
    const target = w.spawnNpc(id, p.room, 1);
    if (!target) { console.log(id, ': NOT FOUND'); continue; }
    try {
      w.startCombat(p, target);
    } catch (err) {
      console.log(id, ': startCombat 失败', err.message); continue;
    }
    let rounds = 0, pHp0 = p.hp;
    while (w.battle && rounds < 40) {
      w.combatStep();
      rounds++;
      if (p.hp <= 0) break;
    }
    const npcHp = target.hp;
    const over = !w.battle;
    console.log('%s: 回合=%d 玩家血 %d→%d 目标血=%d 战斗结束=%s',
      id, rounds, pHp0, p.hp, npcHp, over);
  }
}
main().catch(err => { console.error(err); process.exit(1); });
