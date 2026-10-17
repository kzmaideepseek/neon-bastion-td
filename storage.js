/* ============================================================
   storage.js — 长期存档（localStorage）
   存档内容：设置 / 晶核 / 已解锁炮塔 / 天赋 / 关卡进度 / 成就 / 统计
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var KEY = 'neon_bastion_save_v1';
  var S = NB.Save = {};

  /* ---------- 默认存档 ---------- */
  S.defaults = function () {
    return {
      ver: 1,
      created: Date.now(),
      plays: 0,
      /* 新档启动资金：足以解锁前两件装备，避免卡死在商城 */
      starter: true,
      settings: {
        master: 0.75,
        bgm: 0.42,
        sfx: 0.70,
        shake: true,
        quality: 'high'   // high | low
      },
      /* 资源：晶核为跨关卡永久货币 */
      cores: 220,
      lifetimeGold: 0,
      /* 已授权炮塔 */
      unlocked: ['plasma'],
      /* 天赋等级 {key: lv} */
      talents: {},
      /* 关卡进度 { id: {clear:bool, stars:n, best:seconds, plays:n} } */
      levels: {},
      /* 成就 { key: true } */
      ach: {},
      /* 统计 */
      stats: { kills: 0, towers: 0, damage: 0, wins: 0, losses: 0, bestWave: 0, goldEarned: 0 }
    };
  };

  /* ---------- 深合并，保证向前兼容 ---------- */
  function merge(def, cur) {
    if (cur === undefined || cur === null) return def;
    if (Array.isArray(def)) return Array.isArray(cur) ? cur.slice() : def.slice();
    if (typeof def !== 'object') return cur;
    if (typeof cur !== 'object') return def;
    var out = {}, k;
    for (k in def) if (def.hasOwnProperty(k)) out[k] = merge(def[k], cur[k]);
    for (k in cur) if (!(k in out)) out[k] = cur[k];
    return out;
  }
  S.merge = merge;

  /* ---------- 读写 ---------- */
  var data = null;
  var available = true;

  S.available = function () { return available; };

  S.load = function () {
    var raw = null;
    try { raw = w.localStorage.getItem(KEY); }
    catch (e) { available = false; console.warn('[Save] localStorage 不可用，使用内存存档'); }
    if (!raw) { data = S.defaults(); S.save(); return data; }
    try {
      data = merge(S.defaults(), JSON.parse(raw));
    } catch (e) {
      console.warn('[Save] 存档损坏，已重置', e);
      data = S.defaults();
    }
    return data;
  };

  S.get = function () { if (!data) S.load(); return data; };

  var pending = 0;
  S.save = function (immediate) {
    if (!data) return;
    if (!available) return;
    if (immediate) { doWrite(); return; }
    if (pending) return;
    pending = w.setTimeout(function () { pending = 0; doWrite(); }, 220);
  };
  function doWrite() {
    try { w.localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { console.warn('[Save] 写入失败', e); }
  }

  S.reset = function () {
    data = S.defaults();
    S.save(true);
  };

  S.exportText = function () {
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(S.get())))); }
    catch (e) { return ''; }
  };
  S.importText = function (txt) {
    try {
      var obj = JSON.parse(decodeURIComponent(escape(atob(txt.trim()))));
      if (!obj || typeof obj !== 'object' || !obj.settings) return false;
      data = merge(S.defaults(), obj);
      S.save(true);
      return true;
    } catch (e) { return false; }
  };

  /* ---------- 关卡记录 ---------- */
  S.level = function (id) {
    var d = S.get();
    if (!d.levels[id]) d.levels[id] = { clear: false, stars: 0, best: 0, plays: 0 };
    return d.levels[id];
  };

  S.maxLevelUnlocked = function () {
    var d = S.get(), i = 1;
    while (i < NB.CFG.LEVELS.length && S.level(i).clear) i++;
    return Math.min(i, NB.CFG.LEVELS.length);
  };

  S.totalStars = function () {
    var d = S.get(), n = 0;
    for (var i = 0; i < NB.CFG.LEVELS.length; i++) {
      var r = d.levels[i + 1];
      if (r && r.clear) n += (r.stars | 0);
    }
    return n;
  };
  S.maxStars = function () { return NB.CFG.LEVELS.length * 3; };

  S.clearCount = function () {
    var d = S.get(), n = 0;
    for (var i = 0; i < NB.CFG.LEVELS.length; i++) {
      if (d.levels[i + 1] && d.levels[i + 1].clear) n++;
    }
    return n;
  };

  /* ---------- 成就解锁（首次触发返回 true） ---------- */
  S.unlockAch = function (key) {
    var d = S.get();
    if (d.ach[key]) return false;
    d.ach[key] = true;
    S.save();
    var a = NB.CFG.ACHIEVEMENTS[key];
    if (a && NB.UI && NB.UI.toast) NB.UI.toast('成就达成：' + a.name, 'gd', 3200);
    return true;
  };

  S.addCores = function (n) {
    var d = S.get();
    d.cores = Math.max(0, d.cores + n);
    S.save();
    return d.cores;
  };

  S.isUnlocked = function (id) {
    return S.get().unlocked.indexOf(id) >= 0;
  };

  S.hasTower = function (id) {
    var i = S.get().unlocked.indexOf(id);
    return i >= 0;
  };

  S.talent = function (key) { return S.get().talents[key] | 0; };

  /* 天赋是否满级 */
  S.talentMaxed = function (key) {
    var def = NB.CFG.TALENTS[key];
    return !!def && S.talent(key) >= def.max;
  };

  /* 自动存档（关卡内周期性 / 离开页面） */
  w.addEventListener('beforeunload', function () { doWrite(); endlessFlush(); });
  w.addEventListener('visibilitychange', function () { if (document.hidden) { doWrite(); endlessFlush(); } });

  /* ============================================================
     无尽模式存档槽
     —— 独立长期键，与主存档分离，避免相互污染
     —— 每个槽位：名称 / 地图 / 难度 / 波号 / 击杀 / 完整对局快照
     ============================================================ */
  var ENDLESS_KEY = 'neon_bastion_endless_v1';
  var endlessData = null;

  function endlessDefaults() {
    return { ver: 1, slots: [], best: { wave: 0, kills: 0 } };
  }
  function endlessLoad() {
    if (endlessData) return endlessData;
    try {
      var raw = w.localStorage.getItem(ENDLESS_KEY);
      endlessData = raw ? merge(endlessDefaults(), JSON.parse(raw)) : endlessDefaults();
    } catch (e) {
      console.warn('[Save] 无尽存档读取失败，已重置', e);
      endlessData = endlessDefaults();
    }
    return endlessData;
  }
  function endlessFlush() {
    if (!endlessData) return false;
    try { w.localStorage.setItem(ENDLESS_KEY, JSON.stringify(endlessData)); return true; }
    catch (e) { console.warn('[Save] 无尽存档写入失败', e); return false; }
  }

  /* 槽位列表（按更新时间倒序） */
  S.endlessSlots = function () {
    var d = endlessLoad();
    return d.slots.slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
  };
  S.endlessSlot = function (id) {
    var d = endlessLoad();
    for (var i = 0; i < d.slots.length; i++) if (d.slots[i].id === id) return d.slots[i];
    return null;
  };
  S.endlessSlotCount = function () { return endlessLoad().slots.length; };

  /* 新建槽位，返回 id */
  S.endlessCreate = function (name, data) {
    var d = endlessLoad();
    var now = Date.now();
    var slot = {
      id: 'es' + now.toString(36) + Math.floor(Math.random() * 1296).toString(36),
      name: name || '无尽存档',
      created: now, updated: now,
      layout: data.layout, variant: data.variant, difficulty: data.difficulty,
      waveNo: data.waveNo || 0, kills: data.kills || 0,
      data: data
    };
    d.slots.push(slot);
    endlessFlush();
    return slot.id;
  };

  /* 更新槽位数据 */
  S.endlessUpdate = function (id, data) {
    var d = endlessLoad();
    for (var i = 0; i < d.slots.length; i++) {
      var s = d.slots[i];
      if (s.id === id) {
        s.updated = Date.now();
        s.layout = data.layout;
        s.variant = data.variant;
        s.difficulty = data.difficulty;
        s.waveNo = data.waveNo || 0;
        s.kills = data.kills || 0;
        s.data = data;
        endlessFlush();
        return true;
      }
    }
    return false;
  };

  /* 重命名 */
  S.endlessRename = function (id, name) {
    var d = endlessLoad();
    for (var i = 0; i < d.slots.length; i++) {
      if (d.slots[i].id === id) {
        d.slots[i].name = String(name || '').trim().slice(0, 24) || '无尽存档';
        d.slots[i].updated = Date.now();
        endlessFlush();
        return true;
      }
    }
    return false;
  };

  /* 删除 */
  S.endlessDelete = function (id) {
    var d = endlessLoad();
    for (var i = 0; i < d.slots.length; i++) {
      if (d.slots[i].id === id) {
        d.slots.splice(i, 1);
        endlessFlush();
        return true;
      }
    }
    return false;
  };

  /* 最高波数记录 */
  S.endlessBest = function () { return endlessLoad().best; };
  S.endlessSetBest = function (b) {
    var d = endlessLoad();
    var cur = d.best || { wave: 0, kills: 0 };
    if ((b.wave || 0) > (cur.wave || 0) || ((b.wave || 0) === (cur.wave || 0) && (b.kills || 0) > (cur.kills || 0))) {
      d.best = { wave: b.wave || 0, kills: b.kills || 0 };
      endlessFlush();
    }
  };

})(window);
