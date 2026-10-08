/* ==========================================================================
   武侠行 · Mod 示例文件（网站用）
   与游戏内 docdata.js 的 EXAMPLES 保持一致
   ========================================================================== */
(function (global) {
  'use strict';

  const EXAMPLES = {
    story: {
      key: 'story', badge: '剧情',
      title: '剧情 Mod 示例 · 江南奇遇记',
      desc: '一个最简但完整的剧情：在官道游侠处接到任务 → 击杀山贼头目 → 回来复命领赏。同时演示了「对话树 + 任务阶段 + NPC」怎么串起来。',
      tips: '要点：任务的第 1 阶段用 flag 触发（玩家答应），第 2 阶段用 kill（杀贼首），第 3 阶段又回到 flag（复命）。对话节点里的选项效果 <code>quest:q_demo_bandit:2</code> 直接把任务推进。',
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
            rewards: { exp: 300, pot: 60, money: 200, items: ['jinchuang_yao'] },
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
            room: 'road_jiangnan_1', level: 12, hp: 400, atk: 30, def: 15,
            desc: '一个背着长剑的年轻游侠，眉宇间有几分正气。',
            talk: ['江湖路远，侠士珍重。', '听说北边林子不太平。'],
            canTeach: true, teach: ['basic_sword'], quests: ['q_demo_bandit']
          }
        ]
      }
    },

    map: {
      key: 'map', badge: '地图',
      title: '地图 Mod 示例 · 听雨山庄',
      desc: '新建 4 个房间并连成一片小地图，还接到江南官道上。演示了区域归组、房间出口、进入触发效果。',
      tips: '要点：房间靠 <code>exits</code> 互联，<b>两边都要连</b>。<code>region</code> 指向区域 id，地图上会自动归组。<code>onEnter</code> 是走进来时的旁白。',
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
      key: 'func', badge: '功能',
      title: '功能 Mod 示例 · 轻松江湖',
      desc: '不改内容，只改规则：双倍经验、双倍金钱、脱战自动回血、击杀额外潜能。适合想轻松体验剧情的玩家。',
      tips: '要点：<code>kind</code> 是规则类型。<code>multiply</code> 是倍数调整，<code>target</code> 填字段名（exp / money），<code>value</code> 填倍数。<code>onEvent</code> 是事件触发，<code>target</code> 填事件名（onKill / onTick），<code>effect</code> 填要执行的效果。',
      json: {
        id: 'demo_func',
        name: '轻松江湖',
        version: '1.0.0',
        author: '武侠行官方',
        category: '功能',
        desc: '降低肝度：双倍收益 + 自动回血。',
        tags: ['功能', '便利'],
        rules: [
          { name: '双倍经验', kind: 'multiply', target: 'exp', value: 2, cond: '', effect: '' },
          { name: '双倍金钱', kind: 'multiply', target: 'money', value: 2, cond: '', effect: '' },
          { name: '脱战回血', kind: 'onEvent', target: 'onTick', value: 1, cond: '!combat', effect: '+hp:8' },
          { name: '击杀额外潜能', kind: 'onEvent', target: 'onKill', value: 1, cond: '', effect: '+pot:15' }
        ]
      }
    },

    skill: {
      key: 'skill', badge: '功法',
      title: '功法 Mod 示例 · 太虚剑意',
      desc: '一门自创高阶剑法 + 配套内功 + 一本秘籍。演示了招式效果（连击 / 无视防御 / 吸血）和学习门槛。',
      tips: '要点：<code>type: "sword"</code> 是剑法类型。<code>damageMult</code> 是威力倍率，2.1 已经很强。<code>require</code> 是学习门槛。<code>effects</code> 是招式效果数组，每个有 type / value / chance / turns。秘籍物品用 <code>use: "learn:武学ID"</code> 关联。',
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
            type: 'sword',
            maxLevel: 180,
            difficulty: 4,
            damageMult: 2.1,
            accuracy: 25,
            mpCost: 30,
            desc: '剑走太虚，意在剑先。一出手便如云海翻涌，绵绵不绝。',
            require: 'level>=30',
            effects: [
              { type: 'extraHit', value: 0.35, chance: 0.4, name: '剑影分光' },
              { type: 'ignoreDef', value: 0.4, chance: 0.25, name: '无相' },
              { type: 'drain', value: 0.15, chance: 0.3, name: '剑气回元' }
            ]
          },
          {
            id: 'taixu_xinfa',
            name: '太虚心法',
            type: 'force',
            maxLevel: 200,
            difficulty: 4,
            damageMult: 1,
            mpCost: 0,
            mpBonus: 8,
            desc: '太虚剑意的内功根基，修之可扩经脉、增内力。',
            require: 'level>=25',
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
      key: 'item', badge: '物品',
      title: '物品 Mod 示例 · 百宝囊',
      desc: '一批实用丹药与过渡装备。演示了消耗品（使用效果）、武器（部位+攻击加成）、防具（部位+防御+气血）。',
      tips: '要点：<code>type</code> 决定物品类型。<code>slot</code> 是装备部位，武器填 <code>weapon</code>。<code>use</code> 是使用效果。<code>stackable</code> 决定能否堆叠。',
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
            id: 'wugou_jian', name: '无垢剑', type: 'weapon', slot: 'weapon',
            price: 2400, weight: 3, level: 15, atk: 45, dodge: 5,
            desc: '一柄通体莹白的软剑，出鞘无声。'
          },
          {
            id: 'qingyun_pao', name: '青云袍', type: 'armor', slot: 'body',
            price: 1800, weight: 2, level: 12, def: 32, hp: 80,
            desc: '青缎裁成，轻软透气，内衬软甲。'
          }
        ]
      }
    },

    sect: {
      key: 'sect', badge: '门派',
      title: '门派 Mod 示例 · 天机阁',
      desc: '自创一个门派，含职位阶梯、门派武学、加入条件，以及门派驻地。',
      tips: '要点：<code>ranks</code> 是从低到高的职位名数组。<code>skills</code> 是门派武学 ID 列表。<code>require</code> 是加入条件。配合地图 Mod，可以把门派驻地也一起建出来。',
      json: {
        id: 'demo_sect',
        name: '天机阁',
        version: '1.0.0',
        author: '武侠行官方',
        category: '门派',
        desc: '一个擅机关术与暗器的新门派。',
        tags: ['门派', '原创'],
        sects: [
          {
            id: 'tianji_ge',
            name: '天机阁',
            region: 'jiangnan',
            align: '中',
            desc: '阁中弟子精于机关巧术，善用暗器，行事亦正亦邪。',
            require: 'level>=8',
            ranks: ['记名弟子', '入门弟子', '机巧师', '掌机使', '阁主'],
            rankCost: [0, 200, 800, 2500, 8000],
            skills: ['basic_fist', 'basic_dodge', 'tangmen_anqi'],
            entrySkills: ['basic_fist'],
            entryItems: ['wood_sword']
          }
        ]
      }
    }
  };

  /* ---------------- 渲染 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderAll() {
    const box = document.getElementById('examples');
    if (!box) return;
    box.innerHTML = Object.keys(EXAMPLES).map(k => {
      const e = EXAMPLES[k];
      const json = JSON.stringify(e.json, null, 2);
      return '<div class="ex-card" id="ex-' + e.key + '">' +
        '<div class="ex-head">' +
        '<span class="tag jade">' + esc(e.badge) + '</span>' +
        '<span class="ex-title">' + esc(e.title) + '</span>' +
        '<button class="btn sm" data-copy="' + e.key + '">复制 JSON</button>' +
        '<button class="btn sm" data-dl="' + e.key + '">下载 .json</button>' +
        '</div>' +
        '<div class="ex-desc">' + esc(e.desc) + '</div>' +
        '<div class="ex-desc" style="color:#a8842c;font-size:13px;line-height:1.9">💡 ' + e.tips + '</div>' +
        '<pre class="ex-code">' + esc(json) + '</pre>' +
        '<div class="ex-ops">' +
        '<button class="btn sm primary" data-copy="' + e.key + '">复制到剪贴板</button>' +
        '<button class="btn sm" data-dl="' + e.key + '">下载 mod.json</button>' +
        '<a class="btn sm" href="upload.html?demo=' + e.key + '">拿去发布</a>' +
        '</div></div>';
    }).join('');

    box.querySelectorAll('[data-copy]').forEach(b => {
      b.onclick = () => {
        const e = EXAMPLES[b.getAttribute('data-copy')];
        navigator.clipboard.writeText(JSON.stringify(e.json, null, 2))
          .then(() => SITE.toast('已复制到剪贴板', 'ok'), () => SITE.toast('复制失败，请手动选中', 'err'));
      };
    });
    box.querySelectorAll('[data-dl]').forEach(b => {
      b.onclick = () => {
        const e = EXAMPLES[b.getAttribute('data-dl')];
        const blob = new Blob([JSON.stringify(e.json, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = e.json.id + '.mod.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 400);
      };
    });
  }

  global.EXAMPLES = EXAMPLES;
  global.renderExamples = renderAll;

})(window);
