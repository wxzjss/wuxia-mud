/* 批 2 —— 第一章甲档三件的落库表生成器（游有方）
 * 只读 design/82 §7.1.1 的文案，输出 tools/_out_act1_jiabang.tsv
 * 不写 game/data —— 只出表，落库归寇豆码。
 * 所有长度列由脚本算，不手填。
 */
const fs = require('fs');
const path = require('path');

/* 🔴 主理人 2026-10-13 拍死：走 A（改现有房为茶摊），不用 B（新建房）。
 * 房号 = road_jiangnan_1（现名「江南大路」，desc 里已经有「道旁一棵老槐树，树荫下有个卖茶的小摊」）。
 * ⚠️ 房间显示名要跟着改（现在还叫「江南大路」），改名归 §1 那批，不在这里动。 */
const ROOM = 'road_jiangnan_1';

const rows = [
  {
    label: '缸', cmd: '挪缸', inDesc: 'true',
    desc: '三尺就够，多一寸老汉不要',
    cond: '{"flag":"舀过水"}', once: 'true',
    failMsg: '缸太沉，手指嵌进去一截，拔不出来。先倒掉些水会轻些。',
    next: '舀水',
    spentMsg: '缸已经离墙三尺。多一寸老汉不要。',
    l3: '（下一次，心里默念「挪缸」就行）',
    note: '甲档首条，L3 曝光 2 次（教的是"亮着的词可以直接敲"这件事）。failMsg 前半句逐字取自 design/74 ①失败',
  },
  {
    label: '瓢', cmd: '舀水', inDesc: 'false',
    desc: '舀掉半缸水，缸就轻了',
    cond: '{"notFlag":"舀过水"}', once: 'true',
    failMsg: '缸已经轻了，再舀也是白舀。',
    next: '挪缸',
    spentMsg: '缸已经轻了，再舀也是白舀。',
    l3: '',
    note: 'once ⇒ 无"下一次" ⇒ 不给 L3 回执教。瓢全程不亮（inDesc:false），只在点「缸」展开的提示行里出现。spentMsg 实际轮不到（cond 先拦），留作兜底',
  },
  {
    label: '灶膛', cmd: '掏灰', inDesc: 'false',
    desc: '老汉要掏里头的炭灰',
    cond: '{"flag":"挪过缸"}', once: 'true',
    failMsg: '灰坑在缸后头，缸挡着，手伸不进去。',
    next: '挪缸',
    spentMsg: '灰已经掏干净了。老汉在灶门口坐着，手上是黑的。',
    l3: '',
    note: '🔴 掏灰的不是玩家（design/74：老汉侧身过去自己掏）。这条是触发位不是动作位，点了播 74「做完之后」那一段。不改 74 剧本',
  },
];

const CONDS = { '挪缸': '舀过水', '舀水': '舀过水', '掏灰': '挪过缸' };

const head = [
  'room_id', 'label', 'cmd', 'say', 'inDesc', 'desc', 'desc_len',
  'cond', 'once', 'failMsg', 'failMsg_len', 'next', 'next_target_cmd',
  'spentMsg', 'spentMsg_len', 'l3_success', 'dash_count', 'note',
];

const len = s => Array.from(String(s || '')).length;
const dash = s => (String(s || '').match(/——/g) || []).length;

const lines = [head.join('\t')];
const warn = [];
for (const r of rows) {
  // say：cmd 本身是纯中文且 ≤6 字 ⇒ 按 82 §8.2.1 第 1 步，say 不写
  const pureCn = /^[一-龥]{1,6}$/.test(r.cmd);
  const say = pureCn ? '（不写，回落 cmd）' : '❗需按 §8.2.1 挑';
  if (!pureCn) warn.push(`${r.cmd} 不是纯中文 cmd`);

  // 自检
  if (len(r.desc) > 12) warn.push(`${r.label} desc ${len(r.desc)} 字 > 12`);
  if (dash(r.failMsg) || dash(r.desc) || dash(r.spentMsg)) warn.push(`${r.label} 含破折号`);
  if (r.next && !CONDS[r.next]) warn.push(`${r.label} 的 next「${r.next}」不在本房间`);
  if (r.next === r.cmd) warn.push(`${r.label} 的 next 指回自己`);
  if (len(r.cmd) > 6) warn.push(`${r.label} cmd > 6 字`);

  lines.push([
    ROOM, r.label, r.cmd, say, r.inDesc, r.desc, len(r.desc),
    r.cond, r.once, r.failMsg, len(r.failMsg), r.next, r.next,
    r.spentMsg, len(r.spentMsg), r.l3 || '（不给：once 无下一次）',
    dash(r.failMsg) + dash(r.desc) + dash(r.spentMsg), r.note,
  ].join('\t'));
}

const out = path.join(__dirname, '_out_act1_jiabang.tsv');
fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
console.log('写入', out, fs.statSync(out).size, 'B /', lines.length, '行');
console.log(warn.length ? '⚠️ 自检告警:\n' + warn.join('\n') : '✅ 自检全绿');
