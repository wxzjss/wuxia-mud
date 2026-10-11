/* 挂机被回收后「角色凭空消失」的修复回归（主人 2026-10-11 亲报）
 *
 * 病症：一段时间不操作，再点按钮 → 屏幕上一行「请先创建角色」，
 *       各属性变 0、玩家名字消失。
 * 根因两截：
 *   ① 沙箱闲置回收进程 → 服务端 `world.player` 变 null（世界全在内存里）
 *   ② 前端 `afterAction` **无条件** `S.view = d.view` → 空视图盖掉有角色的视图
 * 这里把两截都钉住：服务端走 `_live` 兜底档真跑一遍；前端钉「不许再无条件覆盖」。
 *
 * 跑法：node tools/smoke-live-restore.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));

const TMP = path.join(__dirname, '_livetest');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n── ' + t + ' ──'); }

(async () => {
  /* 用项目内的临时存档目录，别污染真 saves/ */
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  /* ================= 一、服务端：兜底档 ================= */
  section('1 服务端兜底档（_live）');
  const e1 = new GameEngine({ seed: 7, saveDir: TMP });
  await e1.boot({});
  e1.newGame({ name: '过客' });
  await e1.exec('score');
  const name1 = e1.world.player.name, room1 = e1.world.player.room;
  const r = e1.saveLive();
  ok('★ 存得下去', r.ok, r.msg);
  ok('落了盘（saves/_live.json 存在）', fs.existsSync(path.join(TMP, '_live.json')));
  ok('★ 不出现在玩家存档列表里', !e1.listSaves().some(s => s.id === '_live'),
    JSON.stringify(e1.listSaves().map(s => s.id)));

  /* ================= 二、模拟「进程被回收」 ================= */
  section('2 进程重启后：先把人接回来');
  const e2 = new GameEngine({ seed: 7, saveDir: TMP });
  await e2.boot({});
  ok('重启后（未接人）确实没有角色', !e2.world.player);
  const before = e2.exec('look');
  ok('★ 没角色时打上 noPlayer 标记（前端据此接人）', before.noPlayer === true);
  ok('★ 且告诉前端「接得回来」', before.canRestore === true);
  ok('★ 这句不再是冷冰冰的「请先创建角色」',
    !/请先创建角色/.test(before.lines[0].text), before.lines[0].text);

  const rr = e2.restoreLive();
  ok('★ 接回来了', rr.ok, rr.msg);
  ok('★ 还是原来那个人', e2.world.player && e2.world.player.name === name1,
    e2.world.player && e2.world.player.name);
  ok('★ 还在原来那个房间', e2.world.player.room === room1, e2.world.player.room);
  ok('接回来后能正常行动', (() => {
    const a = e2.exec('score');
    return !a.noPlayer && a.lines && a.lines.length > 0;
  })());
  ok('已经有玩家时 restoreLive 不动手（幂等）', e2.restoreLive().ok === false);

  /* 真的没档时，仍然该说「请先创建角色」——别把新手也拦在门外 */
  const EMPTY = path.join(__dirname, '_livetest2');
  fs.rmSync(EMPTY, { recursive: true, force: true });
  fs.mkdirSync(EMPTY, { recursive: true });
  const e3 = new GameEngine({ seed: 7, saveDir: EMPTY });
  await e3.boot({});
  const r3 = e3.exec('look');
  ok('★ 从没起过局 → 仍旧提示「请先创建角色」', /请先创建角色/.test(r3.lines[0].text));
  ok('那种情况下 canRestore 为 false', r3.canRestore === false);

  /* ================= 三、前端：不许再无条件覆盖视图 ================= */
  section('3 前端：视图替换的守卫');
  const UI = fs.readFileSync(path.join(ROOT, 'game/src/renderer/js/ui.js'), 'utf8');
  const APP = fs.readFileSync(path.join(ROOT, 'game/src/renderer/js/app.js'), 'utf8');
  const UI2 = fs.readFileSync(path.join(ROOT, 'server/public/js/ui.js'), 'utf8');
  const APP2 = fs.readFileSync(path.join(ROOT, 'server/public/js/app.js'), 'utf8');

  ok('ui.js 有 applyView 统一入口', /function applyView\s*\(/.test(UI));
  ok('★ applyView 里挡住「空视图覆盖有角色的视图」',
    /function applyView[\s\S]{0,400}?!v\.player/.test(UI), '');
  ok('★ afterAction 走 applyView，不再自己赋值',
    /function afterAction[\s\S]{0,900}?applyView\(d\.view\)/.test(UI));
  ok('★ afterAction 拦住 noPlayer（不落日志、不换视图）',
    /if \(d\.noPlayer\)\s*\{\s*recoverLostPlayer\(\)/.test(UI));
  /* 🔴 2026-10-11 云存档已删，接人的路只剩**本地档**这一条（autosave_<设备>）。
     仍然要守：接人函数在、而且云端那条老路徹底拆干净了。 */
  ok('有接人的实现（本地兜底档）',
    /recoverLostPlayer/.test(UI) && /api\.load\(key\)/.test(UI));
  ok('云端接人那条老路已拆（pullCloudSaveOnce 不存在）', !/pullCloudSaveOnce/.test(UI));

  ok('app.js 有 keepView 守卫', /function keepView\s*\(/.test(APP));
  ok('★ app.js 里再无「无条件的 S.view = d.view」',
    (APP.match(/if \(d\.view\) S\.view = d\.view;/g) || []).length === 0,
    (APP.match(/if \(d\.view\) S\.view = d\.view;/g) || []).length + ' 处遗留');
  ok('★ 新建角色的那处仍然照常换视图（不然起局就白屏）',
    /S\.view = d\.view \|\| d;/.test(APP));

  section('4 存档列表上的时间（主人亲报：全是 1970-01-01 08:00）');
  {
    const T2 = path.join(__dirname, '_livetest3');
    fs.rmSync(T2, { recursive: true, force: true });
    fs.mkdirSync(T2, { recursive: true });
    const e9 = new GameEngine({ seed: 5, saveDir: T2 });
    await e9.boot({});
    e9.newGame({ name: '存档客' });
    await e9.exec('look');
    e9.save('slot_a');
    const list = e9.listSaves();
    const a = list.find(s => s.id === 'slot_a');
    ok('列表里读得到 savedAt', !!(a && a.savedAt), JSON.stringify(a || {}));
    /* ★ 要害：savedAt 必须是**真实墙钟毫秒**，不是游戏内分钟数。
       写成 s.time 的话 new Date(481) → 1970-01-01 08:01（就是主人看到的那一行）。 */
    ok('★ savedAt 是真实墙钟时间（不是 1970）',
      !!a && a.savedAt > Date.UTC(2020, 0, 1), a ? new Date(a.savedAt).toISOString() : '-');
    ok('s.time 是游戏内分钟数（与 savedAt 明显不同）',
      !!a && typeof a.time === 'number' && a.time < 100000, a ? String(a.time) : '-');
    /* 前端渲染必须用 savedAt */
    ok('★ 存档列表用 savedAt 渲染时刻', /存于 ' \+ when/.test(UI) && /s\.savedAt \? util\.fmtTime\(s\.savedAt\)/.test(UI));
    ok('★ 不再拿 s.time 当时刻（那就是 1970 的根因）',
      !/fmtTime\(s\.time/.test(UI), (UI.match(/fmtTime\(s\.time[^)]*\)/) || ['无'])[0]);
    fs.rmSync(T2, { recursive: true, force: true });
  }

  section('5 两份副本一致');
  ok('ui.js 两份一致', UI === UI2);
  ok('app.js 两份一致', APP === APP2);

  /* 清场 */
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(EMPTY, { recursive: true, force: true });

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
