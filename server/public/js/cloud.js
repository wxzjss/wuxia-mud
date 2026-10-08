/* ==========================================================================
   武侠行 Mod 站 · 云服务接入层
   --------------------------------------------------------------------------
   把 Mod 数据从「本地 JSON 文件」升级成「云端数据库」。

   设计原则：**云端为主，本地为缓存**
     - 站点通过 HTTP 服务打开时（127.0.0.1:8788 / 已发布域名），云端可用 → 走云端
     - 直接用 file:// 打开时云端跨域受限 → 自动回落到本地 API，页面不会白屏

   注意：本站是单机 Mod 站，**没有账号 / 登录 / 论坛**，
   这里只保留 Mod 表（mods）的读写。

   依赖：WorkBuddy Cloud SDK（CDN 形式，无需构建）
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---- publicConfig：由云服务开通时下发，只有这四个字段可以进前端 ---- */
  const PUBLIC_CONFIG = {
    resourceId: 'wbcs_3RWsA2YKH53zuaxrPTtkgp',
    endpoint: 'https://wuxia-mod.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_Z80rz4fz3u01PNkado5Qxj_Am8VgfxuBn1QlKHQ3dwT7ALghzvCKxMY'
  };

  const TABLE = 'mods';           /* Mod 表 */

  let cloud = null;
  let ready = false;
  let initError = null;

  /* ------------------------------------------------------------------ *
   * 初始化
   * ------------------------------------------------------------------ */
  function isHttp() {
    return location.protocol === 'http:' || location.protocol === 'https:';
  }

  function init() {
    /* 非 http(s) 环境（file://）直接判定云端不可用，避免无意义的跨域报错 */
    if (!isHttp()) {
      initError = new Error('当前不是 http(s) 环境，云端不可用');
      ready = true;
      return Promise.resolve(false);
    }
    if (!global.WorkBuddyCloud || !global.WorkBuddyCloud.createWorkBuddyCloud) {
      initError = new Error('云 SDK 未加载（CDN 不可达？）');
      ready = true;
      return Promise.resolve(false);
    }
    try {
      cloud = global.WorkBuddyCloud.createWorkBuddyCloud({
        endpoint: PUBLIC_CONFIG.endpoint,
        oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
        publishableKey: PUBLIC_CONFIG.publishableKey
      });
      ready = true;
      return Promise.resolve(true);
    } catch (e) {
      initError = e;
      ready = true;
      return Promise.resolve(false);
    }
  }

  function available() { return !!cloud; }
  function lastError() { return initError; }

  /* ------------------------------------------------------------------ *
   * 数据映射：云端行 <-> 页面用的 mod 结构
   * ------------------------------------------------------------------ */
  function rowToMod(r) {
    return {
      id: r.mod_key,
      name: r.name,
      version: r.version || '1.0.0',
      author: r.author || r.owner_name || '佚名',
      category: r.category || '综合',
      desc: r.description || '',
      tags: r.tags || [],
      counts: r.counts || {},
      content: r.content || null,   /* 完整 mod.json 内容（详情页 / 导出用） */
      downloads: r.downloads || 0,
      time: r.created_at ? new Date(r.created_at).getTime() : 0,
      updated: r.updated_at ? new Date(r.updated_at).getTime() : 0,
      ownerId: r.owner_id,
      _row: r
    };
  }


  function unwrap(res) {
    if (!res) throw new Error('云服务没有响应');
    if (res.error) throw new Error(res.error.message || String(res.error));
    return res.data;
  }

  /* ------------------------------------------------------------------ *
   * 数据库操作
   * ------------------------------------------------------------------ */
  const db = {
    /** 列表：支持关键词、分类、排序、分页 */
    async list(opts) {
      opts = opts || {};
      const page = Math.max(1, parseInt(opts.page, 10) || 1);
      const size = Math.min(60, Math.max(1, parseInt(opts.size, 10) || 12));
      const from = (page - 1) * size;
      const to = from + size - 1;

      let qy = cloud.database.from(TABLE).select('*', { count: 'exact' });

      if (opts.q) {
        const kw = String(opts.q).replace(/[%,()]/g, '');
        qy = qy.or('name.ilike.%' + kw + '%,description.ilike.%' + kw + '%,author.ilike.%' + kw + '%');
      }
      if (opts.cat) qy = qy.eq('category', opts.cat);

      const sort = opts.sort || 'new';
      if (sort === 'hot') qy = qy.order('downloads', { ascending: false });
      else if (sort === 'name') qy = qy.order('name', { ascending: true });
      else if (sort === 'update') qy = qy.order('updated_at', { ascending: false });
      else qy = qy.order('created_at', { ascending: false });

      const res = await qy.range(from, to);
      const rows = unwrap(res);
      return {
        total: (res && res.count) || (rows || []).length,
        page: page, size: size,
        mods: (rows || []).map(rowToMod)
      };
    },

    /** 详情：按 mod_key 取一条 */
    async detail(key) {
      const res = await cloud.database.from(TABLE).select('*').eq('mod_key', key).maybeSingle();
      const row = unwrap(res);
      return row ? rowToMod(row) : null;
    },

    /** 发布 / 更新（单机站：任何人可发，同名 key 直接覆盖） */
    async publish(m) {
      if (!available()) throw new Error('云端未连接');

      const payload = {
        mod_key: m.id,
        name: m.name,
        version: m.version || '1.0.0',
        author: m.author || '匿名侠客',
        owner_name: (m.author || '匿名侠客'),
        category: m.category || '综合',
        description: m.desc || '',
        tags: m.tags || [],
        counts: m.counts || {},
        content: m.content || {},
        updated_at: new Date().toISOString()
      };
      /* 注意：绝不传 owner_id，由数据库 DEFAULT auth.uid() 填 */

      const existing = await this.detail(m.id);
      if (existing) {
        const res = await cloud.database.from(TABLE)
          .update(payload).eq('mod_key', m.id).select();
        const rows = unwrap(res);
        if (!Array.isArray(rows) || rows.length === 0) {
          throw new Error('更新失败，请稍后重试');
        }
        return { id: m.id, updated: true, mod: rowToMod(rows[0]) };
      }

      const res = await cloud.database.from(TABLE).insert(payload).select();
      const rows = unwrap(res);
      if (!rows || !rows.length) throw new Error('发布失败，请稍后重试');
      return { id: m.id, updated: false, mod: rowToMod(rows[0]) };
    },

    /** 删除 */
    async remove(key) {
      const res = await cloud.database.from(TABLE)
        .delete().eq('mod_key', key).select();
      const rows = unwrap(res);
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('删除失败，请稍后重试');
      }
      return { ok: true, removed: rows.length };
    },

    /** 下载 +1（用 SECURITY DEFINER 函数，允许给别人的 Mod 计数） */
    async bumpDownload(key) {
      if (!available()) return 0;
      try {
        const res = await cloud.database.rpc('bump_mod_downloads', { p_key: key });
        const v = unwrap(res);
        return Array.isArray(v) ? (v[0] || 0) : (v || 0);
      } catch (e) {
        return 0;
      }
    },

    /** 分类统计 */
    async categories() {
      const res = await cloud.database.from(TABLE).select('category');
      const rows = unwrap(res) || [];
      const map = {};
      rows.forEach(r => {
        const c = r.category || '综合';
        map[c] = (map[c] || 0) + 1;
      });
      return Object.keys(map).map(k => ({ name: k, count: map[k] }))
        .sort((a, b) => b.count - a.count);
    },

    /** 站点统计 + 榜单 */
    async stats() {
      const res = await cloud.database.from(TABLE)
        .select('mod_key,name,author,category,description,version,tags,counts,downloads,created_at,updated_at,owner_id', { count: 'exact' })
        .order('created_at', { ascending: false });
      const rows = unwrap(res) || [];
      const mods = rows.map(rowToMod);

      const tagMap = {};
      mods.forEach(m => (m.tags || []).forEach(t => { tagMap[t] = (tagMap[t] || 0) + 1; }));
      const topTags = Object.keys(tagMap).map(t => ({ tag: t, count: tagMap[t] }))
        .sort((a, b) => b.count - a.count).slice(0, 16);

      const authors = new Set(mods.map(m => m.ownerId).filter(Boolean));

      return {
        mods: mods.length,
        downloads: mods.reduce((s, m) => s + (m.downloads || 0), 0),
        authors: authors.size,
        topTags: topTags,
        latest: mods.slice(0, 8),
        hot: mods.slice().sort((a, b) => (b.downloads || 0) - (a.downloads || 0)).slice(0, 8)
      };
    }
  };


  /* ------------------------------------------------------------------ *
   * 导出
   * ------------------------------------------------------------------ */
  global.WXCLOUD = {
    PUBLIC_CONFIG: PUBLIC_CONFIG,
    init: init,
    available: available,
    isReady: function () { return ready; },
    lastError: lastError,
    db: db
  };

})(window);
