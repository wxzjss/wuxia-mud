/* ==========================================================================
   武侠行 · 游戏端云服务接入层（登录 + 云存档）

   职责：
     1. 懒加载 WorkBuddy Cloud SDK（CDN，jsdelivr → unpkg 双兜底）
     2. 极简登录：手机短信验证码（signInWithOtp）+ 微信扫码（signInWithOAuth）
     3. 云存档：登录用户把存档 upsert 到 saves 表，按 owner_id 隔离

   与 Mod 站 cloud.js 的区别：这里管「saves」表 + 登录，
   站点那份只管「mods」表。两者共用同一个应用环境（同一 publicConfig）。

   注意：本机直连云服务不通（握手失败），登录/存档只在浏览器里生效；
   未登录时自动降级为「仅本地存档」，不影响游戏本体。
   ========================================================================== */
(function (global) {
  'use strict';

  /* 同一应用的 publicConfig（与 server/public/js/cloud.js 完全一致） */
  const PUBLIC_CONFIG = {
    resourceId: 'wbcs_3RWsA2YKH53zuaxrPTtkgp',
    endpoint: 'https://wuxia-mod.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_Z80rz4fz3u01PNkado5Qxj_Am8VgfxuBn1QlKHQ3dwT7ALghzvCKxMY'
  };
  const TABLE = 'saves';

  let cloud = null;
  let initPromise = null;

  /* ---- 懒加载 SDK ---- */
  function loadSdk() {
    if (global.WorkBuddyCloud) return Promise.resolve(true);
    return new Promise((resolve) => {
      const srcs = [
        'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js',
        'https://unpkg.com/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js'
      ];
      let i = 0;
      const tryNext = () => {
        if (i >= srcs.length) { resolve(false); return; }
        const s = document.createElement('script');
        s.src = srcs[i++];
        s.onload = () => resolve(true);
        s.onerror = () => tryNext();
        document.head.appendChild(s);
      };
      tryNext();
    });
  }

  async function init() {
    if (cloud) return true;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        if (location.protocol !== 'http:' && location.protocol !== 'https:') return false;
        const ok = await loadSdk();
        if (!ok || !global.WorkBuddyCloud) return false;
        cloud = global.WorkBuddyCloud.createWorkBuddyCloud({
          endpoint: PUBLIC_CONFIG.endpoint,
          oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
          publishableKey: PUBLIC_CONFIG.publishableKey
        });
        return true;
      } catch (e) {
        return false;
      }
    })();
    return initPromise;
  }

  function available() { return !!cloud; }

  /* ---- 登录 ---- */
  const auth = {
    /** 当前会话（未登录返回 null） */
    async session() {
      if (!cloud) return null;
      try {
        const { data, error } = await cloud.auth.getSession();
        if (error || !data) return null;
        return data;
      } catch (e) { return null; }
    },
    /** 当前用户 */
    async user() {
      if (!cloud) return null;
      try {
        const { data, error } = await cloud.auth.getUser();
        if (error) return null;
        return data;
      } catch (e) { return null; }
    },
    /** 手机验证码：发码（返回 challenge，供 verify 用） */
    async sendPhoneCode(phone) {
      const { data, error } = await cloud.auth.signInWithOtp({ phone });
      return { data, error };
    },
    /** 手机验证码：提交验证（challenge 来自 sendPhoneCode 的 data） */
    async verifyPhone(challenge, token) {
      return await challenge.verify({ token });
    },
    /** 微信登录：拿跳转 URL */
    async wechatUrl() {
      const { data, error } = await cloud.auth.signInWithOAuth({
        provider: 'wechat',
        redirectTo: location.origin
      });
      return { data, error };
    },
    /** 微信回调：每次启动都要无条件调一次 */
    async handleWechatCallback() {
      const { data, error } = await cloud.auth.handleWechatWebCallback();
      return { session: data, error };
    },
    async signOut() {
      const { error } = await cloud.auth.signOut();
      return { error };
    }
  };

  /* ---- 云存档 ---- */
  const saves = {
    /** upsert：按 save_key 覆盖当前登录用户的一份存档 */
    async upsert(key, data, meta) {
      if (!cloud) throw new Error('云端未连接');
      const payload = {
        save_key: key,
        data: data || {},
        player_name: (meta && meta.name) || null,
        level: (meta && meta.level) || 1,
        room: (meta && meta.room) || '',
        play_time: (meta && meta.playTime) || 0,
        updated_at: new Date().toISOString()
      };
      const existing = await cloud.database.from(TABLE)
        .select('id').eq('save_key', key).maybeSingle();
      if (existing && existing.data) {
        await cloud.database.from(TABLE)
          .update(payload).eq('save_key', key).select();
      } else {
        await cloud.database.from(TABLE).insert(payload).select();
      }
      return { ok: true };
    },
    /** 读一份云存档 */
    async load(key) {
      if (!cloud) throw new Error('云端未连接');
      const res = await cloud.database.from(TABLE)
        .select('*').eq('save_key', key).maybeSingle();
      if (!res || !res.data) return null;
      return res.data;
    },
    /** 当前登录用户的云存档列表 */
    async list() {
      if (!cloud) return [];
      const res = await cloud.database.from(TABLE)
        .select('*').order('updated_at', { ascending: false });
      return res && res.data ? res.data : [];
    }
  };

  global.WXCLOUD = {
    PUBLIC_CONFIG,
    init, available, auth, saves
  };
})(window);
