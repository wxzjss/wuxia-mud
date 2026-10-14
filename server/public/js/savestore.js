/* ============================================================
 *  WXSAVE —— 本地存档组件（存档本地化 2026-10-18，主人定调：
 *  云端/服务器同步下线，存档读写全部走浏览器 localStorage）
 * ============================================================
 *  收敛纪律（沿用既有口径）：
 *   · **物理键名只在本文件出现**——别的文件只认 WXSAVE 的方法，不碰 localStorage；
 *   · 每个逻辑键**整键覆盖**（读全文→改→写回），从不拼补丁；
 *   · SCHEMA 只在索引形状变更时 bump（纯加档/删档不 bump）。
 *
 *  布局：
 *   · 索引  `wx_saves_index`      → { schema, saves: [元信息…按 savedAt 排] }
 *   · 正文  `wx_save_<id>`        → 世界序列化全文（一份档一个键，写档只动两键：
 *                                   自己的正文键 + 索引键，不重写别人的档）
 *   · 迁移旗 `wx_saves_migrated_v2` → 老档一次性导入的幂等旗（见 app.js migrateLegacySaves）
 *
 *  容量口径：浏览器 localStorage 约 5 MB / 源。一份正文 200–300 KB，
 *  软上限 12 份（≈3.6 MB）；超限给明确人话，不许静默吞档。
 * ============================================================ */
(function (global) {
  'use strict';

  var IDX_KEY = 'wx_saves_index';
  var BLOB_PREFIX = 'wx_save_';
  var MIG_KEY = 'wx_saves_migrated_v2';
  var SCHEMA = 1;
  var MAX_SAVES = 12;

  function ls() { return global.localStorage; }

  /* 索引读：坏数据/旧形状一律当「没有」，绝不抛异常炸启动 */
  function readIdx() {
    try {
      var j = JSON.parse(ls().getItem(IDX_KEY) || 'null');
      if (j && j.schema === SCHEMA && Array.isArray(j.saves)) return j.saves;
    } catch (e) { /* ignore */ }
    return [];
  }

  function writeIdx(list) {
    ls().setItem(IDX_KEY, JSON.stringify({ schema: SCHEMA, saves: list }));
  }

  /** 列表（按 savedAt 降序；与老 engine.listSaves 同序，界面零改动） */
  function list() {
    return readIdx().slice().sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
  }

  function hasAny() { return readIdx().length > 0; }

  /**
   * 落一份档：先写正文键，再更新索引（半途失败不产生「有索引无正文」的幽灵档——
   * 读的时候以正文键为准，索引只是目录）。
   * @returns {ok:boolean, msg?:string}
   */
  function put(entry, blob) {
    if (!entry || !entry.id || blob == null) return { ok: false, msg: '存档内容不完整。' };
    var idx = readIdx();
    var isNew = !idx.some(function (s) { return s.id === entry.id; });
    if (isNew && idx.length >= MAX_SAVES) {
      return { ok: false, msg: '本地最多留 ' + MAX_SAVES + ' 份存档，删几份旧的再存。' };
    }
    try {
      ls().setItem(BLOB_PREFIX + entry.id, JSON.stringify(blob));
    } catch (e) {
      return { ok: false, msg: '浏览器本地空间不足，删几份旧档再试。' };
    }
    var meta = {};
    for (var k in entry) if (Object.prototype.hasOwnProperty.call(entry, k)) meta[k] = entry[k];
    meta.savedAt = meta.savedAt || (blob && blob.savedAt) || Date.now();
    var rest = idx.filter(function (s) { return s.id !== entry.id; });
    rest.push(meta);
    try { writeIdx(rest); } catch (e2) {
      return { ok: false, msg: '浏览器本地空间不足（索引写不进），删几份旧档再试。' };
    }
    return { ok: true };
  }

  /** 取正文；没有/坏了返回 null，不抛 */
  function get(id) {
    try {
      var raw = ls().getItem(BLOB_PREFIX + id);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function remove(id) {
    try { ls().removeItem(BLOB_PREFIX + id); } catch (e) { /* ignore */ }
    writeIdx(readIdx().filter(function (s) { return s.id !== id; }));
  }

  /* 迁移旗：只许「真跑过一轮导入」才插；网络失败不插（下个启动再试，
     put 幂等，重导最多覆盖同名档）——主人档一个都不能静默消失。 */
  function migrated() {
    try { return ls().getItem(MIG_KEY) === '1'; } catch (e) { return true; }
  }
  function markMigrated() {
    try { ls().setItem(MIG_KEY, '1'); } catch (e) { /* ignore */ }
  }

  global.WXSAVE = {
    list: list, put: put, get: get, remove: remove,
    hasAny: hasAny, migrated: migrated, markMigrated: markMigrated,
    /* 挂出来只为测试断言键名（守卫要用），业务代码一律走方法 */
    KEYS: { IDX_KEY: IDX_KEY, BLOB_PREFIX: BLOB_PREFIX, MIG_KEY: MIG_KEY, SCHEMA: SCHEMA, MAX_SAVES: MAX_SAVES },
  };

})(window);
