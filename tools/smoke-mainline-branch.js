/* ============================================================
 * smoke-mainline-branch.js —— 主线分化 P1 守卫（design/67 §5）
 *
 * 主人 2026-10-11：「根据不同出身以及不同性别玩家所经历的主线也不一样……
 *   如果是 mod 出身则是一条新主线，玩家不再是强绑定正派或反派剧情
 *   而是一种中立视角下的剧情」
 *
 * P1 是全部分化的**地基**：没有 `p.mainline.line` 这个字段，
 * 后面每写一条分支都要再改一遍世界文件。
 * 这个脚本守地基本身：出身定线、线只有三种、mod 出身走中立、随档走。
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const ML = require(path.join(ROOT, 'game/src/core/mainline.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (e !== undefined ? '  ' + e : '')); } };

(async () => {
  const e = new GameEngine({ seed: 21 });
  await e.boot({});
  const w = e.world;
  const births = Object.keys(w.data.meta.births || {});

  console.log('===== ① 每条出身都分得到线 =====');
  {
    ok('出身表非空', births.length >= 14, births.length + ' 条');
    const bad = births.filter(b => !ML.LINES[ML.lineOfBirth(b)]);
    ok('★ 每条出身都落在三种线之一', bad.length === 0, bad.join(','));
    const byLine = {};
    for (const b of births) (byLine[ML.lineOfBirth(b)] = byLine[ML.lineOfBirth(b)] || []).push(b);
    ok('★ 三条线都有出身', Object.keys(byLine).length === 3, JSON.stringify(byLine).slice(0, 120));
    console.log('     正派：' + (byLine.orthodox || []).join('、'));
    console.log('     反派：' + (byLine.outlaw || []).join('、'));
    console.log('     中立：' + (byLine.neutral || []).join('、'));
  }

  console.log('===== ② 开局就带上 mainline =====');
  {
    const a = new GameEngine({ seed: 21 }); await a.boot({});
    a.newGame({ name: '甲', birth: 'noble' });          // 官宦子弟 → 正派
    const m = a.world.player.mainline;
    ok('★ 开局有 p.mainline', !!m, JSON.stringify(m));
    ok('字段齐（line/act/node/flags）',
      !!(m && m.line && m.act >= 1 && m.node >= 0 && typeof m.flags === 'object'),
      JSON.stringify(m));
    ok('官宦子弟 → 正派', m && m.line === 'orthodox', m && m.line);
    ok('出身与性别记下来了（P4 性别双解要用）', m && m.birth === 'noble' && m.gender === 'male', JSON.stringify(m));
  }

  console.log('===== ③ 三种出身开三条线（这就是分化的地基） =====');
  {
    const pick = async (birth) => {
      const g = new GameEngine({ seed: 21 }); await g.boot({});
      g.newGame({ name: '乙', birth });
      return g.world.player.mainline.line;
    };
    const l1 = await pick('noble');          // 官宦子弟
    const l2 = await pick('grudge_orphan');  // 血仇遗孤
    const l3 = await pick('orphan');         // 孤儿出身
    ok('★ 同一次开局，三种出身走三条线',
      l1 === 'orthodox' && l2 === 'outlaw' && l3 === 'neutral',
      `noble=${l1} grudge_orphan=${l2} orphan=${l3}`);
  }

  console.log('===== ④ mod 出身 → 中立线 =====');
  {
    const g = new GameEngine({ seed: 21 }); await g.boot({});
    g.newGame({ name: '丙', birth: 'my_mod_birth' });   // 官方表里没有
    const m = g.world.player.mainline;
    ok('★ 表外出身 → 中立', m.line === 'neutral', m.line);
    ok('标了 fromMod', m.fromMod === true, JSON.stringify(m));
  }

  console.log('===== ⑤ 简报与状态面板 =====');
  {
    const g = new GameEngine({ seed: 21 }); await g.boot({});
    g.newGame({ name: '丁', birth: 'noble' });
    const v = g.view();
    ok('★ view.player 带 mainline 简报', !!(v.player && v.player.mainline), JSON.stringify(v.player && v.player.mainline));
    ok('简报有中文线名', v.player.mainline && v.player.mainline.lineName === '正派', v.player.mainline && v.player.mainline.lineName);
    ok('描述非空（面板上要说人话）', !!(v.player.mainline && v.player.mainline.desc && v.player.mainline.desc.length > 10));
  }

  console.log('===== ⑥ 随档走 =====');
  {
    const g = new GameEngine({ seed: 21 }); await g.boot({});
    g.newGame({ name: '戊', birth: 'grudge_orphan' });
    ML.advance(g.world.player); ML.setFlag(g.world.player, 'killed_the_mark', true);
    const snap = JSON.parse(JSON.stringify(g.world.player.mainline));
    const ser = g.world.serialize ? g.world.serialize() : null;
    const roundtrip = ser ? JSON.parse(JSON.stringify(ser)).player : null;
    ok('序列化里带着 mainline（否则读档就丢了线）',
      !!(roundtrip && roundtrip.mainline && roundtrip.mainline.line === 'outlaw'),
      roundtrip ? JSON.stringify(roundtrip.mainline) : '(无 serialize)');
    ok('节点与 flag 也随档', !!(roundtrip && roundtrip.mainline.node === snap.node && roundtrip.mainline.flags.killed_the_mark),
      JSON.stringify(roundtrip && roundtrip.mainline));
  }

  console.log('===== ⑦ 推进只动自己那一份 =====');
  {
    const g = new GameEngine({ seed: 21 }); await g.boot({});
    g.newGame({ name: '己', birth: 'orphan' });
    const p = g.world.player;
    ML.advance(p); ML.advance(p); ML.nextAct(p);
    const m = ML.stateOf(p);
    ok('advance 累计节点', m.act === 2 && m.node === 0, JSON.stringify(m));
  }

  console.log(`\n===== smoke-mainline-branch: ${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
})();
