/* ============================================================
 *  武侠行 · 文档 / 教程数据
 *  为「小白教程」「游戏说明」提供内容
 * ============================================================ */
(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ============================================================
   *  制作器内嵌小白教程（返回 HTML 片段）
   * ============================================================ */
  function makerTutorial() {
    return `
<h3>🐣 小白也能做 Mod —— 从零开始</h3>
<p class="mm-tip">别怕，做 Mod 就像填表格。跟着下面 5 步走，10 分钟你就能做出第一个能玩的东西。</p>

<div class="tut-step">
  <div class="tut-no">1</div>
  <div class="tut-body">
    <b>先起个名字</b>
    <p>到「① 基本信息」页，填两个必填项：</p>
    <ul>
      <li><b>Mod 名称</b>：玩家看到的名字，比如「江南奇遇记」。</li>
      <li><b>Mod 标识 ID</b>：英文小写+下划线，全站唯一，比如 <code>jiangnan_story</code>。建议用拼音。</li>
    </ul>
    <p>剩下的作者、简介随便填，不影响运行。</p>
  </div>
</div>

<div class="tut-step">
  <div class="tut-no">2</div>
  <div class="tut-body">
    <b>造一个房间</b>
    <p>到「② 地图房间」页，点<b>＋ 新建房间</b>：</p>
    <ul>
      <li><b>房间名称</b>：写在游戏里显示的大字，比如「听雨小筑」。</li>
      <li><b>房间 ID</b>：英文，唯一，比如 <code>tianyu_xiaozhu</code>。</li>
      <li><b>房间描述</b>：这里的风景，随便写，越有画面感越好。</li>
      <li><b>出口</b>：想连到哪里？填目标房间的 ID。第一次做，可以先不填，我们后面用「一键测试」进游戏看。</li>
    </ul>
    <div class="tut-tip">💡 想连到游戏原有的房间？在出口输入框里点一下，会有下拉提示列出所有已有房间 ID。</div>
  </div>
</div>

<div class="tut-step">
  <div class="tut-no">3</div>
  <div class="tut-body">
    <b>放一个人物</b>
    <p>到「④ 人物 NPC」页，点<b>＋ 新建人物</b>：</p>
    <ul>
      <li><b>姓名 / ID</b>：比如「白发渔翁」/ <code>fisher_old</code>。</li>
      <li><b>所在房间</b>：下拉选你刚建的那个房间。</li>
      <li><b>气血 / 攻击</b>：新手村的 NPC 建议气血 60~150、攻击 10~20。</li>
      <li><b>打招呼</b>：玩家输入 <code>talk 白发渔翁</code> 时他说的话，每行一句。</li>
    </ul>
    <div class="tut-tip">💡 勾上「可请教武学」，玩家就能 <code>learn 白发渔翁</code> 学武功了。</div>
  </div>
</div>

<div class="tut-step">
  <div class="tut-no">4</div>
  <div class="tut-body">
    <b>加一件物品</b>
    <p>到「⑤ 物品装备」页，点<b>＋ 新建物品</b>：</p>
    <ul>
      <li><b>名称 / ID</b>：比如「九转还魂丹」/ <code>jiuzhuan_dan</code>。</li>
      <li><b>类型</b>：丹药选「消耗品」，兵器选「武器」，秘籍选「书籍」。</li>
      <li><b>使用效果</b>：写 <code>+hp:200</code> 就是回血 200；写 <code>learn:basic_sword</code> 就是学会基础剑法。</li>
    </ul>
  </div>
</div>

<div class="tut-step">
  <div class="tut-no">5</div>
  <div class="tut-body">
    <b>检查 → 保存 → 上传</b>
    <ol>
      <li>点右上角 <b>检 查</b>，我会告诉你哪里填错了。全绿就说明没问题。</li>
      <li>点 <b>保存到本地</b>，Mod 就写进游戏目录了，重载即可生效。</li>
      <li>点 <b>一键上传到 Mod 网站</b>，别人就能在「在线市场」下载你的作品啦。</li>
    </ol>
  </div>
</div>

<h3>📖 效果语法速查（重要！）</h3>
<p class="mm-tip">很多输入框里可以填「效果」，格式是 <code>动作:参数</code>，多个用空格或分号隔开。</p>
<table class="tut-table">
<tr><th>写法</th><th>含义</th></tr>
<tr><td><code>say:你好</code></td><td>让 NPC/环境说话</td></tr>
<tr><td><code>narrate:天色暗了下来</code></td><td>旁白式叙述</td></tr>
<tr><td><code>+hp:100</code></td><td>恢复 100 点气血（负数则扣血）</td></tr>
<tr><td><code>+mp:50</code> / <code>-mp:20</code></td><td>内力增减</td></tr>
<tr><td><code>+money:500</code></td><td>给 500 文钱</td></tr>
<tr><td><code>+pot:50</code></td><td>潜能（引擎已不用它；留给 Mod 自己造经济，玩家面板不显示）</td></tr>
<tr><td><code>+item:长剑:2</code></td><td>获得 2 把长剑</td></tr>
<tr><td><code>-item:长剑:1</code></td><td>拿走 1 把长剑</td></tr>
<tr><td><code>learn:basic_sword</code></td><td>学会一门武学</td></tr>
<tr><td><code>+skill:basic_sword:10</code></td><td>某武学等级 +10</td></tr>
<tr><td><code>goto:room_id</code></td><td>把玩家传送到某个房间</td></tr>
<tr><td><code>spawn:mob_wolf</code></td><td>在当前房间刷出一个 NPC</td></tr>
<tr><td><code>flag:got_letter</code></td><td>打上一个剧情标记</td></tr>
<tr><td><code>quest:q_xxx:2</code></td><td>把某任务推进到第 2 阶段</td></tr>
<tr><td><code>combat:mob_bandit</code></td><td>立刻开始战斗</td></tr>
<tr><td><code>combatWith:mob_wolf</code></td><td>与场上某个 NPC 开打（没刷出来会明说，不静默）</td></tr>
<tr><td><code>giveRandom:长剑:馒头:草鞋</code></td><td>随机给一件（随机池用 <code>:</code> 分隔）</td></tr>
<tr><td><code>menu:要不要帮我?|要>flag:help_yes;;不要>say:那你走吧</code></td><td>弹一个选择框</td></tr>
<tr><td><code>ending:结局名</code></td><td>触发结局</td></tr>
</table>

<h3>🧠 条件语法速查</h3>
<p class="mm-tip">条件用来判断「什么时候才触发」，写在「触发条件」「学习条件」等框里。</p>
<table class="tut-table">
<tr><th>写法</th><th>含义</th></tr>
<tr><td><code>realm&gt;=2</code></td><td>境界 ≥ 小有所成（0 不通武艺 / 1 初窥门径 / 2 小有所成 / 3 登堂入室 / 4 炉火纯青 / 5 登峰造极）</td></tr>
<tr><td><code>attr.悟性&gt;=20</code></td><td>悟性属性 ≥ 20</td></tr>
<tr><td><code>skill.basic_sword&gt;=50</code></td><td>基础剑法 ≥ 50 级</td></tr>
<tr><td><code>money&gt;=1000</code></td><td>身上钱 ≥ 1000 文</td></tr>
<tr><td><code>hasitem:长剑</code></td><td>身上有长剑</td></tr>
<tr><td><code>flag:got_letter</code></td><td>有某个剧情标记</td></tr>
<tr><td><code>sect:华山派</code></td><td>属于某门派</td></tr>
<tr><td><code>kills&gt;=100</code></td><td>杀敌数 ≥ 100</td></tr>
<tr><td><code>chance:0.3</code></td><td>30% 概率通过</td></tr>
<tr><td><code>and(realm&gt;=1, hasitem:长剑)</code></td><td>同时满足</td></tr>
<tr><td><code>or(sect:华山派, sect:武当派)</code></td><td>满足其一</td></tr>
<tr><td><code>not(flag:got_letter)</code></td><td>取反</td></tr>
</table>

<h3>🎯 五种 Mod 类型，各自怎么做</h3>
<div class="tut-cards">
  <div class="tut-card">
    <b>📜 剧情 Mod</b>
    <p>用「⑧ 剧情任务」+「⑨ 对话树」。先建任务，再建对话，把对话里的选项指向任务阶段。</p>
  </div>
  <div class="tut-card">
    <b>🗺 地图 Mod</b>
    <p>用「② 地图房间」+「③ 区域」。房间互联靠出口，记得每个出口两边都要连上（A→B 也要 B→A）。</p>
  </div>
  <div class="tut-card">
    <b>⚙ 功能 Mod</b>
    <p>用「⑩ 功能 Mod」。想调金钱 / 潜能倍率就选「倍数调整」，目标填 money / pot，数值填 2。想「脱战回血」就选「事件触发效果」，目标填 onTick，效果填 +hp:5。常用预设一键添加。</p>
  </div>
  <div class="tut-card">
    <b>🥋 功法 Mod</b>
    <p>用「⑥ 武学功法」。类型选对（拳/剑/刀/内功），威力倍率 1.5 以上就算强，配上一两个「招式效果」。</p>
  </div>
  <div class="tut-card">
    <b>⚔ 物品 Mod</b>
    <p>用「⑤ 物品装备」。武器记得选部位「武器」，填攻击加成；丹药填「使用效果」。</p>
  </div>
</div>

<h3>❓ 常见问题</h3>
<div class="tut-faq">
  <div><b>Q：房间建好了，为什么进游戏找不到？</b>
  <p>没连接。要么把它连到已有房间的出口上，要么在「基础信息」外的房间列表里用地图功能看一下。也可以先把「出口」指向游戏原有房间 ID，比如 <code>jiangnan_street</code>。</p></div>
  <div><b>Q：NPC 不出现？</b>
  <p>检查「所在房间」是否选对了，并且那个房间 ID 确实存在。检查报告会告诉你。</p></div>
  <div><b>Q：多个 Mod 会冲突吗？</b>
  <p>同名 ID 的后加载的会覆盖前面的。在「Mod 管理器」里调整顺序，越靠下加载越晚，覆盖力越强。</p></div>
  <div><b>Q：想改游戏原有内容怎么办？</b>
  <p>直接建一个同 ID 的房间/物品，只把要改的字段填上。没填的照旧，填了的盖过去——这叫「增量覆盖」。</p></div>
  <div><b>Q：能写代码吗？</b>
  <p>可以。到「⚙ 源码视图」直接改 JSON。更进阶还可以在 mod 目录里放 <code>main.js</code> 做自定义函数，引擎会加载。</p></div>
</div>
`;
  }

  /* ============================================================
   *  游戏完整说明文档
   * ============================================================ */
  function gameGuide() {
    return `
<div class="doc-sec">
  <h2>武侠行 · 游戏说明</h2>
  <p class="doc-lead">一款高自由度的单机武侠 MUD。你可以拜师学艺、行走江湖、快意恩仇，也可以自己造一个世界。</p>
</div>

<div class="doc-sec">
  <h3>一、开始游戏</h3>
  <ol>
    <li>选「创建角色」——先起名字，再说性别。</li>
    <li>选一门<b>出身</b>：书香门第（悟性高）、猎户之家（身法高）、商贾之后（钱多）、孤儿出身（福缘高）、武学世家（力量高）、官宦子弟（根骨高）。</li>
    <li>挑 <b>最多 2 个天赋</b>，会跟你一辈子。</li>
    <li>分配 10 点属性：力量、根骨、身法、悟性、福缘、定力，每个上限 30。</li>
    <li>「踏入江湖」——你就站在江南官道上了。</li>
  </ol>
</div>

<div class="doc-sec">
  <h3>二、刚进游戏不知道干啥？</h3>
  <p class="doc-lead">别慌，右侧有个<b>「新手指引」卡片</b>，它会一直告诉你下一步该做什么。点卡片（或点右上角「详情」）能看到全部步骤和进度。跟着走一遍就上手了：</p>
  <ol class="doc-tut">
    <li><b>看清四周</b> —— 输入 <code>look</code>（或中文「看」）</li>
    <li><b>迈开脚步</b> —— 输入 <code>n</code> 进城，或点「地图」选相邻房间</li>
    <li><b>查看行囊</b> —— 输入 <code>i</code> 看看自己带了什么</li>
    <li><b>认清自己</b> —— <code>score</code> 看状态、<code>attr</code> 看属性</li>
    <li><b>习武强身</b> —— <code>lian</code> 练功，武学等级越高越强</li>
    <li><b>结交江湖</b> —— <code>talk 人名</code> 跟 NPC 说话</li>
    <li><b>接下差事</b> —— <code>accept 任务名</code> 接任务，<code>quests</code> 看日志</li>
    <li><b>初试身手</b> —— <code>kill 人名</code> 打一架，打不过 <code>flee</code> 跑</li>
    <li><b>拜入门派</b> —— <code>join 门派名</code> 学真本事</li>
    <li><b>添置家当</b> —— <code>get 物品</code> 捡东西，或店铺 <code>buy</code></li>
    <li><b>留个记号</b> —— <code>save</code> 存档</li>
  </ol>
  <p>引导<b>不强制</b>你按顺序来，想干嘛就干嘛，随时能回来接着看。全部走完就算毕业啦。</p>
</div>

<div class="doc-sec">
  <h3>三、江湖舆图（地图）</h3>
  <p class="doc-lead">点左侧「地图」打开<b>可视化舆图</b>。它按真实方位自动排版，你能一眼看清自己站在哪、周围有什么、哪条路通向何方。</p>
  <ul>
    <li><b>红色方块</b>是你当前所在；<b>金色</b>是一步能到的地方，<b>点它就能走过去</b>。</li>
    <li>每个区域有独立底色和区域名，共 <b>22 个区域、99 处地点</b>。</li>
    <li>顶部有<b>探索进度</b>：去过的地方会记为「已探明」，没去过的是「？」。</li>
    <li>地图底部列出所有区域及各自的探索度，方便你查漏补缺。</li>
    <li>走到没去过的地方会自动记录，所以<b>多走动就能点亮全图</b>。</li>
  </ul>
  <p class="doc-note">小提示：九十九处地点最远的地方要走 12 步，桃花岛得坐船（东海码头 → 渔船 → 桃花岛渡口）。</p>
</div>

<div class="doc-sec">
  <h3>四、核心玩法</h3>
  <div class="doc-grid">
    <div class="doc-card"><b>行走</b><p>点房间下方的方向按钮，或输入 <code>n</code> <code>s</code> <code>e</code> <code>w</code>，也可以用中文「往北走」。键盘 QEZC = 四斜角，WASD = 四方。</p></div>
    <div class="doc-card"><b>成长</b><p>武学靠<b>请教</b>师父、参悟石壁、读书识字得来，练得越多越熟。你的强弱只看武学功法等级——练成绝学，<b>境界</b>自升。</p></div>
    <div class="doc-card"><b>武学</b><p>武学分拳脚、剑法、刀法、内功、轻功等。等级越高威力越大。<code>lian 武学名</code> 可以自己练功涨熟练度。</p></div>
    <div class="doc-card"><b>战斗</b><p><code>kill 目标</code> 出手。战斗面板选「普通攻击 / 防御 / 逃跑」，已激活的武学还会把它的<b>武技</b>摆成一排按钮，点一下即出招（等同于 <code>perform 招式名</code>）。</p></div>
    <div class="doc-card"><b>门派</b><p>找到门派山门，<code>join 门派名</code> 拜师。做门派贡献可以晋升职位，解锁更高级武学。</p></div>
    <div class="doc-card"><b>任务</b><p>跟 NPC <code>talk</code> 或 <code>ask</code>。接到的任务在右侧「当前任务」可见，完成后回禀报。</p></div>
  </div>
</div>

<div class="doc-sec">
  <h3>五、指令速查</h3>
  <table class="doc-table">
  <tr><th>类别</th><th>指令</th></tr>
  <tr><td>行走</td><td><code>n s e w u d</code> / <code>go 方向</code> / <code>look</code>（看四周）</td></tr>
  <tr><td>交流</td><td><code>say 内容</code> / <code>me 动作</code> / <code>shout 内容</code> / <code>tell 人 内容</code></td></tr>
  <tr><td>物品</td><td><code>i</code>（行囊） / <code>get 物</code> / <code>drop 物</code> / <code>use 物</code> / <code>wear 装备</code> / <code>wield 武器</code></td></tr>
  <tr><td>武学</td><td><code>skills</code> / <code>learn 人 武学</code> / <code>lian 武学</code> / <code>enable 武学</code> / <code>perform 招式</code></td></tr>
  <tr><td>门派</td><td><code>sect</code> / <code>join 门派</code> / <code>promote</code> / <code>contribute</code></td></tr>
  <tr><td>战斗</td><td><code>kill 人</code> / <code>flee</code> / <code>auto</code></td></tr>
  <tr><td>任务</td><td><code>quests</code> / <code>accept 任务</code> / <code>report</code> / <code>abandon 任务</code></td></tr>
  <tr><td>店铺</td><td><code>list 商人</code> / <code>buy 物 数量</code> / <code>sell 物 数量</code></td></tr>
  <tr><td>系统</td><td><code>save</code> / <code>load</code> / <code>map</code> / <code>sc</code> / <code>attr</code> / <code>time</code> / <code>rebirth</code>（转生）</td></tr>
  </table>
</div>

<div class="doc-sec">
  <h3>六、快捷键</h3>
  <ul>
    <li><b>方向键 ↑↓</b>：调出历史指令</li>
    <li><b>数字键 1-9</b>：点选对应的出口按钮</li>
    <li><b>W A S D</b>：北 西 南 东（游戏常用键位）</li>
    <li><b>Q E Z C</b>：西北 东北 西南 东南</li>
    <li><b>L</b>：查看四周 &nbsp; <b>I</b>：打开行囊</li>
    <li><b>Esc</b>：关闭弹窗 / 清空输入</li>
  </ul>
</div>

<div class="doc-sec">
  <h3>七、Mod 系统</h3>
  <p>游戏内容 100% 数据驱动，所以任何东西都能被 Mod 改。三类玩法：</p>
  <div class="doc-grid">
    <div class="doc-card"><b>玩游戏</b><p>「MOD 管理器」里启用别人做好的 Mod，重载后立刻生效。</p></div>
    <div class="doc-card"><b>做游戏</b><p>「MOD 制作器」里填表格做 Mod，全程不写代码。</p></div>
    <div class="doc-card"><b>分享游戏</b><p>制作器里点「一键上传」，发到 Mod 网站；别人点「一键下载」就能装上。</p></div>
  </div>
  <p class="doc-note">详细教程见 Mod 制作器里的「📖 小白教程」页。</p>
</div>

<div class="doc-sec">
  <h3>八、存档位置</h3>
  <p>存档在游戏目录 <code>saves/</code> 下，是纯文本 JSON，可以自己备份、复制、分享。</p>
  <p>Mod 文件在 <code>mods/</code> 下，每个 Mod 一个文件夹，里面是 <code>mod.json</code> 加你放的任何资源。</p>
</div>
`;
  }

  /* ============================================================
   *  Mod 网站上的制作教程（供站点页面用）
   * ============================================================ */
  function siteTutorial() {
    return makerTutorial();
  }

  /* ============================================================
   *  各类 Mod 示例（网站「示例」页与本地示例 mod 共用）
   * ============================================================ */
  const EXAMPLES = {
    story: {
      title: '剧情 Mod 示例 · 江南奇遇记',
      desc: '一个最简剧情：在老侠客处接到任务，去击杀山贼头目，回来领赏。',
      json: {
        id: 'demo_story',
        name: '江南奇遇记',
        version: '1.0.0',
        author: '武侠行官方',
        category: '剧情',
        desc: '一段发生在江南的支线奇遇。',
        tags: ['剧情', '江南', '新手'],
        gameVersion: '1.0.0',
        quests: [
          {
            id: 'q_demo_bandit',
            name: '江南除害',
            giver: 'swordman_wander',
            level: 1,
            type: '支线',
            desc: '江南官道上有个游侠，说附近山贼猖狂，愿出钱请人除去贼首。',
            rewards: [{ type: '+pot', args: [160] }, { type: '+money', args: [200] }, { type: '+item', args: ['jinchuang_yao', 1] }],
            stages: [
              { desc: '答应游侠的请求', kind: 'flag', key: 'q_demo_start', count: 1 },
              { desc: '击杀山贼头目', kind: 'kill', key: 'mob_bandit_chief', count: 1 },
              { desc: '回去向游侠复命', kind: 'flag', key: 'q_demo_report', count: 1 }
            ]
          }
        ],
        dialogues: [
          {
            id: 'dlg_demo_youxia',
            name: '游侠的托付',
            npc: 'swordman_wander',
            start: 'n1',
            nodes: [
              {
                id: 'n1', who: '', text: '这位侠士，且慢行。近日官道旁山贼出没，你可愿出手相助？',
                options: [
                  { label: '愿往', next: 'n2', effect: 'quest:q_demo_bandit:2' },
                  { label: '与我无关', next: 'n3' }
                ]
              },
              { id: 'n2', who: '', text: '多谢！贼首就在官道往北的密林里。', options: [{ label: '（离去）', next: '' }] },
              { id: 'n3', who: '', text: '唉……罢了，人各有志。', options: [{ label: '（离去）', next: '' }] }
            ]
          }
        ],
        npcs: [
          {
            id: 'swordman_wander', name: '游侠', title: '江湖浪客', gender: 'male',
            room: 'road_jiangnan_1', hp: 400, atk: 30, def: 15,
            desc: '一个背着长剑的年轻游侠，眉宇间有几分正气。',
            talk: ['江湖路远，侠士珍重。', '听说北边林子不太平。'],
            canTeach: true, teach: ['basic_sword'], quests: ['q_demo_bandit']
          }
        ]
      }
    },

    map: {
      title: '地图 Mod 示例 · 听雨山庄',
      desc: '新建 3 个房间并连成一片小地图，还接到江南官道上。',
      json: {
        id: 'demo_map',
        name: '听雨山庄',
        version: '1.0.0',
        author: '武侠行官方',
        category: '地图',
        desc: '在江南附近新增一处清幽山庄。',
        tags: ['地图', '江南'],
        regions: [
          { id: 'tingyu', name: '听雨山庄', color: '#7f9bb5', desc: '一座隐居江南的雅致庄园。' }
        ],
        rooms: [
          {
            id: 'tingyu_gate', name: '山庄门口', region: 'tingyu',
            desc: '两扇朱漆大门，门楣上挂着「听雨山庄」的匾额。门旁石狮蹲踞，阶前落了一地杏花。',
            exits: { n: 'tingyu_yard', s: 'road_jiangnan_1' }
          },
          {
            id: 'tingyu_yard', name: '听雨庭院', region: 'tingyu',
            desc: '院里一株老梅，枝干虬曲。廊下挂着几只鸟笼，无人却闻鸟鸣。雨丝打在青石板上，滴滴答答。',
            exits: { s: 'tingyu_gate', n: 'tingyu_hall', e: 'tingyu_pool' },
            onEnter: 'narrate:檐角风铃轻响，似有人来。'
          },
          {
            id: 'tingyu_hall', name: '听雨厅', region: 'tingyu',
            desc: '厅中陈设简朴，一琴一案，墙上挂着一幅未干的山水。案上茶还温着，人却不知去了何处。',
            exits: { s: 'tingyu_yard' },
            onLook: 'hint:画角似乎有一行小字。'
          },
          {
            id: 'tingyu_pool', name: '听雨池', region: 'tingyu',
            desc: '一泓碧水，池中锦鲤悠然。池畔有石桌石凳，桌上刻着棋盘，残局未完。',
            exits: { w: 'tingyu_yard' }
          }
        ]
      }
    },

    func: {
      title: '功能 Mod 示例 · 轻松江湖',
      desc: '双倍潜能、双倍金钱、脱战自动回血。适合想轻松体验剧情的玩家。',
      json: {
        id: 'demo_func',
        name: '轻松江湖',
        version: '1.0.0',
        author: '武侠行官方',
        category: '功能',
        desc: '降低肝度：双倍收益 + 自动回血。',
        tags: ['功能', '便利'],
        rules: [
          { name: '双倍潜能', kind: 'multiply', target: 'pot', value: 2, cond: '', effect: '' },
          { name: '双倍金钱', kind: 'multiply', target: 'money', value: 2, cond: '', effect: '' },
          { name: '脱战回血', kind: 'onEvent', target: 'onTick', value: 1, cond: '!combat', effect: '+hp:8' },
          { name: '击杀额外潜能', kind: 'onEvent', target: 'onKill', value: 1, cond: '', effect: '+pot:15' }
        ]
      }
    },

    skill: {
      title: '功法 Mod 示例 · 太虚剑意',
      desc: '一门自创剑法，含连击与无视防御效果，威力介于一流与绝学之间。',
      json: {
        id: 'demo_skill',
        name: '太虚剑意',
        version: '1.0.0',
        author: '武侠行官方',
        category: '功法',
        desc: '一门讲究「意在剑先」的高阶剑法。',
        tags: ['功法', '剑法'],
        skills: [
          {
            id: 'taixu_jianyi',
            name: '太虚剑意',
            type: '剑',
            maxLevel: 180,
            difficulty: 4,
            damageMult: 2.1,
            accuracy: 25,
            mpCost: 30,
            desc: '剑走太虚，意在剑先。一出手便如云海翻涌，绵绵不绝。',
            require: 'realm>=2',
            effects: [
              { type: 'extraHit', value: 0.35, chance: 0.4, name: '剑影分光' },
              { type: 'ignoreDef', value: 0.4, chance: 0.25, name: '无相' },
              { type: 'drain', value: 0.15, chance: 0.3, name: '剑气回元' }
            ]
          },
          {
            id: 'taixu_xinfa',
            name: '太虚心法',
            type: '内功',
            maxLevel: 200,
            difficulty: 4,
            damageMult: 1,
            mpCost: 0,
            mpBonus: 8,
            desc: '太虚剑意的内功根基，修之可扩经脉、增内力。',
            require: 'realm>=2',
            bonus: { hp: 6, mp: 10 },
            effects: []
          }
        ],
        items: [
          {
            id: 'book_taixu', name: '太虚剑谱', type: 'book', price: 5000, weight: 1,
            desc: '一册薄薄的手抄本，扉页写着「意在剑先」四字。',
            use: 'learn:taixu_jianyi'
          }
        ]
      }
    },

    item: {
      title: '物品 Mod 示例 · 百宝囊',
      desc: '一批实用丹药与一把过渡兵器。',
      json: {
        id: 'demo_item',
        name: '百宝囊',
        version: '1.0.0',
        author: '武侠行官方',
        category: '物品',
        desc: '新增若干丹药与一把趁手的剑。',
        tags: ['物品'],
        items: [
          {
            id: 'qingxin_dan', name: '清心丹', type: 'consumable', price: 120, weight: 1,
            desc: '入口清凉，可解百毒、宁心神。', use: '+mp:200', stackable: true
          },
          {
            id: 'huxin_dan', name: '护心丹', type: 'consumable', price: 300, weight: 1,
            desc: '服下后气血翻涌，外伤立愈。', use: '+hp:500', stackable: true
          },
          {
            id: 'wugou_jian', name: '无垢剑', type: 'weapon', slot: '武器',
            price: 2400, weight: 3, atk: 45, dodge: 5,
            desc: '一柄通体莹白的软剑，出鞘无声。'
          },
          {
            id: 'qingyun_pao', name: '青云袍', type: 'armor', slot: '身体',
            price: 1800, weight: 2, def: 32, hp: 80,
            desc: '青缎裁成，轻软透气，内衬软甲。'
          }
        ]
      }
    }
  };

  /* ============================================================
   *  导出
   * ============================================================ */
  global.WXDOC = {
    makerTutorial,
    gameGuide,
    siteTutorial,
    EXAMPLES,
    /** 生成示例列表 HTML（供文档页用） */
    examplesHtml() {
      return Object.keys(EXAMPLES).map(k => {
        const e = EXAMPLES[k];
        return '<div class="ex-card"><div class="ex-title">' + esc(e.title) + '</div>' +
          '<div class="ex-desc">' + esc(e.desc) + '</div>' +
          '<div class="ex-ops"><button class="op-btn" data-example="' + k + '">查看源码</button>' +
          '<button class="op-btn" data-example-load="' + k + '">载入制作器</button></div></div>';
      }).join('');
    }
  };

})(window);
