/**
 * pronouns.js — 第三人称人称代词/性别的**单一入口**（B11）
 *
 * 主人原话：「对毒蛇的第三人称描述用『他』而不是『它』」。
 * 根因不是某一处写错，而是**全仓有几十处直接写死「他」/`female?'女':'男'`**，
 * 每处各自兜底 —— 于是一遇到 `gender==='other'` 的兽类就露馅。
 * 项目铁律：字段对齐靠归一化入口，别让各处渲染各自兜底。所以收敛成这一个模块，
 * 所有按性别渲染第三人称的地方都必须过 `pronounOf()` / `genderNoun()`。
 *
 * ── 为什么 `gender==='other'` 不能一律当成「它」────────────────────────
 * 数据里 `other` 有 6 个：5 个是兽（灰狼/野猪/毒蛇/黑熊/吊睛白额虎），
 * 第 6 个是 **mob_assassin 黑衣人** —— 他是人（level 33 的刺客，只是
 * 「全身笼罩在黑衣中」**性别成谜**）。把 `other` 一刀切当「它」，
 * 毒蛇修好了，黑衣人却开始被叫「它」，那是**新造**的语病。
 * 所以判据分两层：
 *   · male/female 直接给「他/她」（当前数据里没有任何兽是男/女）；
 *   · 其余（other / 缺失）才看**是不是兽**：兽用「它」，性别成谜的人仍用「他」。
 * 「是不是兽」用 bestiary.speciesOf 的**显式 id 清单**（与 B3/B8 同一份真相源），
 * 不猜关键词 —— 中文武侠里「金蛇郎君/蛇婆婆」是人不是蛇（BLK-2 的教训）。
 */
'use strict';

const { speciesOf } = require('./bestiary');

/** 是否兽类（蛇/狼/熊/猪/虎…）。
 *  ① bestiary 显式 id 清单（与 B3/B8 同源）；② 模板显式 race 标了兽。
 *  判不出 → 当作人（宁可不把一个人叫「它」）。 */
function isAnimal(x) {
  if (!x) return false;
  /* ⚠️ `x.def` 不一定是指向模板 —— NPC 模板/实例上 `def` 也可能是**防御值**（数字）！
     templates 里 `def: 5` 是「防御」，spawnNpc 里 `npc.def = def` 才把模板挂上去。
     所以只有当 `x.def` 是对象时才当模板用，否则把 x 自己当模板。否则
     pronounOf(模板) 会误判（实测：毒蛇模板被读成「他」）。 */
  const def = (x.def && typeof x.def === 'object') ? x.def : x;
  const id = def.id || x.defId || '';
  if (speciesOf({ id, species: def.species })) return true;
  if (def.race && /beast|animal|兽/.test(String(def.race))) return true;
  return false;
}

/**
 * 第三人称代词单一入口。
 * @param {object} x 实例或模板（读 .gender / .def）
 * @returns {'他'|'她'|'它'}
 */
function pronounOf(x) {
  const g = x && x.gender;
  if (g === 'female') return '她';
  if (g === 'male') return '他';
  /* other / 缺失：兽 → 它；性别成谜的人（黑衣人之类）→ 他 */
  return isAnimal(x) ? '它' : '他';
}

/**
 * 性别名（男 / 女 / 不明）单一入口 —— 与 pronounOf 同源。
 * 替代散落的 `gender === 'female' ? '女' : '男'`（other 会落进 else 显示成「男」）。
 * @returns {'男'|'女'|'不明'}
 */
function genderNoun(x) {
  const g = x && x.gender;
  if (g === 'female') return '女';
  if (g === 'male') return '男';
  return '不明';
}

module.exports = { pronounOf, genderNoun, isAnimal };
