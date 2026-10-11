/* ============================================================
 *  武侠行 · 可视化 MOD 制作器
 *  目标：小白不写代码也能做出剧情 / 地图 / 功能 / 功法 / 物品 Mod
 *  所有内容都在表单里点选填写 → 生成 mod.json
 * ============================================================ */
(function (global) {
  'use strict';

  const { S, api, util } = global.WX;
  const U = global.WXUI;
  const $ = id => document.getElementById(id);
  const esc = util.esc;

  /* ============================================================
   *  空白模板
   * ============================================================ */
  function blankSpec() {
    return {
      id: '',
      name: '',
      version: '1.0.0',
      author: '',
      category: '剧情',
      desc: '',
      tags: [],
      gameVersion: '1.0.0',
      requires: [],
      /* 内容区 */
      rooms: [],
      regions: [],
      npcs: [],
      items: [],
      skills: [],
      sects: [],
      quests: [],
      dialogues: [],
      functions: [],
      rules: [],
      /* ⚠️ 新增的两类**必须在这里登记**：`jsonToSpec` 只拷 blankSpec 里已有的键，
         漏登记的话，作者按 id 载入的结局/天赋一保存（或被重新导入）就没了。
         （上一轮隐藏溯源 ID 就栽在这上面。） */
      endings: [],
      traits: [],
      /* 隐藏溯源 ID（主人 2026-10-11）：**不在界面上出现**，只是跟着文件走。
         下载/导入别人的 Mod 时它会跟着进来，上传时服务端据此认原作者。
         ⚠️ 它必须留在 blankSpec 里 —— `jsonToSpec` 只拷 blankSpec 已有的键，
            不在这里登记的话，导入一次就被抹掉了（隐藏 ID 等于白做）。 */
      _wxTrace: ''
      /* ⚠ 这里**不要**塞 `meta: {}`：制作器用的是「扁平结构」（id/name 在顶层）。
         引擎的 normalizeSpec 判定 `spec.meta || spec`，一个空的 meta 对象是 truthy，
         会把顶层的 id/name **整个遮掉** → 校验恒报「Mod ID 必须填写 / 请填写 Mod 名称」，
         小白填完表单点上传被**永久拦下**，还找不到哪里错。 */
    };
  }

  const TABS = ['basic', 'rooms', 'regions', 'npcs', 'items', 'skills', 'sects', 'stories', 'dialogue', 'functions', 'ids', 'tutorial', 'mine', 'json', 'report'];

  const T = {
    cur: 'basic',
    dirty: false,
    meta: null,
    /* 「游戏内 ID」那一页的当前分类与搜索词（主人 2026-10-11） */
    idKind: 'npcs',
    idQuery: ''
  };

  /* 品级（quality）——与 core/social.js 的 QUALITY_TIERS 同口径（英文 id 为主键）。
     小白看不懂 rare/epic，所以下拉一律显示中文：粗劣/寻常/精良/珍稀/绝世/传说。
     武学的品级决定「请教价码 / 强度评定」，物品的品级不填则按价格自动推断。 */
  const QUALITY = [
    { value: 'worn', label: '粗劣' },
    { value: 'common', label: '寻常' },
    { value: 'fine', label: '精良' },
    { value: 'rare', label: '珍稀' },
    { value: 'epic', label: '绝世' },
    { value: 'legend', label: '传说' }
  ];

  /* ============================================================
   *  打开制作器
   * ============================================================ */
  async function open() {
    try {
      T.meta = await api.editorMeta();
    } catch (e) {
      U.toast('无法加载制作器元数据：' + e.message, 'error');
      return;
    }
    if (!S.spec) S.spec = blankSpec();
    bindHeader();
    bindTabs();
    refreshMeStrip();
    paintTab(T.cur);
  }

  function bindHeader() {
    const imp = $('mm-import');
    if (imp && !imp.__bound) {
      imp.__bound = true;
      imp.onclick = doImport;
    }
    const val = $('mm-validate');
    if (val && !val.__bound) { val.__bound = true; val.onclick = () => { runValidate(true); tab('report'); }; }
    const sav = $('mm-save');
    if (sav && !sav.__bound) { sav.__bound = true; sav.onclick = doSave; }
    const up = $('mm-upload');
    if (up && !up.__bound) { up.__bound = true; up.onclick = doUpload; }
    /* 账号按钮（主人 2026-10-11）：没登录 → 弹登录框；登录了 → 账号菜单 */
    const acc = $('mm-account');
    if (acc && !acc.__bound) {
      acc.__bound = true;
      acc.onclick = async () => {
        if (!isLoggedIn()) {
          if (await askLogin() && T.cur === 'mine') paintTab('mine');
          return;
        }
        U.modal('账号',
          '<div class="up-box">' +
          '<div class="up-row"><label>当前账号</label><b>' + esc(S.my.name) + '</b></div>' +
          '<div class="up-tip">你发布过的作品都在「我制作的 Mod」里，随时可以载回来改。</div>' +
          '</div>',
          '<button class="btn-ink" id="acc-close">关 闭</button>' +
          '<button class="btn-ink" id="acc-my">我制作的 Mod</button>' +
          '<button class="btn-ink" id="acc-out">退出登录</button>');
        const c = $('acc-close'); if (c) c.onclick = () => U.closeModal();
        const my = $('acc-my'); if (my) my.onclick = () => { U.closeModal(); tab('mine'); };
        const out = $('acc-out');
        if (out) out.onclick = async () => {
          try { await api.account('logout', { token: S.my.token }); } catch (e) { /* 登出失败也照样清本地 */ }
          global.WX.setMe(Object.assign({}, S.my || {}, { token: '' }));
          U.closeModal();
          refreshMeStrip();
          U.toast('已退出登录', 'ok');
          if (T.cur === 'mine') paintTab('mine');
        };
      };
    }
  }

  function bindTabs() {
    document.querySelectorAll('.mm-tab').forEach(b => {
      b.onclick = () => tab(b.getAttribute('data-tab'));
    });
  }

  function tab(name) {
    if (TABS.indexOf(name) < 0) name = 'basic';
    T.cur = name;
    document.querySelectorAll('.mm-tab').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === name));
    paintTab(name);
  }

  function isDirty() { return T.dirty; }
  function mark() { T.dirty = true; }

  /* ============================================================
   *  标签页渲染分发
   * ============================================================ */
  function paintTab(name) {
    const box = $('mm-content');
    if (!box) return;
    let html = '';
    switch (name) {
      case 'basic': html = tabBasic(); break;
      case 'rooms': html = tabRooms(); break;
      case 'regions': html = tabRegions(); break;
      case 'npcs': html = tabNpcs(); break;
      case 'items': html = tabItems(); break;
      case 'skills': html = tabSkills(); break;
      case 'sects': html = tabSects(); break;
      case 'stories': html = tabStories(); break;
      case 'dialogue': html = tabDialogue(); break;
      case 'functions': html = tabFunctions(); break;
      case 'tutorial': html = tabTutorial(); break;
      case 'ids': html = tabIds(); break;
      case 'mine': html = tabMine(); break;
      case 'json': html = tabJson(); break;
      case 'report': html = tabReport(); break;
      default: html = '<div class="mm-empty">未知标签</div>';
    }
    box.innerHTML = html;
    box.scrollTop = 0;
    wireTab(name);
  }

  /* ============================================================
   *  通用表单小部件
   * ============================================================ */
  function field(label, inputHtml, hint) {
    return '<label class="mm-field"><span class="mm-label">' + esc(label) + '</span>' +
      inputHtml + (hint ? '<span class="mm-hint">' + esc(hint) + '</span>' : '') + '</label>';
  }
  function input(path, value, ph, type) {
    return '<input class="mm-input" data-bind="' + esc(path) + '" type="' + (type || 'text') + '" value="' +
      esc(value == null ? '' : value) + '" placeholder="' + esc(ph || '') + '">';
  }
  function area(path, value, ph, rows) {
    return '<textarea class="mm-input mm-area" data-bind="' + esc(path) + '" rows="' + (rows || 3) + '" placeholder="' +
      esc(ph || '') + '">' + esc(value == null ? '' : value) + '</textarea>';
  }
  function select(path, value, options, ph) {
    let h = '<select class="mm-input" data-bind="' + esc(path) + '">';
    if (ph) h += '<option value="">' + esc(ph) + '</option>';
    options.forEach(o => {
      const v = typeof o === 'string' ? o : o.value;
      const t = typeof o === 'string' ? o : o.label;
      h += '<option value="' + esc(v) + '"' + (String(v) === String(value) ? ' selected' : '') + '>' + esc(t) + '</option>';
    });
    return h + '</select>';
  }
  function check(path, on, label) {
    return '<label class="mm-check"><input type="checkbox" data-bind="' + esc(path) + '"' + (on ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
  }
  function row(title, sub, idx, arrName, bodyHtml, extra) {
    return '<div class="mm-row" data-row="' + esc(arrName) + '" data-idx="' + idx + '">' +
      '<div class="mm-row-head"><span class="mm-row-title">' + esc(title || ('条目 ' + (idx + 1))) + '</span>' +
      (sub ? '<span class="mm-row-sub">' + esc(sub) + '</span>' : '') +
      '<span class="mm-row-ops">' + (extra || '') +
      '<button class="mini-btn" data-row-up="' + idx + '">↑</button>' +
      '<button class="mini-btn" data-row-down="' + idx + '">↓</button>' +
      '<button class="mini-btn danger" data-row-del="' + idx + '">✕</button>' +
      '</span></div><div class="mm-row-body">' + bodyHtml + '</div></div>';
  }
  function addBtn(label, key) {
    return '<button class="mm-add" data-add="' + esc(key) + '">＋ ' + esc(label) + '</button>';
  }
  function empty(label) {
    return '<div class="mm-empty">' + esc(label) + '</div>';
  }

  /* ============================================================
   *  ① 基本信息
   * ============================================================ */
  function tabBasic() {
    const s = S.spec;
    const cats = ['剧情', '地图', '功能', '功法', '物品', '门派', '任务', '综合', '美化'];
    return '<div class="mm-section">' +
      '<h3>Mod 基本信息</h3>' +
      '<p class="mm-tip">这里填写你这个 Mod 的招牌信息，会显示在 Mod 管理器和 Mod 网站上。<b>带 * 的是必填</b>。</p>' +
      '<div class="mm-form-grid">' +
      field('Mod 名称 *', input('name', s.name, '例如：江南奇遇记'), '玩家看到的名字，随便起，中文最好') +
      field('Mod 标识 ID *', input('id', s.id, '例如：jiangnan_story'), '英文/数字/下划线，全站唯一，建议用拼音') +
      field('作者', input('author', s.author, '你的大名')) +
      field('版本号', input('version', s.version, '1.0.0')) +
      field('分类', select('category', s.category, cats)) +
      field('适用游戏版本', input('gameVersion', s.gameVersion, '1.0.0'), '不确定就保持默认') +
      '</div>' +
      field('简介', area('desc', s.desc, '一句话介绍这个 Mod 玩什么…', 3)) +
      field('标签', input('__tags', (s.tags || []).join(' '), '用空格分隔，如：剧情 江南 新手'), '方便别人搜索') +
      '</div>';
  }

  /* ============================================================
   *  ② 地图房间
   * ============================================================ */
  function tabRooms() {
    const s = S.spec;
    const dirs = [['n', '北'], ['s', '南'], ['e', '东'], ['w', '西'], ['u', '上'], ['d', '下'], ['ne', '东北'], ['nw', '西北'], ['se', '东南'], ['sw', '西南']];
    const rooms = T.meta ? (T.meta.rooms || []) : [];
    const regions = T.meta ? (T.meta.regions || []) : [];

    let h = '<div class="mm-section"><h3>地图房间</h3>' +
      '<p class="mm-tip">每个「房间」就是玩家能站的一个地方。用<b>出口方向</b>把它们连起来，就成了一张地图。<br>' +
      '小技巧：先在「区域」页建一个区域，再建房间时选上它，地图上就会自动归组。</p>';

    h += '<div class="mm-roomlist"><span class="mm-row-sub">新建房间可连接到已有房间：</span>' +
      '<input class="mm-input mm-mid" id="mm-room-search" placeholder="搜索已有房间…（选填）" list="mm-room-options">' +
      '<datalist id="mm-room-options">' + rooms.map(r => '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>').join('') + '</datalist>' +
      '</div>';

    h += (s.rooms || []).map((r, i) => {
      const exHtml = dirs.map(d => {
        const v = (r.exits && (r.exits[d[0]] || r.exits[d[1]])) || '';
        return '<div class="mm-exit"><span class="mm-exit-dir">' + d[1] + '</span>' +
          '<input class="mm-input mm-exit-in" data-exit="' + i + '|' + d[0] + '" value="' + esc(typeof v === 'string' ? v : (v && v.to) || '') + '" placeholder="目标房间ID" list="mm-room-options"></div>';
      }).join('');

      const body =
        '<div class="mm-form-grid">' +
        field('房间名称 *', input('rooms.' + i + '.name', r.name, '例如：听雨小筑')) +
        field('房间 ID *', input('rooms.' + i + '.id', r.id, '例如：tianyu_xiaozhu', 'text')) +
        field('所属区域', select('rooms.' + i + '.region', r.region, regions.map(x => ({ value: x.id, label: x.name })), '（不选也行）')) +
        '</div>' +
        field('房间描述', area('rooms.' + i + '.desc', r.desc, '描写一下这里的景色、气味、声音…（支持换行）', 3)) +
        '<div class="mm-sub-title">出口（填「目标房间ID」）</div><div class="mm-exits">' + exHtml + '</div>' +
        '<div class="mm-sub-title">进入时触发（可选）</div>' +
        field('进入效果', input('rooms.' + i + '.onEnter', r.onEnter, '例如：say:你踏入门内，一股药香扑面而来'), '效果语法见「小白教程」') +
        field('查看时追加', input('rooms.' + i + '.onLook', r.onLook, '例如：hint:墙上有幅字画'));

      return row(r.name || ('房间 ' + (i + 1)), r.id, i, 'rooms', body);
    }).join('') || empty('还没有房间，点下面的按钮加一个吧～');

    h += addBtn('新建房间', 'rooms') + '</div>';
    return h;
  }

  /* ============================================================
   *  ③ 区域
   * ============================================================ */
  function tabRegions() {
    const s = S.spec;
    let h = '<div class="mm-section"><h3>区域</h3>' +
      '<p class="mm-tip">区域是地图上的「大板块」，比如江南、华山。房间归到区域里，地图上会聚成一块。</p>';
    h += (s.regions || []).map((r, i) => {
      const body = '<div class="mm-form-grid">' +
        field('区域名称 *', input('regions.' + i + '.name', r.name, '例如：桃花岛')) +
        field('区域 ID *', input('regions.' + i + '.id', r.id, '例如：taohuadao')) +
        field('地图颜色', '<input class="mm-input mm-color" type="color" data-bind="regions.' + i + '.color" value="' + esc(r.color || '#7a9a7a') + '">') +
        '</div>' +
        field('区域描述', input('regions.' + i + '.desc', r.desc, '一句话介绍'));
      return row(r.name || ('区域 ' + (i + 1)), r.id, i, 'regions', body);
    }).join('') || empty('还没有区域');
    h += addBtn('新建区域', 'regions') + '</div>';
    return h;
  }

  /* ============================================================
   *  ④ NPC
   * ============================================================ */
  function tabNpcs() {
    const s = S.spec;
    const rooms = T.meta ? (T.meta.rooms || []) : [];
    const sects = T.meta ? (T.meta.sects || []) : [];
    const skills = T.meta ? (T.meta.skills || []) : [];

    let h = '<div class="mm-section"><h3>人物 NPC</h3>' +
      '<p class="mm-tip">商人、乞丐、掌门、野兽……都在这建。选个房间，填好血量，就能在游戏里见到他。</p>';

    h += (s.npcs || []).map((n, i) => {
      const body = '<div class="mm-form-grid">' +
        field('姓名 *', input('npcs.' + i + '.name', n.name, '例如：白发渔翁')) +
        field('NPC ID *', input('npcs.' + i + '.id', n.id, '例如：fisher_old')) +
        field('称谓', input('npcs.' + i + '.title', n.title, '例如：江上闲人')) +
        field('性别', select('npcs.' + i + '.gender', n.gender || 'male', [{ value: 'male', label: '男' }, { value: 'female', label: '女' }])) +
        field('所在房间 *', select('npcs.' + i + '.room', n.room, rooms.map(x => ({ value: x.id, label: x.name + '（' + x.id + '）' })), '— 选房间 —')) +
        field('等级', input('npcs.' + i + '.level', n.level != null ? n.level : 5, '', 'number')) +
        field('气血', input('npcs.' + i + '.hp', n.hp != null ? n.hp : 100, '', 'number')) +
        field('内力', input('npcs.' + i + '.mp', n.mp != null ? n.mp : 0, '', 'number')) +
        field('攻击', input('npcs.' + i + '.atk', n.atk != null ? n.atk : 10, '', 'number')) +
        field('防御', input('npcs.' + i + '.def', n.def != null ? n.def : 5, '', 'number')) +
        field('闪避', input('npcs.' + i + '.dodge', n.dodge != null ? n.dodge : 5, '', 'number')) +
        field('速度', input('npcs.' + i + '.speed', n.speed != null ? n.speed : 10, '', 'number')) +
        '</div>' +
        /* ⚠️ 这四项是 2026-10-08 补的 —— 之前制作器只能编数值和描述，
           与性格系统 / 门派体系 / 分部设计有关的字段**一个都填不了**，
           照着示例 mod 抄出来的人物在游戏里是「没有性格、没有门派、没有分部」的。
           示例 mod 是给人抄的模板，制作器填不出同样的东西，等于模板白给。 */
        '<div class="mm-sub-title">脾性与归属</div><div class="mm-form-grid">' +
        field('营生（tag）', input('npcs.' + i + '.tag', n.tag || '', '决定「细看此人」看出的行当细节：swordsman / doctor / beggar…')) +
        field('性子（personality）', select('npcs.' + i + '.personality', n.personality || 'mune', [
          ['haoshuang', '豪爽'], ['yinzhi', '阴鸷'], ['qienuo', '怯懦'], ['xiayi', '侠义'], ['youhua', '油滑'],
          ['mune', '木讷'], ['wenwan', '温婉'], ['baozhao', '暴躁'], ['lengmo', '冷漠'],
        ])) +
        field('分部（tier）', select('npcs.' + i + '.tier', n.tier || 'C', [
          ['A', 'A · 名角'], ['B', 'B · 有名字的'], ['C', 'C · 寻常人'], ['mob', 'mob · 杂兵'],
        ])) +
        field('门派（sect）', input('npcs.' + i + '.sect', n.sect || '', '门派 id（如 huashan）；留空就是散人')) +
        '</div>' +
        field('人物描述', area('npcs.' + i + '.desc', n.desc, '他长什么样？在做什么？', 2)) +
        '<div class="mm-check-row">' +
        check('npcs.' + i + '.hostile', n.hostile, '主动攻击玩家（怪物）') +
        check('npcs.' + i + '.isShop', n.isShop, '是商人（可 list / buy / sell）') +
        check('npcs.' + i + '.canTeach', n.canTeach, '可请教武学（learn）') +
        check('npcs.' + i + '.leavesCorpse', n.leavesCorpse !== false, '死亡后留尸体（可搜刮）') +
        '</div>' +
        '<div class="mm-sub-title">可请教武学（逗号分隔 ID）</div>' +
        input('npcs.' + i + '.teach', (Array.isArray(n.teach) ? n.teach.join(',') : (n.teach || '')), '例如：basic_sword,basic_fist') +
        '<div class="mm-sub-title">掉落 / 奖励</div><div class="mm-form-grid">' +
        field('掉落物品（逗号分隔）', input('npcs.' + i + '.loot', (n.loot || []).join ? (n.loot || []).join(',') : (n.loot || ''), '例如：jinchuang_yao,silver')) +
        field('经验奖励', input('npcs.' + i + '.expReward', n.expReward != null ? n.expReward : 0, '', 'number')) +
        field('潜能奖励', input('npcs.' + i + '.potReward', n.potReward != null ? n.potReward : 0, '', 'number')) +
        field('银两奖励', input('npcs.' + i + '.moneyReward', n.moneyReward != null ? n.moneyReward : 0, '', 'number')) +
        '</div>' +
        '<div class="mm-sub-title">打招呼（talk 时说的话）</div>' +
        area('npcs.' + i + '.talk', Array.isArray(n.talk) ? n.talk.join('\n') : (n.talk || ''), '每行一句', 3);
      return row(n.name || ('NPC ' + (i + 1)), n.id, i, 'npcs', body);
    }).join('') || empty('还没有人物');

    h += addBtn('新建人物', 'npcs') + '</div>';
    return h;
  }

  /* ============================================================
   *  ⑤ 物品
   * ============================================================ */
  function tabItems() {
    const s = S.spec;
    const types = T.meta ? (T.meta.itemTypes || []) : [];
    const slots = T.meta ? (T.meta.slots || []) : [];
    /* 类型下拉必须显示**中文**：游戏里 itemTypeCN 才是玩家话（weapon=武器、consumable=丹药）。
       老代码 label 直接用了英文码，小白照着「小白教程」找「武器/书籍」根本找不到。 */
    const typeCN = (T.meta && T.meta.itemTypeCN) || {};
    const typeOpts = types.map(t => ({ value: t.value || t, label: t.label || typeCN[t.value || t] || (t.value || t) }));
    const slotOpts = slots.map(t => ({ value: t.value || t, label: t.label || (t.value || t) }));
    const slotVals = slotOpts.map(o => String(o.value));

    let h = '<div class="mm-section"><h3>物品装备</h3>' +
      '<p class="mm-tip">丹药、兵器、秘籍、任务道具……都在这里造。</p>';

    h += (s.items || []).map((it, i) => {
      /* 部位同理：别处抄来的 mod 可能写英文 slot（weapon/body），
         游戏按字面当槽位键 → 会占出一个「游戏不认的槽位」。这里当场提醒。 */
      const slotBad = it.slot && slotVals.indexOf(String(it.slot)) < 0;
      const body = '<div class="mm-form-grid">' +
        field('物品名称 *', input('items.' + i + '.name', it.name, '例如：九转还魂丹')) +
        field('物品 ID *', input('items.' + i + '.id', it.id, '例如：jiuzhuan_dan')) +
        field('类型', select('items.' + i + '.type', it.type, typeOpts.length ? typeOpts : ['consumable', 'weapon', 'armor', 'book', 'material', 'quest'])) +
        field('装备部位', select('items.' + i + '.slot', it.slot, slotOpts, '（非装备可不填）'),
          slotBad ? ('⚠「' + it.slot + '」不是合法部位，会占出一个游戏不认的槽位！请改选：' + slotVals.join('、')) : '') +
        field('品级', select('items.' + i + '.quality', it.quality, QUALITY, '（不填按价格推断）')) +
        field('等级要求', input('items.' + i + '.level', it.level != null ? it.level : 0, '', 'number')) +
        field('价格（文）', input('items.' + i + '.price', it.price != null ? it.price : 10, '', 'number')) +
        field('重量', input('items.' + i + '.weight', it.weight != null ? it.weight : 1, '', 'number')) +
        '</div>' +
        field('物品描述', area('items.' + i + '.desc', it.desc, '描写一下这件东西', 2)) +
        '<div class="mm-sub-title">属性加成（装备生效）</div><div class="mm-form-grid">' +
        field('攻击加成', input('items.' + i + '.atk', it.atk != null ? it.atk : 0, '', 'number')) +
        field('防御加成', input('items.' + i + '.def', it.def != null ? it.def : 0, '', 'number')) +
        field('闪避加成', input('items.' + i + '.dodge', it.dodge != null ? it.dodge : 0, '', 'number')) +
        field('气血加成', input('items.' + i + '.hp', it.hp != null ? it.hp : 0, '', 'number')) +
        field('内力加成', input('items.' + i + '.mp', it.mp != null ? it.mp : 0, '', 'number')) +
        '</div>' +
        '<div class="mm-sub-title">使用效果（consumable / book 用）</div>' +
        field('使用效果', input('items.' + i + '.use', it.use, '例如：+hp:200 或 learn:basic_sword'), '药：+hp:100 / +mp:50；秘籍：learn:武学ID') +
        '<div class="mm-sub-title">其他</div>' +
        check('items.' + i + '.stackable', it.stackable !== false, '可堆叠（同类叠加一格）') +
        check('items.' + i + '.quest', it.quest, '任务物品（不可丢弃/出售）');
      return row(it.name || ('物品 ' + (i + 1)), it.id, i, 'items', body);
    }).join('') || empty('还没有物品');

    h += addBtn('新建物品', 'items') + '</div>';
    return h;
  }

  /* ============================================================
   *  ⑥ 武学
   * ============================================================ */
  function tabSkills() {
    const s = S.spec;
    const st = T.meta ? (T.meta.skillTypes || []) : [];
    /* ⚠️ 兜底必须写**中文槽位名**：武学的 type 就是 `equippedSkills` 的键，
       写英文（sword/force/dodge）会装不进任何槽位，玩家 `enable` 时只会得到
       「没有「sword」这个槽位」。老兜底正是那串英文 —— 官方示例 mod 也照抄了它。 */
    const typeOpts = st.map(t => ({ value: t.value || t, label: t.label || t }));
    const FALLBACK_TYPES = ['拳', '剑', '刀', '棍', '鞭', '暗器', '内功', '轻功', '招架', '身法'];
    /* 下拉最终用哪一份（元数据优先，读不到才用中文兜底） */
    const slotOpts = typeOpts.length ? typeOpts : FALLBACK_TYPES.map(t => ({ value: t, label: t }));
    const slotVals = slotOpts.map(o => String(o.value));
    const catList = (T.meta && T.meta.skillCategories) || ['外功', '内功', '奇门', '旁门', '魔功'];
    const catOpts = catList.map(c => ({ value: c.value || c, label: c.label || c }));
    const effects = (T.meta && T.meta.effectTypes) || [];

    let h = '<div class="mm-section"><h3>武学功法</h3>' +
      '<p class="mm-tip">从基础拳法到绝世神功，全靠这一页。<br>「招式效果」可以让武功带毒、定身、吸血等特殊效果。<br>' +
      '<b>类型</b>必须选槽位名（决定这门武学装在哪、以及内功打坐 / 外功淬体的分路）；' +
      '<b>分类</b>是武学面板里的五大类。</p>';

    h += (s.skills || []).map((sk, i) => {
      const exHtml = (sk.effects || []).map((e, j) => effectRow(i, j, e)).join('');
      /* 类型是槽位键：万一（从别处导入 / 源码视图手改）写成了英文 sword/force，
         下拉里没有这一项 → 这里直接给大白话，别让玩家进游戏才发现装不上。
         元数据正常时下拉只有中文项，用户无从选错，这条只在异常值上出现。 */
      const typeBad = sk.type && slotVals.indexOf(String(sk.type)) < 0;
      const typeHint = typeBad
        ? ('⚠「' + sk.type + '」不是合法槽位名，游戏里会装不上任何槽位！请改选：' + slotVals.join('、'))
        : '必须选中文槽位名（拳/剑/刀…它决定这门武学装在哪）';
      const body = '<div class="mm-form-grid">' +
        field('武学名称 *', input('skills.' + i + '.name', sk.name, '例如：落英神剑掌')) +
        field('武学 ID *', input('skills.' + i + '.id', sk.id, '例如：luoying_zhang')) +
        field('类型', select('skills.' + i + '.type', sk.type, slotOpts), typeHint) +
        field('分类', select('skills.' + i + '.category', sk.category, catOpts)) +
        field('品级', select('skills.' + i + '.quality', sk.quality || 'common', QUALITY), '影响请教价码与强度评定，中文即所选') +
        field('最高等级', input('skills.' + i + '.maxLevel', sk.maxLevel != null ? sk.maxLevel : 300, '', 'number')) +
        field('难度', input('skills.' + i + '.difficulty', sk.difficulty != null ? sk.difficulty : 1, '1~5', 'number')) +
        field('威力倍率', input('skills.' + i + '.damageMult', sk.damageMult != null ? sk.damageMult : 1, '1.0 = 普通', 'number')) +
        field('命中加成', input('skills.' + i + '.accuracy', sk.accuracy != null ? sk.accuracy : 0, '留 0 用默认', 'number')) +
        field('内力消耗', input('skills.' + i + '.mpCost', sk.mpCost != null ? sk.mpCost : 0, '', 'number')) +
        '</div>' +
        field('武学描述', area('skills.' + i + '.desc', sk.desc, '这一招的来历、路数…', 2)) +
        '<div class="mm-sub-title">被动加成（学会后随等级生效，内功常用）</div><div class="mm-form-grid">' +
        field('气血上限', input('skills.' + i + '.bonus.maxHp', getPath(sk, 'bonus.maxHp'), '每 10 级 +N', 'number')) +
        field('内力上限', input('skills.' + i + '.bonus.maxMp', getPath(sk, 'bonus.maxMp'), '每 10 级 +N', 'number')) +
        field('攻击', input('skills.' + i + '.bonus.atk', getPath(sk, 'bonus.atk'), '每 20 级 +N', 'number')) +
        field('防御', input('skills.' + i + '.bonus.def', getPath(sk, 'bonus.def'), '每 20 级 +N', 'number')) +
        field('暴击', input('skills.' + i + '.bonus.critRate', getPath(sk, 'bonus.critRate'), '固定 +N', 'number')) +
        '</div>' +
        field('学习条件', input('skills.' + i + '.require', sk.require, '例如：realm>=2 或 悟性>=20'), '不填则无门槛（realm=境界：0不通武艺~5登峰造极）') +
        '<div class="mm-sub-title">招式效果（战斗中触发）</div>' +
        '<div class="mm-effects" data-skidx="' + i + '">' + (exHtml || '<div class="mm-empty-sm">暂无效果</div>') + '</div>' +
        '<button class="mm-add sm" data-add-effect="' + i + '">＋ 添加效果</button>' +
        '<div class="mm-effect-lib"><span class="mm-row-sub">可用效果类型：</span>' +
        effects.map(e => '<span class="mini-tag static">' + esc(e.label || e.value || e) + '</span>').join('') + '</div>';
      return row(sk.name || ('武学 ' + (i + 1)), sk.id, i, 'skills', body);
    }).join('') || empty('还没有武学');

    h += addBtn('新建武学', 'skills') + '</div>';
    return h;
  }

  function effectRow(skIdx, eIdx, e) {
    const types = ['dot', 'stun', 'slow', 'buff', 'debuff', 'drain', 'ignoreDef', 'heal', 'extraHit'];
    const typeCN = {
      dot: '持续伤害(毒/灼)', stun: '定身(眩晕)', slow: '迟缓', buff: '增益自身',
      debuff: '削弱敌人', drain: '吸血吸内', ignoreDef: '无视防御', heal: '治疗', extraHit: '连击'
    };
    return '<div class="mm-effect" data-eff="' + skIdx + '|' + eIdx + '">' +
      '<span class="mm-eff-t">' + esc(typeCN[e.type] || e.type || '效果') + '</span>' +
      '<select class="mm-input mm-eff-type" data-eff-type="' + skIdx + '|' + eIdx + '">' +
      types.map(t => '<option value="' + t + '"' + (e.type === t ? ' selected' : '') + '>' + esc(typeCN[t]) + '</option>').join('') + '</select>' +
      '<input class="mm-input mm-eff-name" data-eff-name="' + skIdx + '|' + eIdx + '" value="' + esc(e.name || '') + '" placeholder="效果名 如：中毒">' +
      '<input class="mm-input mm-eff-num" data-eff-val="' + skIdx + '|' + eIdx + '" value="' + esc(e.value != null ? e.value : '') + '" placeholder="数值">' +
      '<input class="mm-input mm-eff-num" data-eff-turn="' + skIdx + '|' + eIdx + '" value="' + esc(e.turns != null ? e.turns : '') + '" placeholder="回合">' +
      '<input class="mm-input mm-eff-num" data-eff-chance="' + skIdx + '|' + eIdx + '" value="' + esc(e.chance != null ? e.chance : '') + '" placeholder="概率0~1">' +
      '<button class="mini-btn danger" data-del-effect="' + skIdx + '|' + eIdx + '">✕</button>' +
      '</div>';
  }

  /* ============================================================
   *  ⑦ 门派
   * ============================================================ */
  function tabSects() {
    const s = S.spec;
    const regions = T.meta ? (T.meta.regions || []) : [];
    let h = '<div class="mm-section"><h3>门派</h3>' +
      '<p class="mm-tip">自创门派，给它配上武学传承和门派职位。</p>';

    h += (s.sects || []).map((sc, i) => {
      const body = '<div class="mm-form-grid">' +
        field('门派名称 *', input('sects.' + i + '.name', sc.name, '例如：天机阁')) +
        field('门派 ID *', input('sects.' + i + '.id', sc.id, '例如：tianji_ge')) +
        field('所在区域', select('sects.' + i + '.region', sc.region, regions.map(x => ({ value: x.id, label: x.name })), '（可选）')) +
        field('阵营', select('sects.' + i + '.align', sc.align || '正', [{ value: '正', label: '正派' }, { value: '邪', label: '邪派' }, { value: '中', label: '中立' }])) +
        field('加入条件', input('sects.' + i + '.require', sc.require, '例如：realm>=1')) +
        '</div>' +
        field('门派描述', area('sects.' + i + '.desc', sc.desc, '这个门派什么来头？', 2)) +
        '<div class="mm-sub-title">门派武学（逗号分隔 ID）</div>' +
        input('sects.' + i + '.skills', (Array.isArray(sc.skills) ? sc.skills.join(',') : (sc.skills || '')), '例如：luoying_zhang,basic_sword') +
        '<div class="mm-sub-title">职位（逗号分隔，从低到高）</div>' +
        input('sects.' + i + '.ranks', (Array.isArray(sc.ranks) ? sc.ranks.join(',') : (sc.ranks || '')), '例如：弟子,执事,长老,掌门');
      return row(sc.name || ('门派 ' + (i + 1)), sc.id, i, 'sects', body);
    }).join('') || empty('还没有门派');

    h += addBtn('新建门派', 'sects') + '</div>';
    return h;
  }

  /* ============================================================
   *  ⑧ 剧情任务
   * ============================================================ */
  function tabStories() {
    const s = S.spec;
    const npcs = (T.meta && T.meta.npcs) || [];
    const items = (T.meta && T.meta.items) || [];
    const rooms = (T.meta && T.meta.rooms) || [];

    let h = '<div class="mm-section"><h3>剧情任务</h3>' +
      '<p class="mm-tip">这是 Mod 的灵魂！一个任务由若干「阶段」组成，玩家完成一个阶段自动进入下一个，最后发奖励。<br>' +
      '<b>阶段目标类型：</b>对话(flag) / 收集物品(item) / 击杀(kill) / 到达地点(room) / 变量(var)</p>';

    h += (s.quests || []).map((q, i) => {
      const stagesHtml = (q.stages || []).map((st, j) => stageRow(i, j, st, npcs, items, rooms)).join('');
      const body = '<div class="mm-form-grid">' +
        field('任务名称 *', input('quests.' + i + '.name', q.name, '例如：失踪的镖师')) +
        field('任务 ID *', input('quests.' + i + '.id', q.id, '例如：q_missing_escort')) +
        field('发布人（NPC ID）', input('quests.' + i + '.giver', q.giver, '留空表示自动触发')) +
        field('等级要求', input('quests.' + i + '.level', q.level != null ? q.level : 0, '', 'number')) +
        field('任务类型', select('quests.' + i + '.type', q.type || '支线', ['主线', '支线', '日常', '奇遇'])) +
        '</div>' +
        field('任务描述', area('quests.' + i + '.desc', q.desc, '讲讲这个任务的来龙去脉…', 3)) +
        '<div class="mm-sub-title">奖励</div><div class="mm-form-grid">' +
        field('经验', input('quests.' + i + '.rewards.exp', (q.rewards && q.rewards.exp) || 0, '', 'number')) +
        field('潜能', input('quests.' + i + '.rewards.pot', (q.rewards && q.rewards.pot) || 0, '', 'number')) +
        field('银两', input('quests.' + i + '.rewards.money', (q.rewards && q.rewards.money) || 0, '', 'number')) +
        field('奖励物品（逗号分隔）', input('quests.' + i + '.rewardsItems', (q.rewards && q.rewards.items || []).join ? (q.rewards.items || []).join(',') : '', '例如：jiuzhuan_dan')) +
        '</div>' +
        '<div class="mm-sub-title">任务阶段</div><div class="mm-stages" data-qidx="' + i + '">' +
        (stagesHtml || '<div class="mm-empty-sm">还没有阶段，至少加一个</div>') + '</div>' +
        '<button class="mm-add sm" data-add-stage="' + i + '">＋ 添加阶段</button>';
      return row(q.name || ('任务 ' + (i + 1)), q.id, i, 'quests', body);
    }).join('') || empty('还没有任务');

    h += addBtn('新建任务', 'quests') + '</div>';
    return h;
  }

  function stageRow(qIdx, sIdx, st, npcs, items, rooms) {
    const kinds = [
      { value: 'flag', label: '对话/标记 (flag)' },
      { value: 'item', label: '收集物品 (item)' },
      { value: 'kill', label: '击杀目标 (kill)' },
      { value: 'room', label: '到达地点 (room)' },
      { value: 'var', label: '变量达成 (var)' }
    ];
    return '<div class="mm-stage" data-stage="' + qIdx + '|' + sIdx + '">' +
      '<div class="mm-stage-head"><span class="mm-stage-no">第 ' + (sIdx + 1) + ' 阶段</span>' +
      '<button class="mini-btn danger" data-del-stage="' + qIdx + '|' + sIdx + '">✕</button></div>' +
      field('阶段说明', input('quests.' + qIdx + '.stages.' + sIdx + '.desc', st.desc, '例如：去江南客栈找小二打听消息')) +
      '<div class="mm-form-grid">' +
      field('达成类型', select('quests.' + qIdx + '.stages.' + sIdx + '.kind', st.kind || 'flag', kinds)) +
      field('目标关键词', input('quests.' + qIdx + '.stages.' + sIdx + '.key', st.key, 'flag:标记名 / item:物品ID / kill:NPC ID / room:房间ID')) +
      field('需要数量', input('quests.' + qIdx + '.stages.' + sIdx + '.count', st.count != null ? st.count : 1, '', 'number')) +
      '</div>' +
      field('完成时效果', input('quests.' + qIdx + '.stages.' + sIdx + '.onDone', st.onDone, '例如：say:小二告诉你镖师往东边去了'), '可为空') +
      '</div>';
  }

  /* ============================================================
   *  ⑨ 对话树
   * ============================================================ */
  function tabDialogue() {
    const s = S.spec;
    const npcs = (T.meta && T.meta.npcs) || [];
    let h = '<div class="mm-section"><h3>对话树</h3>' +
      '<p class="mm-tip">给人物做一段「有选项的对话」。玩家点选项，剧情往下走，还能给东西、接任务、开战。</p>';

    h += (s.dialogues || []).map((d, i) => {
      const nodesHtml = (d.nodes || []).map((n, j) => dialogueNode(i, j, n)).join('');
      const body = '<div class="mm-form-grid">' +
        field('对话名称 *', input('dialogues.' + i + '.name', d.name, '例如：老侠客的往事')) +
        field('对话 ID *', input('dialogues.' + i + '.id', d.id, '例如：dlg_old_hero')) +
        field('绑定人物（NPC ID）', input('dialogues.' + i + '.npc', d.npc, '留空则任意人可触发')) +
        field('起始节点 ID', input('dialogues.' + i + '.start', d.start, '例如：n1')) +
        '</div>' +
        field('触发条件', input('dialogues.' + i + '.cond', d.cond, '例如：realm>=2，留空=总是')) +
        '<div class="mm-sub-title">对话节点</div><div class="mm-nodes">' + (nodesHtml || '<div class="mm-empty-sm">还没有节点</div>') + '</div>' +
        '<button class="mm-add sm" data-add-node="' + i + '">＋ 添加节点</button>';
      return row(d.name || ('对话 ' + (i + 1)), d.id, i, 'dialogues', body);
    }).join('') || empty('还没有对话');

    h += addBtn('新建对话', 'dialogues') + '</div>';
    return h;
  }

  function dialogueNode(dIdx, nIdx, n) {
    return '<div class="mm-node" data-node="' + dIdx + '|' + nIdx + '">' +
      '<div class="mm-node-head"><span class="mm-stage-no">节点 ' + (nIdx + 1) + (n.id ? '（' + esc(n.id) + '）' : '') + '</span>' +
      '<button class="mini-btn danger" data-del-node="' + dIdx + '|' + nIdx + '">✕</button></div>' +
      '<div class="mm-form-grid">' +
      field('节点 ID', input('dialogues.' + dIdx + '.nodes.' + nIdx + '.id', n.id, '例如：n1')) +
      field('说话人', input('dialogues.' + dIdx + '.nodes.' + nIdx + '.who', n.who, '留空=对方')) +
      '</div>' +
      field('台词', area('dialogues.' + dIdx + '.nodes.' + nIdx + '.text', n.text, '他/她说的话…', 2)) +
      '<div class="mm-sub-title">选项（每行一个，格式：选项文字 -> 下一节点ID 或 效果）</div>' +
      area('dialogues.' + dIdx + '.nodes.' + nIdx + '.options', (n.options || []).map(o =>
        typeof o === 'string' ? o : ((o.label || o.text || '') + ' -> ' + (o.next || o.effect || ''))).join('\n'),
        '例如：\n我愿闻其详 -> n2\n此事与我无关 -> n3\n（开战） -> kill', 3);
    return '</div>';
  }

  /* ============================================================
   *  ⑩ 功能 Mod
   * ============================================================ */
  function tabFunctions() {
    const s = S.spec;
    let h = '<div class="mm-section"><h3>功能 Mod（进阶）</h3>' +
      '<p class="mm-tip">不改内容，改<b>规则</b>。比如调整经验倍率、自动拾取、修改战斗公式、加全局事件。<br>' +
      '这些不需要写代码，用「规则」描述即可。</p>';

    h += '<div class="mm-rules">';
    h += (s.rules || []).map((r, i) => {
      const body = '<div class="mm-form-grid">' +
        field('规则名称', input('rules.' + i + '.name', r.name, '例如：双倍经验')) +
        field('规则类型', select('rules.' + i + '.kind', r.kind || 'multiply',
          [{ value: 'multiply', label: '倍数调整（经验/金钱等）' },
          { value: 'additive', label: '数值增减' },
          { value: 'onEvent', label: '事件触发效果' },
          { value: 'macro', label: '宏指令（一条指令=多条）' }])) +
        '</div>' +
        '<div class="mm-form-grid">' +
        field('作用目标', input('rules.' + i + '.target', r.target, 'pot / money / hp / damage / 或事件名 onKill'), '倍率类填字段名') +
        field('数值', input('rules.' + i + '.value', r.value != null ? r.value : '', '例如：2 表示两倍', 'text')) +
        '</div>' +
        field('条件', input('rules.' + i + '.cond', r.cond, '留空=总是生效；如 realm>=1')) +
        field('效果 / 触发', input('rules.' + i + '.effect', r.effect, 'onEvent 时填效果，如 +money:10'));
      return row(r.name || ('规则 ' + (i + 1)), r.kind, i, 'rules', body);
    }).join('') || empty('还没有规则');
    h += '</div>';

    h += addBtn('新建规则', 'rules') + '</div>';

    /* 常用功能预设 */
    h += '<div class="mm-section"><h3>常用预设（点一下就加）</h3><div class="mm-presets">' +
      '<button class="mm-add sm" data-preset="exp2">双倍潜能</button>' +
      '<button class="mm-add sm" data-preset="money2">双倍金钱</button>' +
      '<button class="mm-add sm" data-preset="autopick">自动拾取</button>' +
      '<button class="mm-add sm" data-preset="hpRegen">脱战回血</button>' +
      '<button class="mm-add sm" data-preset="killReward">击杀额外奖励</button>' +
      '</div></div>';
    return h;
  }

  /* ============================================================
   *  📖 小白教程
   * ============================================================ */
  function tabTutorial() {
    if (global.WXDOC && global.WXDOC.makerTutorial) {
      return '<div class="mm-section mm-doc">' + global.WXDOC.makerTutorial() + '</div>';
    }
    return '<div class="mm-section"><h3>教程加载中…</h3></div>';
  }

  /* ============================================================
   *  ⚙ 源码视图
   * ============================================================ */
  function tabJson() {
    const json = specToJson();
    return '<div class="mm-section"><h3>源码视图</h3>' +
      '<p class="mm-tip">这是你当前编辑的内容编译出的 <code>mod.json</code>。熟悉之后可以直接在这里改，点「从源码导入」把改动吃回表单。</p>' +
      '<div class="mm-json-ops"><button class="btn-ink small" id="json-import">从源码导入到表单</button>' +
      '<button class="btn-ink small" id="json-copy">复制</button>' +
      '<button class="btn-ink small" id="json-download">下载 mod.json</button></div>' +
      '<textarea id="mm-json" class="mm-json" spellcheck="false">' + esc(json) + '</textarea>' +
      '</div>';
  }

  /* ============================================================
   *  ✔ 检查报告
   * ============================================================ */
  let lastReport = null;
  /* ============================================================
   *  本站账号（主人 2026-10-11）
   *    ·「一键上传到 Mod 网站」**必须登录**才能用
   *    · 左侧加「我制作的 Mod」：把已经发出去的那件载回表单，改完再传就是更新
   *
   *  ⚠️ 以前「身份」只是个昵称（`S.my = {name}`），谁都能冒名发。现在换成
   *     账号 + token：token 存进 `S.my`（localStorage），上传时带给服务端，
   *     服务端拿它认人、并把署名**写死成账号名**（前端传 author 不作数）。
   * ============================================================ */
  function isLoggedIn() { return !!(S.my && S.my.token && S.my.name); }

  /** 头部那个按钮上写什么：没登录写「登录」，登录了写昵称 */
  function refreshMeStrip() {
    const b = $('mm-account');
    if (!b) return;
    b.textContent = isLoggedIn() ? ('👤 ' + S.my.name) : '登 录';
    b.classList.toggle('primary', !isLoggedIn());
  }

  /** 弹「登录 / 注册」框；resolve(true) 表示拿到 token 了 */
  function askLogin() {
    return new Promise(resolve => {
      const body =
        '<div class="up-box">' +
        '<div class="up-tip">要往 Mod 网站发布作品，先得有个账号 —— 别人这才认得出作者是谁，' +
        '你自己也能在「我制作的 Mod」里找回发过的东西接着改。</div>' +
        '<div class="set-row"><label>昵称</label><input class="modal-input" id="acc-name" maxlength="16" placeholder="2~16 个字"></div>' +
        '<div class="set-row"><label>口令</label><input class="modal-input" type="password" id="acc-pass" maxlength="32" placeholder="至少 6 位"></div>' +
        '<div class="up-tip" id="acc-msg">第一次来？填好点「注册」；已经有账号就点「登录」。</div>' +
        '</div>';
      U.modal('登录 / 注册 Mod 社区', body,
        '<button class="btn-ink" id="acc-cancel">取 消</button>' +
        '<button class="btn-ink" id="acc-reg">注 册</button>' +
        '<button class="btn-ink primary" id="acc-login">登 录</button>');

      let settled = false;
      const fin = v => { if (!settled) { settled = true; resolve(v); } };
      const msg = t => { const m = $('acc-msg'); if (m) m.textContent = t; };
      const vals = () => ({
        name: (($('acc-name') || {}).value || '').trim(),
        pass: (($('acc-pass') || {}).value || '')
      });

      const submit = async (action) => {
        const v = vals();
        if (!v.name || !v.pass) { msg('昵称和口令都要填。'); return; }
        msg(action === 'login' ? '正在登录…' : '正在注册…');
        try {
          const d = await api.account(action, v);
          if (!d || !d.ok) { msg((d && d.error) || '没成，再试一次。'); return; }
          /* token 落进 S.my（localStorage）—— 之后上传与「我的作品」都靠它 */
          global.WX.setMe(Object.assign({}, S.my || {}, { name: d.name, token: d.token }));
          U.closeModal();
          U.toast((action === 'login' ? '登录成功：' : '注册成功：') + d.name, 'ok');
          refreshMeStrip();
          fin(true);
        } catch (e) { msg('连不上 Mod 网站：' + e.message); }
      };
      const cancel = $('acc-cancel'); if (cancel) cancel.onclick = () => { U.closeModal(); fin(false); };
      const lg = $('acc-login'); if (lg) lg.onclick = () => submit('login');
      const rg = $('acc-reg'); if (rg) rg.onclick = () => submit('register');
    });
  }

  /** 没登录就弹框；返回 true 表示「可以往下走」 */
  async function ensureLogin() {
    if (isLoggedIn()) return true;
    return await askLogin();
  }

  /* ============================================================
   *  游戏内 ID 一览 + 按 ID 改（主人 2026-10-11）
   *    「在 mod 制作器里添加游戏内各事物 id 列表……同时添加可通过 id 更改
   *      游戏内剧情、人物、物品、功法、区域等有 id 的事物」
   *
   *  做法：列出游戏里**当前**的各类事物（id + 名字 + 一条摘要），点「改这个」
   *  就把那一件的**完整内容**载进表单 —— 生成一份**同 ID 的覆盖 Mod**。
   *  Mod 加载本来就是「同 id 覆盖」，所以这就是「按 ID 改游戏内事物」。
   * ============================================================ */
  const ID_KINDS = [
    { key: 'npcs', label: '人物', tab: 'npcs' },
    { key: 'items', label: '物品', tab: 'items' },
    { key: 'skills', label: '武学', tab: 'skills' },
    { key: 'rooms', label: '房间', tab: 'rooms' },
    { key: 'regions', label: '区域', tab: 'regions' },
    { key: 'quests', label: '剧情', tab: 'stories' },
    { key: 'sects', label: '门派', tab: 'sects' },
    /* 2026-10-11 扩容：库里早就有这几类了，前端一直没有入口 ——
       作者想引用一个世界事件的 id、想把某个结局改两个字，都无从下手。 */
    { key: 'endings', label: '结局', tab: 'stories' },
    { key: 'traits', label: '天赋', tab: 'stories' },
    { key: 'worldEvents', label: '世界事件', tab: 'stories', readonly: true }
  ];
  function idKindMeta(k) {
    for (const x of ID_KINDS) if (x.key === k) return x;
    return ID_KINDS[0];
  }

  function tabIds() {
    const k = T.idKind || 'npcs';
    return '<div class="mm-idsub">' + ID_KINDS.map(x =>
      '<button class="mm-idk' + (x.key === k ? ' active' : '') + '" data-idkind="' + x.key + '">' + x.label + '</button>'
    ).join('') + '</div>' +
      '<div class="mm-idsearch">' +
      '<input class="mm-input" id="mm-idq" placeholder="按 ID 或名字过滤（例如 master_yue / 岳不群）">' +
      '</div>' +
      '<div class="mm-idtip">点一行右边的「改这个」，就把它在游戏里**现在的样子**载进表单；' +
      '改完「保存到本地」或「一键上传」，游戏内重载这个 Mod 就生效（同 ID 覆盖）。</div>' +
      '<div id="mm-idlist"><div class="mm-empty">正在读取…</div></div>';
  }

  function wireIds() {
    const box = $('mm-content');
    box.querySelectorAll('[data-idkind]').forEach(b => {
      b.onclick = () => {
        const k = b.getAttribute('data-idkind');
        if (k === (T.idKind || 'npcs')) return;
        T.idKind = k;
        T.idQuery = '';
        paintTab('ids');
      };
    });
    const qi = $('mm-idq');
    if (qi) {
      qi.value = T.idQuery || '';
      qi.oninput = util.debounce(() => { T.idQuery = qi.value.trim(); loadIds(); }, 300);
    }
    loadIds();
  }

  async function loadIds() {
    const list = $('mm-idlist');
    if (!list) return;
    const kind = T.idKind || 'npcs';
    list.innerHTML = '<div class="mm-empty">正在读取…</div>';
    const d = await api.gamedata(kind, { q: T.idQuery || '', limit: 600 });
    if (!d || !d.ok) {
      list.innerHTML = '<div class="mm-empty">' + esc((d && d.error) || '读不到游戏数据') + '</div>';
      return;
    }
    if (!d.rows || !d.rows.length) {
      list.innerHTML = '<div class="mm-empty">没有符合条件的条目。</div>';
      return;
    }
    list.innerHTML =
      '<div class="mm-idcount">共 ' + d.total + ' 条' +
      (d.shown < d.total ? '，先显示前 ' + d.shown + ' 条（用上面的框缩小范围）' : '') + '</div>' +
      '<div class="mm-idrows">' + d.rows.map(r =>
        '<div class="mm-idrow">' +
        '<div class="mm-idname"><b>' + esc(r.name || r.id) + '</b>' +
        (r.sub ? '<span class="dim"> ' + esc(r.sub) + '</span>' : '') + '</div>' +
        '<code class="mm-idcode">' + esc(r.id) + '</code>' +
        '<button class="btn-ink small" data-pick="' + esc(r.id) + '">改这个</button>' +
        '</div>').join('') + '</div>';
    list.querySelectorAll('[data-pick]').forEach(b => {
      b.onclick = () => pickGameId(kind, b.getAttribute('data-pick'));
    });
  }

  /** 把游戏里这一件现在的完整内容载进表单（同 ID → 上传即覆盖它） */
  async function pickGameId(kind, id) {
    U.toast('正在取「' + id + '」…', 'info', 1200);
    try {
      const d = await api.gamedata(kind, { id });
      if (!d || !d.ok) { U.toast((d && d.error) || '取不到', 'error'); return; }
      /* ⚠️ 只读类别（世界事件）在这里就停下：
         世界事件挂在 `worldEvents.onDayTick` 这个**数组**上，而引擎对数组是「整段替换」——
         载入单条再上传，会把其余六十多条一起顶掉（这是个静默的大事故）。
         所以只把 id 与内容摆给你看，供写 mod 时引用。 */
      if (d.readonly) {
        const it = d.item || {};
        U.toast('「' + id + '」（' + (it.name || it.cat || '') + '）是只读的：' +
          '世界事件按整组替换，改单条会把其余的全顶掉。id 可以直接抄进 mod 的 cond 里用。', 'info', 6500);
        return;
      }
      const item = JSON.parse(JSON.stringify(d.item || {}));
      const meta = idKindMeta(kind);
      /* spec 里各类的键名与 kind 同名（npcs / items / skills / rooms / regions / quests / sects） */
      const arr = kind;
      if (!Array.isArray(S.spec[arr])) S.spec[arr] = [];
      /* ⚠️ **同 id 只留一份**：数组在引擎里是「后写覆盖先写」，同一 id 出现两次
         会让「我改的到底是哪一份」变得不可预测。 */
      const i = S.spec[arr].findIndex(x => x && x.id === id);
      if (i >= 0) S.spec[arr][i] = item; else S.spec[arr].push(item);
      mark();
      U.toast('已把「' + (item.name || id) + '」载入表单 —— 改完上传/保存即覆盖游戏里的它', 'ok', 3600);
      tab(meta.tab);
    } catch (e) { U.toast('取不到：' + e.message, 'error'); }
  }

  function tabMine() {
    if (!isLoggedIn()) {
      return '<div class="mm-empty">还没登录。<br><br>' +
        '发布到 Mod 网站、以及查看你自己发过的作品，都要先登录。<br><br>' +
        '<button class="btn-ink primary" id="mm-mine-login">登 录 / 注 册</button></div>';
    }
    return '<div class="mm-mine-head"><b>我制作的 Mod</b>' +
      '<span class="mm-hint">共 <span id="mm-mine-count">…</span> 件 · 点「载入编辑」把它读回表单，改完再上传就是更新那一件</span></div>' +
      '<div id="mm-mine-list"><div class="mm-empty">正在拉取你的作品…</div></div>';
  }

  async function wireMine() {
    const btn = $('mm-mine-login');
    if (btn) btn.onclick = async () => { if (await askLogin()) paintTab('mine'); };
    const box = $('mm-mine-list');
    if (!box) return;

    let d = null;
    try { d = await api.accountMine(); }
    catch (e) { box.innerHTML = '<div class="mm-empty">连不上 Mod 网站：' + esc(e.message) + '</div>'; return; }

    if (!d || !d.ok) {
      if (d && d.needLogin) {
        /* token 过期或被清了 —— 别把它当成「拉取失败」，直接退回未登录态重画 */
        global.WX.setMe(Object.assign({}, S.my || {}, { token: '' }));
        refreshMeStrip();
        paintTab('mine');
        return;
      }
      box.innerHTML = '<div class="mm-empty">' + esc((d && d.error) || '拉取失败') + '</div>';
      return;
    }

    const cnt = $('mm-mine-count');
    if (cnt) cnt.textContent = d.mods.length;
    if (!d.mods.length) {
      box.innerHTML = '<div class="mm-empty">你还没有发布过 Mod。<br>' +
        '在「① 基本信息」填好名字和 ID，再点右上角「一键上传到 Mod 网站」。</div>';
      return;
    }

    box.innerHTML = d.mods.map(m =>
      '<div class="mm-mine-row">' +
      '<div class="mm-mine-main"><b>' + esc(m.name) + '</b>' +
      '<span class="dim"> v' + esc(m.version) + ' · ' + esc(m.category) + '</span></div>' +
      '<div class="mm-mine-sub">' + esc(m.desc || '（没有写简介）') + '</div>' +
      '<div class="mm-mine-meta"><code>' + esc(m.id) + '</code>' +
      (m.timeText ? ' · ' + esc(m.timeText) : '') + ' · 下载 ' + (m.downloads || 0) + '</div>' +
      '<div class="mm-mine-ops">' +
      '<button class="btn-ink small" data-load="' + esc(m.id) + '">载入编辑</button>' +
      '<button class="btn-ink small" data-open="' + esc(m.id) + '">看网页</button>' +
      '</div></div>').join('');

    box.querySelectorAll('[data-load]').forEach(b => {
      b.onclick = () => loadMine(b.getAttribute('data-load'));
    });
    box.querySelectorAll('[data-open]').forEach(b => {
      b.onclick = () => {
        const cfg = S.siteConfig || {};
        const base = String(cfg.siteUrl || cfg.apiBase || 'http://127.0.0.1:8788').replace(/\/api\/?$/, '').replace(/\/+$/, '');
        window.open(base + '/mod.html?id=' + encodeURIComponent(b.getAttribute('data-open')), '_blank');
      };
    });
  }

  /** 把我发布过的 Mod 载回表单（改完上传 = 更新那一件） */
  async function loadMine(id) {
    U.toast('正在取回「' + id + '」…', 'info', 1200);
    try {
      const d = await api.siteRemote({ action: 'detail', id });
      if (!d || !d.ok) { U.toast((d && d.error) || '取不回来', 'error'); return; }
      const m = d.mod || {};
      /* ⚠️ 站点存的是**发布当时的 mod.json**（id/name 在顶层）。
         必须走 `jsonToSpec` 归一化 —— 直接把整条站点记录塞进表单会把
         owner / timeText / downloads 这些**站点侧字段**一起带进来，
         再上传就会把它们当成 mod 内容发出去。 */
      S.spec = jsonToSpec(m.json || m);
      T.dirty = false;
      U.toast('已载入「' + (S.spec.name || id) + '」，改完点上传就是更新', 'ok', 3000);
      tab('basic');
    } catch (e) { U.toast('取回失败：' + e.message, 'error'); }
  }

  function tabReport() {
    if (!lastReport) {
      return '<div class="mm-section"><h3>检查报告</h3>' +
        '<p class="mm-tip">点右上角「检 查」按钮，我会帮你把 Mod 从头到尾体检一遍，揪出所有问题。</p>' +
        '<div class="mm-empty">还没有检查过</div></div>';
    }
    const r = lastReport;
    let h = '<div class="mm-section"><h3>检查报告</h3>';
    if (r.errors && r.errors.length) {
      h += '<div class="mm-report-block"><div class="mm-report-title err">✘ 错误（' + r.errors.length + '）——必须修好</div><ul>';
      r.errors.forEach(e => h += '<li class="err">' + esc(e) + '</li>');
      h += '</ul></div>';
    }
    if (r.warnings && r.warnings.length) {
      h += '<div class="mm-report-block"><div class="mm-report-title warn">⚠ 警告（' + r.warnings.length + '）——建议处理</div><ul>';
      r.warnings.forEach(e => h += '<li class="warn">' + esc(e) + '</li>');
      h += '</ul></div>';
    }
    if (r.infos && r.infos.length) {
      h += '<div class="mm-report-block"><div class="mm-report-title info">ℹ 提示（' + r.infos.length + '）</div><ul>';
      r.infos.forEach(e => { h += '<li class="info">' + esc(e) + '</li>'; });
      h += '</ul></div>';
    }
    if (!(r.errors || []).length && !(r.warnings || []).length) {
      h += '<div class="mm-report-ok">✔ 太棒了，没有发现问题，可以保存/上传了！</div>';
    }
    h += '<div class="mm-report-sum">' + esc(r.summary || '') + '</div></div>';
    return h;
  }

  /* ============================================================
   *  表单 <-> 数据 绑定
   * ============================================================ */
  function setPath(obj, path, val) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (cur[k] == null) cur[k] = (/^\d+$/.test(parts[i + 1])) ? [] : {};
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = val;
  }

  function getPath(obj, path) {
    const parts = path.split('.');
    let cur = obj;
    for (const k of parts) {
      if (cur == null) return undefined;
      cur = cur[k];
    }
    return cur;
  }

  function wireTab(name) {
    const box = $('mm-content');
    /* 「我制作的 Mod」「游戏内 ID」都是异步拉取后自渲染的，不走下面那套表单绑定 */
    if (name === 'mine') { wireMine(); return; }
    if (name === 'ids') { wireIds(); return; }

    /* 通用输入绑定 */
    box.querySelectorAll('[data-bind]').forEach(el => {
      const path = el.getAttribute('data-bind');
      const handler = () => {
        mark();
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if (el.type === 'number') v = v === '' ? 0 : Number(v);
        if (path === '__tags') {
          S.spec.tags = String(v).split(/\s+/).filter(Boolean);
        } else {
          setPath(S.spec, path, v);
        }
      };
      el.addEventListener('change', handler);
      el.addEventListener('input', name === 'json' ? null : util.debounce(handler, 260));
    });

    /* 出口 */
    box.querySelectorAll('[data-exit]').forEach(el => {
      el.addEventListener('change', () => {
        mark();
        const [ri, dir] = el.getAttribute('data-exit').split('|');
        const i = +ri;
        if (!S.spec.rooms[i]) return;
        if (!S.spec.rooms[i].exits) S.spec.rooms[i].exits = {};
        const v = el.value.trim();
        if (v) S.spec.rooms[i].exits[dir] = v;
        else delete S.spec.rooms[i].exits[dir];
      });
    });

    /* 增删行 */
    box.querySelectorAll('[data-add]').forEach(b => {
      b.onclick = () => {
        mark();
        const key = b.getAttribute('data-add');
        if (!S.spec[key]) S.spec[key] = [];
        S.spec[key].push(newRowDefaults(key));
        paintTab(name);
      };
    });

    /* 行操作 */
    box.querySelectorAll('[data-row-del]').forEach(b => {
      b.onclick = () => {
        mark();
        const r = b.closest('.mm-row');
        const arr = r.getAttribute('data-row'), i = +r.getAttribute('data-idx');
        S.spec[arr].splice(i, 1);
        paintTab(name);
      };
    });
    box.querySelectorAll('[data-row-up]').forEach(b => {
      b.onclick = () => {
        mark();
        const r = b.closest('.mm-row');
        const arr = r.getAttribute('data-row'), i = +r.getAttribute('data-idx');
        if (i <= 0) return;
        const a = S.spec[arr];
        [a[i - 1], a[i]] = [a[i], a[i - 1]];
        paintTab(name);
      };
    });
    box.querySelectorAll('[data-row-down]').forEach(b => {
      b.onclick = () => {
        mark();
        const r = b.closest('.mm-row');
        const arr = r.getAttribute('data-row'), i = +r.getAttribute('data-idx');
        const a = S.spec[arr];
        if (i >= a.length - 1) return;
        [a[i + 1], a[i]] = [a[i], a[i + 1]];
        paintTab(name);
      };
    });

    /* 武学效果 */
    box.querySelectorAll('[data-add-effect]').forEach(b => {
      b.onclick = () => {
        mark();
        const i = +b.getAttribute('data-add-effect');
        if (!S.spec.skills[i].effects) S.spec.skills[i].effects = [];
        S.spec.skills[i].effects.push({ type: 'dot', name: '中毒', value: 10, turns: 3, chance: 1 });
        paintTab(name);
      };
    });
    box.querySelectorAll('[data-del-effect]').forEach(b => {
      b.onclick = () => {
        mark();
        const [si, ei] = b.getAttribute('data-del-effect').split('|').map(Number);
        S.spec.skills[si].effects.splice(ei, 1);
        paintTab(name);
      };
    });
    box.querySelectorAll('.mm-effect').forEach(el => {
      const [si, ei] = el.getAttribute('data-eff').split('|').map(Number);
      const bind = (sel, key, num) => {
        const inp = el.querySelector(sel);
        if (!inp) return;
        const h = () => {
          mark();
          let v = inp.value;
          if (num) v = v === '' ? undefined : Number(v);
          S.spec.skills[si].effects[ei][key] = v;
        };
        inp.addEventListener('change', h);
        inp.addEventListener('input', util.debounce(h, 240));
      };
      bind('[data-eff-type]', 'type');
      bind('[data-eff-name]', 'name');
      bind('[data-eff-val]', 'value', true);
      bind('[data-eff-turn]', 'turns', true);
      bind('[data-eff-chance]', 'chance', true);
    });

    /* 任务阶段 */
    box.querySelectorAll('[data-add-stage]').forEach(b => {
      b.onclick = () => {
        mark();
        const i = +b.getAttribute('data-add-stage');
        if (!S.spec.quests[i].stages) S.spec.quests[i].stages = [];
        S.spec.quests[i].stages.push({ desc: '新阶段', kind: 'flag', key: '', count: 1 });
        paintTab(name);
      };
    });
    box.querySelectorAll('[data-del-stage]').forEach(b => {
      b.onclick = () => {
        mark();
        const [qi, si] = b.getAttribute('data-del-stage').split('|').map(Number);
        S.spec.quests[qi].stages.splice(si, 1);
        paintTab(name);
      };
    });

    /* 对话节点 */
    box.querySelectorAll('[data-add-node]').forEach(b => {
      b.onclick = () => {
        mark();
        const i = +b.getAttribute('data-add-node');
        if (!S.spec.dialogues[i].nodes) S.spec.dialogues[i].nodes = [];
        const n = S.spec.dialogues[i].nodes.length + 1;
        S.spec.dialogues[i].nodes.push({ id: 'n' + n, who: '', text: '', options: [] });
        if (!S.spec.dialogues[i].start) S.spec.dialogues[i].start = 'n1';
        paintTab(name);
      };
    });
    box.querySelectorAll('[data-del-node]').forEach(b => {
      b.onclick = () => {
        mark();
        const [di, ni] = b.getAttribute('data-del-node').split('|').map(Number);
        S.spec.dialogues[di].nodes.splice(ni, 1);
        paintTab(name);
      };
    });

    /* 功能预设 */
    box.querySelectorAll('[data-preset]').forEach(b => {
      b.onclick = () => { mark(); applyPreset(b.getAttribute('data-preset')); paintTab(name); };
    });

    /* JSON 视图按钮 */
    const jimp = $('json-import');
    if (jimp) jimp.onclick = () => {
      try {
        const obj = JSON.parse($('mm-json').value);
        S.spec = jsonToSpec(obj);
        mark();
        U.toast('已从源码导入', 'ok');
        paintTab('basic');
      } catch (e) { U.toast('JSON 解析失败：' + e.message, 'error'); }
    };
    const jcopy = $('json-copy');
    if (jcopy) jcopy.onclick = () => {
      navigator.clipboard.writeText($('mm-json').value).then(() => U.toast('已复制', 'ok'), () => U.toast('复制失败', 'warn'));
    };
    const jdl = $('json-download');
    if (jdl) jdl.onclick = () => {
      util.downloadText((S.spec.id || 'mymod') + '.mod.json', specToJson(), 'application/json');
    };
  }

  function newRowDefaults(key) {
    switch (key) {
      case 'rooms': return { id: '', name: '', region: '', desc: '', exits: {} };
      case 'regions': return { id: '', name: '', color: '#7a9a7a', desc: '' };
      case 'npcs': return { id: '', name: '', room: '', level: 5, hp: 100, atk: 10, def: 5, dodge: 5, speed: 10, desc: '', talk: [] };
      case 'items': return { id: '', name: '', type: 'consumable', price: 10, weight: 1, desc: '' };
      case 'skills': return { id: '', name: '', type: '拳', category: '外功', quality: 'common', maxLevel: 300, difficulty: 1, damageMult: 1, mpCost: 0, desc: '', effects: [] };
      case 'sects': return { id: '', name: '', align: '正', desc: '', skills: [], ranks: [] };
      case 'quests': return { id: '', name: '', type: '支线', desc: '', stages: [], rewards: {} };
      case 'dialogues': return { id: '', name: '', npc: '', start: 'n1', nodes: [] };
      case 'rules': return { name: '', kind: 'multiply', target: '', value: 2, cond: '', effect: '' };
      default: return {};
    }
  }

  function applyPreset(key) {
    if (!S.spec.rules) S.spec.rules = [];
    const P = {
      exp2: { name: '双倍潜能', kind: 'multiply', target: 'pot', value: 2, cond: '', effect: '' },
      money2: { name: '双倍金钱', kind: 'multiply', target: 'money', value: 2, cond: '', effect: '' },
      autopick: { name: '自动拾取', kind: 'macro', target: 'getAll', value: 1, cond: 'room.items>0', effect: 'get all' },
      hpRegen: { name: '脱战回血', kind: 'onEvent', target: 'onTick', value: 1, cond: '!combat', effect: '+hp:5' },
      killReward: { name: '击杀额外奖励', kind: 'onEvent', target: 'onKill', value: 1, cond: '', effect: '+pot:10' }
    };
    if (P[key]) S.spec.rules.push(util.clone(P[key]));
  }

  /* ============================================================
   *  spec <-> mod.json
   * ============================================================ */
  function specToJson() {
    const s = S.spec;
    const out = {
      id: s.id || 'unnamed_mod',
      name: s.name || '未命名 Mod',
      version: s.version || '1.0.0',
      author: s.author || '',
      category: s.category || '综合',
      desc: s.desc || '',
      tags: s.tags || [],
      gameVersion: s.gameVersion || '1.0.0',
      requires: s.requires || []
    };

    /* 隐藏溯源：导入时带进来的那个原样带出去 —— 导出/上传都走这里，
       漏掉这一行等于整套保护作废（服务端会以为这是全新作品）。 */
    if (s._wxTrace) out._wxTrace = s._wxTrace;

    /* 内容集合 */
    ['rooms', 'regions', 'npcs', 'items', 'skills', 'sects', 'quests', 'dialogues'].forEach(k => {
      const arr = s[k] || [];
      if (!arr.length) return;
      out[k] = arr.map(x => clean(x));
    });

    if ((s.rules || []).length) out.rules = s.rules.map(x => clean(x));

    return JSON.stringify(out, null, 2);
  }

  function clean(o) {
    if (Array.isArray(o)) return o.map(clean);
    if (o && typeof o === 'object') {
      const out = {};
      Object.keys(o).forEach(k => {
        const v = o[k];
        if (v === '' || v === null || v === undefined) return;
        if (Array.isArray(v) && !v.length) return;
        if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) return;
        out[k] = clean(v);
      });
      return out;
    }
    return o;
  }

  function jsonToSpec(obj) {
    const s = blankSpec();
    Object.keys(s).forEach(k => { if (obj[k] !== undefined) s[k] = obj[k]; });
    /* 把各种简写归一化 */
    s.npcs = (s.npcs || []).map(n => {
      if (typeof n.talk === 'string') n.talk = n.talk.split('\n').filter(Boolean);
      if (typeof n.teach === 'string') n.teach = n.teach.split(',').map(x => x.trim()).filter(Boolean);
      if (typeof n.loot === 'string') n.loot = n.loot.split(',').map(x => x.trim()).filter(Boolean);
      return n;
    });
    s.quests = (s.quests || []).map(q => {
      if (q.rewardsItems) { q.rewards = q.rewards || {}; q.rewards.items = String(q.rewardsItems).split(',').map(x => x.trim()).filter(Boolean); delete q.rewardsItems; }
      return q;
    });
    s.sects = (s.sects || []).map(sc => {
      if (typeof sc.skills === 'string') sc.skills = sc.skills.split(',').map(x => x.trim()).filter(Boolean);
      if (typeof sc.ranks === 'string') sc.ranks = sc.ranks.split(',').map(x => x.trim()).filter(Boolean);
      return sc;
    });
    s.skills = (s.skills || []).map(sk => { if (!sk.effects) sk.effects = []; return sk; });
    return s;
  }

  /* ============================================================
   *  校验
   * ============================================================ */
  async function runValidate(showToast) {
    let report;
    try {
      const d = await api.editorValidate(S.spec);
      report = d.report || d;
    } catch (e) {
      U.toast('检查失败：' + e.message, 'error');
      return null;
    }
    lastReport = report;
    if (T.cur === 'report') paintTab('report');
    if (showToast) {
      const ne = (report.errors || []).length;
      U.toast(ne ? ('发现 ' + ne + ' 个错误，请看检查报告') : '✔ 检查通过，没有发现问题', ne ? 'warn' : 'ok', 3200);
    }
    return report;
  }

  /* ============================================================
   *  保存 / 导入 / 导出 / 上传
   * ============================================================ */
  async function doSave() {
    const rep = await runValidate(false);
    if (rep && (rep.errors || []).length) {
      const go = await U.confirmBox('还有 ' + rep.errors.length + ' 个错误',
        '检查发现有错误，保存后可能无法正常运行。仍要继续吗？\n\n第一个错误：' + rep.errors[0], '继续保存');
      if (!go) { tab('report'); return; }
    }
    try {
      const d = await api.editorSave(S.spec, S.spec.id);
      T.dirty = false;
      U.toast('已保存到本地 Mod 目录：' + (S.spec.id || ''), 'ok');
      if (S.screen === 'modmaker') { /* nothing */ }
    } catch (e) { U.toast('保存失败：' + e.message, 'error'); }
  }

  async function doImport() {
    try {
      const { text, name } = await util.readTextFile('.json,.mod,.zip');
      let obj;
      if (/\.zip$/i.test(name)) {
        U.toast('ZIP 请到「Mod 管理器 → 从文件安装」导入', 'warn', 3400);
        return;
      }
      obj = JSON.parse(text);
      S.spec = jsonToSpec(obj);
      mark();
      paintTab('basic');
      U.toast('已导入：' + (S.spec.name || name), 'ok');
    } catch (e) {
      if (e && e.message === '未选择文件') return;
      U.toast('导入失败：' + e.message, 'error');
    }
  }

  async function doExport() {
    try {
      const d = await api.editorExport(S.spec, S.spec.id);
      if (d.base64) {
        util.downloadB64((S.spec.id || 'mymod') + '.zip', d.base64, 'application/zip');
        U.toast('已导出 ZIP', 'ok');
      } else if (d.json) {
        util.downloadText((S.spec.id || 'mymod') + '.mod.json', d.json, 'application/json');
      }
    } catch (e) { U.toast('导出失败：' + e.message, 'error'); }
  }

  async function doUpload() {
    if (!S.spec.id || !S.spec.name) { U.toast('请先填写 Mod 名称和 ID', 'warn'); tab('basic'); return; }

    /* 主人 2026-10-11：**上传必须登录**。
       登录之后服务端才认得出「这是谁发的」——「我制作的 Mod」也才有归属。 */
    if (!isLoggedIn()) {
      U.toast('发布到 Mod 网站需要先登录', 'warn', 2200);
      if (!await askLogin()) return;
    }

    const rep = await runValidate(false);
    if (rep && (rep.errors || []).length) {
      U.toast('有 ' + rep.errors.length + ' 个错误，先修好再上传吧', 'warn', 3200);
      tab('report');
      return;
    }

    let cfg = S.siteConfig;
    try { cfg = await api.siteConfig(); } catch (e) { }
    const base = (cfg && cfg.apiBase) || 'http://127.0.0.1:8788';

    const body =
      '<div class="up-box">' +
      '<div class="up-row"><label>Mod 网站</label><code>' + esc(base) + '</code></div>' +
      '<div class="up-row"><label>Mod</label><b>' + esc(S.spec.name) + '</b> <span class="dim">v' + esc(S.spec.version || '1.0.0') + '</span></div>' +
      field('上传说明（可选）', '<input class="mm-input" id="up-note" placeholder="这次更新了什么？">') +
      '<div class="up-tip">上传后可在 Mod 管理器的「在线市场」一键下载安装。</div>' +
      '</div>';

    U.modal('一键上传到 Mod 社区', body,
      '<button class="btn-ink" onclick="WXUI.closeModal()">取 消</button>' +
      '<button class="btn-ink primary" id="up-go">上 传</button>');

    $('up-go').onclick = async () => {
      const note = ($('up-note') || {}).value || '';
      U.closeModal();

      U.toast('正在上传…', 'info', 1500);
      try {
        /* ---- 上传到 Mod 站 ---- */
        const d = await api.siteUpload({
          spec: S.spec,
          json: specToJson(),
          note,
          author: S.spec.author || (S.my && S.my.name) || '匿名侠客'
        });
        if (d.url) {
          /* 二创就明说（主人 2026-10-11）：来源是服务端从隐藏溯源判出来的，
             玩家自己填不了 —— 所以这句话是可信的，写出来对原作者也公平。 */
          const fork = d.forkOf
            ? '<div class="up-row"><label>来路</label><b>二创</b> <span class="dim">自《' +
              esc(d.forkOf.name) + '》（' + (d.forkOf.official ? '官方' : esc(d.forkOf.owner)) + '）</span></div>'
            : '';
          U.modal('上传成功 ✔',
            '<div class="up-box"><div class="up-ok">' +
            (d.forkOf ? '你的二创作品已经发布啦！' : '你的 Mod 已经发布到 Mod 网站啦！') + '</div>' +
            '<div class="up-row"><label>页面</label><a href="' + esc(d.url) + '" target="_blank">' + esc(d.url) + '</a></div>' +
            (d.id ? '<div class="up-row"><label>Mod ID</label><code>' + esc(d.id) + '</code></div>' : '') +
            fork +
            (d.forkOf ? '<div class="up-tip">站点上会标出「二创自《' + esc(d.forkOf.name) + '》」—— 这是规矩，不是毛病。</div>' : '') +
            '</div>',
            '<button class="btn-ink" onclick="WXUI.closeModal()">好 的</button>' +
            '<button class="btn-ink primary" id="up-open">打开网页看看</button>');
          const ob = $('up-open');
          if (ob) ob.onclick = () => { window.open(d.url, '_blank'); U.closeModal(); };
        } else {
          U.toast('上传成功', 'ok');
        }
      } catch (e) {
        U.toast('上传失败：' + e.message + '\n（云端不可用时请确认 Mod 网站服务已启动）', 'error', 4600);
      }
    };
  }

  /* ============================================================
   *  导出
   * ============================================================ */
  global.WXMM = {
    open, tab, blankSpec, specToJson, jsonToSpec, runValidate,
    doSave, doImport, doExport, doUpload,
    /* 给测试留的把手：「游戏内 ID → 按 ID 改」的入口，
       不然「同 id 只留一份」这条断言只能靠模拟点击，太脆。 */
    pickGameId, isLoggedIn,
    get spec() { return S.spec; },
    set spec(v) { S.spec = v; },
    mark, isDirty
  };

})(window);
