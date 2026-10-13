window.COMBAT_LINES = (function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
     战斗三层演出句库 v2
     ──────────────────────────────────────────────────────────────
     v1 的病：160 条骨架全走「{A}这一{V}落在{T}{P}」一个句法。
     当初选它是因为"唯有它对全部近战动词成立"——正因为它万能，
     它就必然成为最显眼的模板。主人的原话是「有一股 AI 味」，
     病根不在细节不够，在**结构太整齐**。

     v2 的改法：把「句式」提成第一层，跟 动词 / 部位 / 程度 并列。
     8 种句式，每条骨架各占一种；环形缓冲之外再加一道**句式缓冲**——
     连续两条不得同句式。这样"变化"是靠结构保证的，不是靠数量堆的。

     四条硬规矩（对应主人点出的四条病）：
       ① 8 种句式轮换，打破单一骨架垄断
       ② plain / short 两种句式不带观察，占 2/8（另有 act 里的一部分停在动作上）
       ③ 明喻只许出现在 sound 句式，每类一条，全库 4 条 / 160 条 = 2.5%
       ④ 必须有极短句：short 句式一律 4–8 字
     ══════════════════════════════════════════════════════════════ */

  /* ── 程度层：5 档 ──
     hp 为本次伤害 / 对方最大气血 的区间；uiTier 只给层级，色相由美术总监定。 */
  var severity = [
    { id: 1, key: 'graze', name: '蹭了一下不算伤', hp: [0.00, 0.08], uiTier: 1 },
    { id: 2, key: 'dirty', name: '挂脏了',         hp: [0.08, 0.22], uiTier: 2 },
    { id: 3, key: 'blood', name: '见了血',         hp: [0.22, 0.45], uiTier: 3 },
    { id: 4, key: 'bone',  name: '伤到骨',         hp: [0.45, 0.75], uiTier: 4 },
    { id: 5, key: 'down',  name: '站不住',         hp: [0.75, 1.00], uiTier: 5 }
  ];

  /* ── 部位层：14 处 ──
     light 走 1–2 档；heavy 走 4–5 档；3 档各半。
     ⚠️ 部位一律要能同时接「落在{P}」和「{P}上」，否则加"上"字会崩（如「肋下上」）。
     ⚠️ 骨架里不许写死 limb（胳膊/腿），因为 {P} 可能是咽喉、太阳穴。 */
  var parts = {
    light: ['手背', '指节', '前膝', '脚踝', '小腿', '耳根'],
    heavy: ['面门', '咽喉', '后颈', '左肩', '右肋', '后腰', '手肘', '太阳穴']
  };

  /* ── 动词层：4 类各 14 条，禁止跨类复用 ──
     剑走「这一＿」，刀走「这一＿」，拳走「这一＿」，暗器走「手一＿」（故暗器全单字）。
     ⚠️ 不是每条骨架都用 {V}：result / short 句式不带动词，这是 v2 故意的。 */
  var verbs = {
    sword:  ['抹', '点', '绞', '撩', '崩', '刺', '穿', '截', '递', '划', '抽', '扫', '压', '挑'],
    blade:  ['劈', '剁', '斩', '铲', '捅', '削', '抡', '拍', '磕', '顿', '扎', '砍', '刮', '砸'],
    fist:   ['捣', '掖', '顶', '靠', '掴', '抄', '挫', '炮', '撞', '轰', '掀', '夯', '切', '戳'],
    hidden: ['甩', '抖', '弹', '掷', '扬', '扣', '撒', '抛', '翻', '脱', '送', '挥', '掠', '旋']
  };

  /* ── 句式层：8 种（v2 新增，第一层）──
     act    动作式：这一{V}落在{P}。v1 的唯一骨架，现在只占 1/8。
     result 结果式：不写怎么打的，只写身体后来怎样。带 {P}，不带 {V}。
     sound  声音式：只写声音。全库唯一允许带明喻的句式。
     chain  连锁式：身体连锁反应，撞到东西、退、坐下去。
     plain  糙句：不带观察，不带比喻，就停在动作或结果上。
     short  极短句：4–8 字，不带 {V} 不带 {P}。
     delay  延迟式：疼 / 血来得晚，过一会儿才知道。
     thing  器物式：写兵器、衣裳、地面，不写人。
     ────────────────────────────────────────────────────────────── */
  var PATTERNS = {
    act:    '动作式｜这一{V}落在{P}',
    result: '结果式｜只写身体后来的样子',
    sound:  '声音式｜唯一许可喻的句式',
    chain:  '连锁式｜身体连锁反应',
    plain:  '糙句｜不带观察，停在动作上',
    short:  '极短句｜4–8 字',
    delay:  '延迟式｜疼或血来得晚',
    thing:  '器物式｜写兵器/衣裳/地面'
  };
  var PORDER = ['act', 'result', 'sound', 'chain', 'plain', 'short', 'delay', 'thing'];

  /* ── 骨架：4 类 × 5 档 × 8 句式 = 160 条 ──
     占位符：{A} 出手者 / {T} 挨打者 / {Td} 带"的"的所有格 / {V} 动词 / {P} 部位。
     ⚠️ 每档必须满 8 条且 8 条分属 8 种句式：环形缓冲（排除最近 6）只保证"不撞同一条"，
        **句式缓冲**（连续两条不得同句式）才保证"不撞同一个句法"。两者都要。 */
  var frames = {
    sword: {
      graze: [
        { p: 'act',    t: '{A}这一{V}落在{T}{P}，衣裳破了一道口子。' },
        { p: 'result', t: '{P}上火辣辣地疼了一下。疼完就没了。' },
        { p: 'sound',  t: '剑锋过去的声音很轻，像撕布。' },
        { p: 'chain',  t: '{T}往后一缩，脚跟磕在门槛上，人晃了一下。' },
        { p: 'plain',  t: '{A}这一{V}到{T}{P}。皮都没红。' },
        { p: 'short',  t: '擦过去了。' },
        { p: 'delay',  t: '{T}低头看{P}，看了两眼才觉出有点热。' },
        { p: 'thing',  t: '{Td}袖子上多了一条裂缝，棉絮还没出来。' }
      ],
      dirty: [
        { p: 'act',    t: '{A}这一{V}落在{T}{P}，皮翻起来一小条。' },
        { p: 'result', t: '{P}那块先白后红，摸上去是热的。' },
        { p: 'sound',  t: '剑刃刮过去，声音又干又短。' },
        { p: 'chain',  t: '{T}身子一歪，扶住墙才站住。墙皮掉了一小块，掉在脚边。' },
        { p: 'plain',  t: '{A}这一{V}蹭掉{T}{P}一层皮。血还没出来。' },
        { p: 'short',  t: '见了点红。' },
        { p: 'delay',  t: '{T}当下没觉出什么，过了一会儿血才渗出来，渗成一条细线。' },
        { p: 'thing',  t: '{Td}衣裳黏在{P}上，揭的时候带下一层皮。' }
      ],
      blood: [
        { p: 'act',    t: '{A}这一{V}从{Td}{P}过去，口子开了。' },
        { p: 'result', t: '{P}那道口子不长，血出得却不慢。' },
        { p: 'sound',  t: '剑抽出来的声音是黏的。' },
        { p: 'chain',  t: '{T}往后退了两步，后背抵住墙，血蹭在墙上一道。' },
        { p: 'plain',  t: '{A}这一{V}到{T}{P}。血跟着出来了。' },
        { p: 'short',  t: '前襟红了。' },
        { p: 'delay',  t: '血比疼来得晚。{T}低头才看见前襟红了一片。' },
        { p: 'thing',  t: '{Td}前襟那块红在慢慢扩大，边缘是湿的。' }
      ],
      bone: [
        { p: 'act',    t: '{A}这一{V}落在{T}{P}，剑身碰到了硬东西。' },
        { p: 'result', t: '{T}不敢动那半边身子了。' },
        { p: 'sound',  t: '{T}听见自己骨头上「咯」的一声，闷的。' },
        { p: 'chain',  t: '{T}往后退，退了两步坐到地上，剑还攥在手里。' },
        { p: 'plain',  t: '{A}这一{V}停在{T}{P}里。{T}没出声。' },
        { p: 'short',  t: '骨头响了。' },
        { p: 'delay',  t: '先是麻，麻了一阵，疼才上来。' },
        { p: 'thing',  t: '剑卡在里头，{A}抽了两下才抽出来。' }
      ],
      down: [
        { p: 'act',    t: '{A}这一{V}落在{T}{P}，{Td}手先松开。' },
        { p: 'result', t: '{T}还站着。站了没多久，人往下出溜，坐到了地上。' },
        { p: 'sound',  t: '剑先掉在地上，人是过了一下才倒的。' },
        { p: 'chain',  t: '{T}往前扑下去，脸朝地，剑压在身子底下。' },
        { p: 'plain',  t: '{A}这一{V}抽走以后，{T}还在站着。然后整个人往前扑下去。' },
        { p: 'short',  t: '站不住了。' },
        { p: 'delay',  t: '{T}没觉出疼。人是慢慢矮下去的。' },
        { p: 'thing',  t: '地上的土洇湿了一片，那片还在往外扩。' }
      ]
    },

    blade: {
      graze: [
        { p: 'act',    t: '{A}这一{V}落下来，{T}往后一仰，刀锋擦着{P}过去了。' },
        { p: 'result', t: '{P}上留了一道白印，过了一会儿才发红。' },
        { p: 'sound',  t: '刀锋过去带起一阵风，风是热的。' },
        { p: 'chain',  t: '{T}往旁边让，刀砍在地上，崩起的土溅了{T}一裤脚。' },
        { p: 'plain',  t: '{A}这一{V}空了大半，只剩一点擦着{Td}{P}。' },
        { p: 'short',  t: '他躲开了。' },
        { p: 'delay',  t: '{T}抬手摸了一下耳朵，摸完手是凉的。' },
        { p: 'thing',  t: '刀陷在地里，{A}拔了两下才拔出来。' }
      ],
      dirty: [
        { p: 'act',    t: '{A}这一{V}落在{Td}{P}，衣裳裂了，刀口很浅。' },
        { p: 'result', t: '{P}那块先青了，青得很快。' },
        { p: 'sound',  t: '刀背砸在肉上，闷得像砸在一袋粮食上。' },
        { p: 'chain',  t: '{T}身子歪了一下，扶住墙站住。扶过的地方留了半只血手印。' },
        { p: 'plain',  t: '{A}这一{V}只到了一半，剩下的蹭在{Td}{P}上。' },
        { p: 'short',  t: '皮开了一条。' },
        { p: 'delay',  t: '{T}只当是撞了一下。过了一会儿再看，{P}上那道已经发青了。' },
        { p: 'thing',  t: '{Td}衣裳破了个口子，口子里露出来的还是好肉。' }
      ],
      blood: [
        { p: 'act',    t: '{A}这一{V}落在{T}{P}，刀口不深，血出得却快。' },
        { p: 'result', t: '血从{Td}{P}往下走，走到手腕，再从指尖往下滴。' },
        { p: 'sound',  t: '刀抽出来的时候带出一串血珠，甩在地上甩成一道弧。' },
        { p: 'chain',  t: '{T}抬手去捂，捂不住，血从指缝里挤出来。' },
        { p: 'plain',  t: '{A}这一{V}到{Td}{P}。血下来了。' },
        { p: 'short',  t: '血出来了。' },
        { p: 'delay',  t: '{T}先听见响，再看见血。' },
        { p: 'thing',  t: '刀刃上的血往刀尖上淌，淌到地上积了一小摊。' }
      ],
      bone: [
        { p: 'act',    t: '{A}这一{V}落下去，{Td}{P}塌了一块。' },
        { p: 'result', t: '{T}那半边使不上劲了，抬手都抬不动。' },
        { p: 'sound',  t: '{T}听见骨头上那声闷响，比疼来得早。' },
        { p: 'chain',  t: '{T}拿兵器去接，接是接住了，人往后退了三步，脚跟在地上犁出两道印。' },
        { p: 'plain',  t: '{A}这一{V}落在{T}{P}。{Td}脸白了一下，没出声。' },
        { p: 'short',  t: '这一下砍实了。' },
        { p: 'delay',  t: '{T}先站着没动，过了一会儿才弯下腰去。' },
        { p: 'thing',  t: '刀卡在骨头上。{A}抬脚蹬住{T}，才把刀拔出来。' }
      ],
      down: [
        { p: 'act',    t: '{A}这一{V}落在{T}{P}，{Td}膝盖先弯了。' },
        { p: 'result', t: '{T}跪下去的时候还撑着刀不肯撒手。' },
        { p: 'sound',  t: '刀磕在石阶上，人跟着跪下去。' },
        { p: 'chain',  t: '{T}靠着墙滑下去，坐在自己的影子里，刀横在膝盖上。' },
        { p: 'plain',  t: '{A}这一{V}过后，{T}撑着刀不肯撒手，撑了三息，膝盖先弯了。' },
        { p: 'short',  t: '人跪下了。' },
        { p: 'delay',  t: '{T}坐着还在找刀。找了两下没找着，就不找了。' },
        { p: 'thing',  t: '刀从{T}手里滑出去，在地上转了半圈，停住。' }
      ]
    },

    fist: {
      graze: [
        { p: 'act',    t: '{A}这一{V}落在{T}{P}，{T}往后让了半分。' },
        { p: 'result', t: '{P}上热了一下，热完就凉了。' },
        { p: 'sound',  t: '拳头打在肉上，声音又闷又实。' },
        { p: 'chain',  t: '{T}往后一退，脚跟绊在门槛上，自己把自己绊了一下。' },
        { p: 'plain',  t: '{A}这一{V}到了{T}{P}。没打实。' },
        { p: 'short',  t: '挨了一下。' },
        { p: 'delay',  t: '{T}甩了两下手，{P}那块是木的。' },
        { p: 'thing',  t: '{Td}衣裳上留下一个灰手印，掸了两下没掸掉。' }
      ],
      dirty: [
        { p: 'act',    t: '{A}这一{V}落在{T}{P}，{T}闷哼了一声。' },
        { p: 'result', t: '{P}那块肿起来一条，摸上去发硬。' },
        { p: 'sound',  t: '这一下打得很实，声音像砸在湿布上。' },
        { p: 'chain',  t: '{T}身子一歪，撞在身后的桌子上，桌上的碗跳了一下。' },
        { p: 'plain',  t: '{A}这一{V}落在{T}{P}。{T}没还手，先退了半步。' },
        { p: 'short',  t: '打得挺实。' },
        { p: 'delay',  t: '当下不疼。过了一个时辰，{P}那块青了一大片。' },
        { p: 'thing',  t: '{Td}腮帮子肿起来，嘴里那块皮破了。' }
      ],
      blood: [
        { p: 'act',    t: '{A}这一{V}落在{T}{P}，{Td}嘴角先破了。' },
        { p: 'result', t: '血是从嘴里出来的。{T}吐了一口，吐在地上。' },
        { p: 'sound',  t: '牙磕在牙上，那声音{T}自己听得最清楚。' },
        { p: 'chain',  t: '{T}往后仰，后脑撞在墙上，撞掉一块墙皮，皮掉在肩膀上。' },
        { p: 'plain',  t: '{A}这一{V}落在{T}{P}。血下来了。' },
        { p: 'short',  t: '嘴里破了。' },
        { p: 'delay',  t: '{T}先觉出嘴里有个硬东西，吐出来是半颗牙。' },
        { p: 'thing',  t: '{T}用手背去抹嘴，抹完手背上全是血。' }
      ],
      bone: [
        { p: 'act',    t: '{A}这一{V}落在{T}{P}，{T}听见自己身上响了一声。' },
        { p: 'result', t: '{T}那半边抬到一半就抬不动了。' },
        { p: 'sound',  t: '那声音是从{T}自己骨头里出来的，闷的。' },
        { p: 'chain',  t: '{T}往后退，退到墙上，顺着墙滑下去坐着。' },
        { p: 'plain',  t: '{A}这一{V}落在{T}{P}。{T}跪下去了。' },
        { p: 'short',  t: '骨头响了。' },
        { p: 'delay',  t: '麻先到，疼后到。疼上来的时候{T}弯下了腰。' },
        { p: 'thing',  t: '{T}扶着墙想站起来，手一滑，又坐回去。' }
      ],
      down: [
        { p: 'act',    t: '{A}这一{V}落在{T}{P}，{Td}腿先软了。' },
        { p: 'result', t: '{T}站着没动，过了三息，整个人矮了下去。' },
        { p: 'sound',  t: '{T}倒地的时候，自己听见后脑磕地的那一下。' },
        { p: 'chain',  t: '{T}往后倒，倒的时候手在空中抓了一下，什么也没抓着。' },
        { p: 'plain',  t: '{A}这一{V}过后，{T}没再站起来。' },
        { p: 'short',  t: '人坐下了。' },
        { p: 'delay',  t: '{T}不记得自己是怎么坐下的。' },
        { p: 'thing',  t: '{T}人歪在地上，一只鞋掉在半尺外。' }
      ]
    },

    hidden: {
      graze: [
        { p: 'act',    t: '{A}手一{V}，{T}一侧头，就过去了。' },
        { p: 'result', t: '{P}上划了一道，很浅，血没出来。' },
        { p: 'sound',  t: '那东西钉进柱子里，尾羽嗡嗡地颤。' },
        { p: 'chain',  t: '{T}往后一跳，撞在门框上，门框上的灰落了一头。' },
        { p: 'plain',  t: '{A}抬了下手。{T}往旁边一让。' },
        { p: 'short',  t: '没打中他。' },
        { p: 'delay',  t: '{T}过了一会儿才看见袖子上那个洞。' },
        { p: 'thing',  t: '那东西落地，滚了两圈，停在{T}脚边。' }
      ],
      dirty: [
        { p: 'act',    t: '{A}手一{V}，扎进{Td}{P}，扎得不深。' },
        { p: 'result', t: '{P}上多了个眼儿，血珠先冒出来，过了片刻才连成一条。' },
        { p: 'sound',  t: '那东西擦着{T}耳朵过去，钉在门板上，尾羽还在颤。' },
        { p: 'chain',  t: '{T}一疼，手里的东西就掉了，掉在地上摔成两半。' },
        { p: 'plain',  t: '{T}「嘶」了一声，捂住{P}。' },
        { p: 'short',  t: '扎进肉里了。' },
        { p: 'delay',  t: '{T}当下只当被虫子叮了一口。' },
        { p: 'thing',  t: '{T}把那东西拔出来扔在地上，地上多了个血点。' }
      ],
      blood: [
        { p: 'act',    t: '{A}抬手一{V}，{Td}{P}上就多了一截，露在外头，还在颤。' },
        { p: 'result', t: '{Td}{P}上那个眼儿往外冒血，冒得急，顺着胳膊往下流。' },
        { p: 'sound',  t: '那东西钉进肉里的声音又短又脆。' },
        { p: 'chain',  t: '{T}抬手去拔，拔到一半疼得停住，手就那么举着。' },
        { p: 'plain',  t: '扎上了。血下来了。' },
        { p: 'short',  t: '扎进去了。' },
        { p: 'delay',  t: '{T}先觉出{P}上有点凉，低头才看见血。' },
        { p: 'thing',  t: '那东西还插在{Td}{P}上，尾羽随着{Td}呼吸在动。' }
      ],
      bone: [
        { p: 'act',    t: '{A}这一记{V}在{Td}{P}上，进去一半，碰到硬的。' },
        { p: 'result', t: '{T}一动就扯着，扯得整半边身子发软。' },
        { p: 'sound',  t: '那东西碰到骨头，声音又干又短，像敲在干木头上。' },
        { p: 'chain',  t: '{T}往后一坐，坐在地上，手还保持着要去拔的姿势。' },
        { p: 'plain',  t: '{T}跪下去了。' },
        { p: 'short',  t: '扎到骨头了。' },
        { p: 'delay',  t: '{T}先是麻，麻过之后是疼，疼得整条腿都在抖。' },
        { p: 'thing',  t: '那东西插得很深，{T}自己拔不出来，一拔就晃。' }
      ],
      down: [
        { p: 'act',    t: '{A}一{V}，{Td}手先松开，人靠着墙坐下去。' },
        { p: 'result', t: '{T}没躺下，就是靠着墙坐住了。人还在喘，刀已经不在手里。' },
        { p: 'sound',  t: '{T}倒地的时候，那东西还在{Td}{P}上颤。' },
        { p: 'chain',  t: '{T}往后倒，倒下去的时候把桌上的东西全带到了地上。' },
        { p: 'plain',  t: '{T}倒了。' },
        { p: 'short',  t: '人软下去了。' },
        { p: 'delay',  t: '{T}不记得疼，只记得眼前黑了一下。' },
        { p: 'thing',  t: '{T}躺在地上，{P}上还立着那东西，一动一动。' }
      ]
    }
  };

  /* ── 落空：4 类 × 4 条，同一类里 4 条分属 4 种句式 ── */
  var miss = {
    sword: [
      { p: 'act',    t: '{A}这一{V}落空了。剑走过去，带起一阵风。' },
      { p: 'plain',  t: '{T}往旁边一让。{A}这一{V}落了，{T}没在那儿。' },
      { p: 'short',  t: '空了。' },
      { p: 'thing',  t: '剑尖从{Td}{P}边上过去，钉在{T}身后的柱子上。' },
      { p: 'chain',  t: '{A}收不住，往前抢了一步，剑尖在土里划了一道。' },
      { p: 'result', t: '{T}躲开了，躲得急，脚底下踉跄了一下。' },
      { p: 'sound',  t: '剑走空了，只听见风声。' },
      { p: 'delay',  t: '{T}过了一会儿才反应过来，那一下是冲着自己来的。' }
    ],
    blade: [
      { p: 'act',    t: '{A}这一{V}落空了，刀陷进地里。' },
      { p: 'chain',  t: '{T}矮身让开。刀从头顶过去，削下几根头发。' },
      { p: 'short',  t: '砍空了。' },
      { p: 'thing',  t: '刀砍在石阶上，崩出一串火星。' },
      { p: 'plain',  t: '{T}闪开了。{A}这一{V}砸在地上，砸出一个坑。' },
      { p: 'result', t: '{A}用力过猛，刀脱手飞出去，插在三步外的泥里。' },
      { p: 'sound',  t: '刀砍下去，砍在空气里，声音是闷的。' },
      { p: 'delay',  t: '{A}砍完了才看清{T}已经不在原来的地方了。' }
    ],
    fist: [
      { p: 'act',    t: '{A}这一{V}落空，拳头擦着{Td}{P}过去。' },
      { p: 'plain',  t: '{T}往后一仰。{A}这一{V}没够着。' },
      { p: 'short',  t: '打空了。' },
      { p: 'chain',  t: '{A}收不住脚，往前冲了两步才站住。' },
      { p: 'thing',  t: '{T}一低头，这一下打在{T}身后的柱子上，柱子晃了晃。' },
      { p: 'result', t: '{A}打空了，胳膊还伸着，{T}从底下钻了过去。' },
      { p: 'sound',  t: '拳头从{Td}{P}边上过去，只蹭到一点风。' },
      { p: 'delay',  t: '{A}这一{V}打完，{T}才往旁边挪了半步。' }
    ],
    hidden: [
      { p: 'act',    t: '{T}一侧身，那东西贴着{Td}衣裳过去了。' },
      { p: 'thing',  t: '{T}往边上一闪。那东西钉在门框上，还在颤。' },
      { p: 'short',  t: '没中。' },
      { p: 'plain',  t: '那东西打在柱子上，弹开，落在地上。' },
      { p: 'chain',  t: '{T}把头一偏。那东西擦着{Td}{P}过去，扎进了土墙。' },
      { p: 'result', t: '{T}没动。那东西从{Td}袖子边上过去，只挑破了衣裳。' },
      { p: 'sound',  t: '那东西飞过去，钉在树上，尾羽嗡了一声。' },
      { p: 'delay',  t: '{T}听见声音回头，才知道刚才有东西过去。' }
    ]
  };

  /* ── 被架住：4 类 × 3 条 ── */
  var parried = {
    sword: [
      { p: 'thing', t: '{T}抬剑架住。两把剑绞在一起，谁也没动。' },
      { p: 'plain', t: '{A}这一{V}被磕开了。剑身震得发麻。' },
      { p: 'short', t: '架住了。' },
      { p: 'chain', t: '{T}往旁边错半步，两把剑贴着滑过去，滑到剑格上卡住。' },
      { p: 'result',t: '{T}把剑横过来，{A}这一{V}被挡在半尺外，两把剑都收不回去。' },
      { p: 'delay', t: '{A}这一{V}被架开了，手上的劲还在往前走，走了两寸才收住。' },
      { p: 'act',   t: '{A}这一{V}被{T}压住，剑尖往下沉，沉到离{Td}{P}一寸的地方停住。' },
      { p: 'sound', t: '两把剑磕在一起，那声音又脆又短，震得两个人的手都麻了一下。' }
    ],
    blade: [
      { p: 'thing', t: '{T}横刀磕住。刀刃蹭着刀刃，蹭出一串火星。' },
      { p: 'plain', t: '{A}这一{V}被架开，刀背撞在{Td}刀上，震得{T}退了半步。' },
      { p: 'short', t: '架开了。' },
      { p: 'chain', t: '{T}把刀往上抬了半尺，抬是抬住了，脚底下那块砖裂了一道。' },
      { p: 'result',t: '{T}用刀背接住，{A}这一{V}压不下去，刀刃离{Td}{P}还有三寸。' },
      { p: 'delay', t: '{A}这一{V}被架住了，力没卸掉，刀在半空里抖了两下。' },
      { p: 'act',   t: '{A}这一{V}被{T}架住，刀刃压在{Td}刀背上，压出一道白痕。' },
      { p: 'sound', t: '刀撞在刀上，「铮」的一声，声音在院子里绕了一圈。' }
    ],
    fist: [
      { p: 'sound', t: '{T}抬胳膊挡住。这一下砸在{Td}小臂上，闷响。' },
      { p: 'plain', t: '{A}这一{V}被{T}拨开了。{A}往前抢了半步。' },
      { p: 'short', t: '挡住了。' },
      { p: 'chain', t: '{T}抬手一格，格是格住了，两个人各自退了半步。' },
      { p: 'result',t: '{T}把手臂横在脸前，{A}这一{V}砸在上头，砸不动。' },
      { p: 'thing', t: '{A}这一{V}被{T}攥住了。手腕在{Td}掌心里，抽了两下没抽出来。' },
      { p: 'act',   t: '{A}这一{V}被{T}架住。两条胳膊碰在一处，僵着。' },
      { p: 'delay', t: '{A}这一{V}停在半路上。{Td}手已经等在那儿了。' }
    ],
    hidden: [
      { p: 'thing', t: '{T}抬手一拨，那东西偏了，钉在柱子上。' },
      { p: 'plain', t: '{T}用袖子一挡，那东西掉在地上。' },
      { p: 'short', t: '拨开了。' },
      { p: 'chain', t: '{T}把身子一矮。那东西从{Td}头顶过去，扎进门板，尾羽朝外。' },
      { p: 'result',t: '{T}拿袖子一兜，那东西落在袖子里，兜住了。' },
      { p: 'delay', t: '{A}出手了。那东西被{T}抓在手里，{T}过了一会儿才看清是什么。' },
      { p: 'act',   t: '那东西被{T}一巴掌拍飞，飞到墙角才掉下来。' },
      { p: 'sound', t: '那东西撞在{Td}刀身上，「叮」的一声弹开。' }
    ]
  };

  /* ── 暴击前缀：4 类 × 3 条，接在主句之前 ── */
  var crit = {
    sword:  ['这一下{T}没看见。', '等的就是这一刻。', '剑走的是{T}看不见的那条线。', '这一下是从下往上走的。'],
    blade:  ['两手都上了刀柄。', '这一下是拿全身的力气砸的。', '刀还没提起来。', '这一下没有收力。'],
    fist:   ['近了身才出手。', '这一下是贴着打的。', '{Td}手还在上头。', '这一下是往骨头上招呼的。'],
    hidden: ['手是从袖子里出来的。', '那东西出手的时候没有声音。', '{T}没看见{A}抬手。', '手抬得比话快。']
  };

  /* ══ 取数与渲染 ══ */

  /* 环形缓冲：排除最近 n 条。key 分开存，各类各档互不干扰。 */
  var hist = {};
  function pickNoRepeat(arr, key, n, forceArr) {
    var src = forceArr && forceArr.length ? forceArr : arr;
    var h = hist[key] || (hist[key] = []);
    var pool = src.filter(function (x) { return h.indexOf(x) < 0; });
    if (!pool.length) pool = src;
    var it = pool[Math.floor(Math.random() * pool.length)];
    h.push(it);
    while (h.length > n) h.shift();
    return it;
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* 句式缓冲：连续两条不得同句式。这是 v2 的核心机械保证。 */
  var patHist = [];
  function pickFrame(S, style, sevKey, n) {
    var fresh = S.filter(function (f) { return patHist.indexOf(f.p) < 0; });
    var it = pickNoRepeat(S, 'frame_' + style + '_' + sevKey, n, fresh.length ? fresh : null);
    patHist.push(it.p);
    while (patHist.length > 2) patHist.shift();
    return it;
  }

  /* {Td}：名字以 的/你/我/他 结尾的就不再加"的"，避免「那使刀的的咽喉」。 */
  function poss(name) {
    if (!name) return '';
    return /[的你他她]$/.test(name) ? name : name + '的';
  }

  function fill(tpl, A, T, V, P) {
    return String(tpl)
      .replace(/\{Td\}/g, poss(T))
      .replace(/\{A\}/g, A)
      .replace(/\{T\}/g, T)
      .replace(/\{V\}/g, V === undefined ? '' : V)
      .replace(/\{P\}/g, P === undefined ? '' : P);
  }

  /**
   * 渲染一条战斗演出。
   * @param {string} style  sword | blade | fist | hidden
   * @param {number} hpRatio  本次伤害 / 对方最大气血，0–1
   * @param {object} opts  { A, T, missed, blocked, crit, dmg, mode }
   * @returns {string} 一句完整的话
   */
  function render(style, hpRatio, opts) {
    opts = opts || {};
    var A = opts.A || '你';
    var T = opts.T || '那人';
    var Vs = verbs[style] || verbs.fist;
    var S = frames[style] || frames.fist;

    if (opts.missed) {
      var M = miss[style] || miss.fist;
      var mf = pickFrame(M, style, 'miss', 6);
      return fill(mf.t, A, T, pick(Vs), pick(parts.light));
    }
    if (opts.blocked) {
      var B = parried[style] || parried.fist;
      var bf = pickFrame(B, style, 'parry', 6);
      return fill(bf.t, A, T, pick(Vs), pick(parts.heavy));
    }

    var sev = severity[4];
    for (var i = 0; i < severity.length; i++) {
      if (hpRatio < severity[i].hp[1]) { sev = severity[i]; break; }
    }
    if (opts.crit && sev.id < 3) sev = severity[2];   // 暴击至少见血，否则"正中要害"自己打自己

    var tierKey = sev.id <= 2 ? 'light' : (sev.id >= 4 ? 'heavy' : (Math.random() < 0.5 ? 'light' : 'heavy'));
    var P = pickNoRepeat(parts[tierKey], 'part_' + style, 2);
    var V = pickNoRepeat(Vs, 'verb_' + style, 3);

    var f = pickFrame(S[sev.key], style, sev.key, 6);
    var text = fill(f.t, A, T, V, P);

    if (opts.crit) text = fill(pickNoRepeat(crit[style] || crit.fist, 'crit_' + style, 2), A, T, '', '') + text;
    if (opts.mode === 'numeric') text += '（-' + Math.max(1, Math.round(opts.dmg || 0)) + '）';
    return text;
  }

  return {
    version: 2,
    severity: severity,
    parts: parts,
    verbs: verbs,
    patterns: PATTERNS,
    patternOrder: PORDER,
    frames: frames,
    miss: miss,
    parried: parried,
    crit: crit,
    render: render,
    fill: fill,
    poss: poss,
    _reset: function () { hist = {}; patHist = []; }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.COMBAT_LINES;
