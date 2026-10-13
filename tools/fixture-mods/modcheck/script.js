/* 能力实测桩的沙箱脚本：注册一条指令 + 一个事件处理器 */
wx.command('mc试', function () {
  wx.money(11);
  return '（脚本指令）兜里多了十一文。';
});
wx.on('onKill', function (p) {
  return '（脚本onKill）' + (p && p.npcId ? p.npcId : '?') + ' 倒下了。';
});
