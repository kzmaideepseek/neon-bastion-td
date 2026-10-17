/* ============================================================
   game.js — 游戏主控制器
   负责：状态机、主循环、输入处理、波次调度、结算、存档写入
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U, C = NB.CFG, FX = NB.FX, P = NB.Path, Ent = NB.Ent, Waves = NB.Waves, R = NB.Render, Save = NB.Save;
  var G = NB.Game = {};

  var canvas = null, wrap = null, ctx = null;
  var raf = 0, lastT = 0, acc = 0, lastRafTs = 0;
  var STEP = 1 / 60;

  G.state = null;

  /* ---------- 初始化 ---------- */
  G.init = function () {
    canvas = U.$('#stage');
    wrap = U.$('#stage-wrap');
    resize();
    w.addEventListener('resize', function () { resize(); });
    bindInput();
    loop(0);
  };

  function resize() {
    var r = R.fit(wrap, canvas);
    if (r) ctx = r.ctx;
  }
  G.resize = resize;

  /* ============================================================
     开局
     ============================================================ */
  /* ============================================================
     开局
     cfg: { variant, difficulty }            闯关模式
          { endless:true, layout, variant, difficulty }   无尽·新开局
          { endless:true, save: slotId }                  无尽·读取存档
     ============================================================ */
  G.start = function (levelId, cfg) {
    NB.Perf && NB.Perf.reset();
    cfg = cfg || {};
    var endless = !!cfg.endless;
    var lv, variant, diff, slot = null, bindSlot = null;

    if (endless) {
      /* ---- 无尽模式：合成关卡对象 ---- */
      diff = C.DIFFICULTIES[cfg.difficulty || 'normal'] || C.DIFFICULTIES.normal;
      lv = endlessLevel(cfg.layout || 'A');
      if (cfg.save) {
        /* 读取存档：地图/难度/波号以存档为准 */
        slot = Save.endlessSlot(cfg.save);
        if (!slot) { endless = false; }
      }
      if (slot) {
        lv = endlessLevel(slot.layout);
        variant = slot.variant % NB.Path.variantCount();
        diff = C.DIFFICULTIES[slot.difficulty] || diff;
      } else {
        variant = (typeof cfg.variant === 'number')
          ? (cfg.variant % NB.Path.variantCount())
          : 0;
      }
      /* 新开局绑定已建档的空槽位（不恢复数据） */
      if (!slot && cfg.newSlot && Save.endlessSlot(cfg.newSlot)) {
        bindSlot = cfg.newSlot;
      }
    } else {
      lv = C.LEVELS.filter(function (l) { return l.id === levelId; })[0] || C.LEVELS[0];
      diff = C.DIFFICULTIES[cfg.difficulty || 'normal'] || C.DIFFICULTIES.normal;
      variant = (typeof cfg.variant === 'number')
        ? (cfg.variant % NB.Path.variantCount())
        : ((lv.id - 1) % NB.Path.variantCount());
    }

    var rec = Save.level(lv.id);
    if (!endless) rec.plays = (rec.plays || 0) + 1;

    var mods = C.mods();
    var bonusLives = Save.talent('repair');
    var startLives = Math.max(1, Math.min(99, lv.lives + bonusLives + diff.livesBonus));
    var startGold = Math.round(lv.startGold * diff.goldMul);

    var st = {
      level: lv,
      difficulty: diff,
      variant: variant,
      endless: endless,
      saveSlot: bindSlot || (slot ? slot.id : null),
      map: P.get(lv.layout, variant),
      status: 'playing',
      mods: mods,
      towers: [],
      enemies: [],
      bullets: [],
      /* 多出生点：默认只激活主路径；其余由中继站解锁 */
      activeSpawns: [0],
      /* 双开叠加：'gx,gy' -> true 表示该格可建第二座塔 */
      stacked: {},
      /* 信标光环脏标记：塔/信标变化时置 null 触发重算，避免逐帧 O(塔^2) */
      _beaconSig: null,
      /* 突袭刷新标记（渲染红色警示） */
      raidMarks: [],
      /* 轨道轰炸：延迟落点 */
      strikes: [],
      /* 逆转（回溯）：每 2.5s 一份快照，保留 5 分钟；每局 3 次 */
      rewind: { snaps: [], t: 0, left: 3 },
      gold: startGold,
      lives: startLives,
      maxLives: startLives,
      livesFrac: 0,             /* 修复厂恢复基地的小数累积 */
      kills: 0,
      waveKills: 0,
      leaks: 0,
      damageDealt: 0,
      waveIndex: -1,
      waveNo: 0,                /* 绝对波号（无尽模式显示与存档用） */
      waveT: 0,
      nextWaveT: 4.0,
      waveActive: false,
      waves: endless
        ? Waves.buildEndless(0, C.ENDLESS.batchSize, diff.key)
        : Waves.build(lv, { attackerRate: diff.attackerRate }),
      /* 攻击型敌人开关：由难度决定 */
      allowAttackers: diff.attackerRate > 0,
      attackerRate: diff.attackerRate,
      pendingSpawns: [],
      time: 0,
      playTime: 0,
      buildType: null,
      selected: null,
      hoverTower: null,
      shakeAmt: 0,
      shakeT: 0,
      shakeDur: 0.18,
      /* 震动只作用于画布内容（ctx.translate），不触碰任何 DOM/窗口。
         上限 6px —— 再大就会让地图边缘「爬行」，看起来像窗口在晃。 */
      SHAKE_MAX: 6,
      speed: 1,
      pauseReason: null,
      result: null,
      autoSaveT: 0,
      /* 震动：仅画布内位移，幅度封顶，绝不影响窗口/布局 */
      shake: function (amt) {
        var set = Save.get().settings;
        if (set && set.shake === false) return;
        var cap = st.SHAKE_MAX || 6;
        var a = Math.min(cap, Math.abs(amt) || 0);
        if (a <= 0) return;
        st.shakeAmt = Math.max(st.shakeAmt, a);
        st.shakeDur = 0.16 + a * 0.012;          /* 力度越大持续越久 */
        st.shakeT = Math.max(st.shakeT, st.shakeDur);
      },
      towerAt: function (gx, gy) {
        for (var i = 0; i < st.towers.length; i++) {
          if (st.towers[i].gx === gx && st.towers[i].gy === gy) return st.towers[i];
        }
        return null;
      },
      /* 同格全部塔（双开叠加后一格可有两座） */
      towersAt: function (gx, gy) {
        var out = [];
        for (var i = 0; i < st.towers.length; i++) {
          if (st.towers[i].gx === gx && st.towers[i].gy === gy) out.push(st.towers[i]);
        }
        return out;
      },
      towerCountAt: function (gx, gy) {
        var c = 0;
        for (var i = 0; i < st.towers.length; i++) {
          if (st.towers[i].gx === gx && st.towers[i].gy === gy) c++;
        }
        return c;
      },
      /* 随机选一条已激活的敌人路径 */
      pickSpawn: function () {
        var a = st.activeSpawns;
        if (!a || !a.length) return 0;
        return a[Math.floor(Math.random() * a.length)];
      },
      /* 信标光环查询：返回该位置的伤害/射速加成倍率增量 */
      boostAt: function (x, y) {
        var best = null;
        for (var i = 0; i < st.towers.length; i++) {
          var t = st.towers[i];
          if (t.kind !== 'beacon' || t.buildT > 0) continue;
          var s = t.stats();
          var r = s.range;
          var dx = t.x - x, dy = t.y - y;
          if (dx * dx + dy * dy > r * r) continue;
          if (!best || s.boost > best.dmg) best = { dmg: s.boost, rate: s.boostRate };
        }
        return best;
      },
      onKill: function (e, gold) {
        FX.coin(e.x, e.y - 6, gold);
        st.kills++;
        /* 累计击杀实时计数 + 每 25 个落盘一次（避免高频写 localStorage） */
        var dd = Save.get();
        dd.stats.kills = (dd.stats.kills || 0) + 1;
        if (dd.stats.kills >= 1000) Save.unlockAch('kills1000');
        if (dd.stats.kills >= 5000) Save.unlockAch('kills5000');
        if (st.kills % 25 === 0) Save.save(true);
        if (e.shape === 'boss') {
          NB.UI.toast('BOSS 已被摧毁！', 'gr', 2200);
        }
      },
      onLeak: function (e) {
        NB.UI.hudFlash('life');
        if (st.lives <= 0) {
          st.lives = 0;
          G.lose();
        } else {
          NB.UI.toast('基地受损 -' + e.dmg + ' 耐久', 'rd', 1400);
        }
      },
      onUpgrade: function () { },
    };

    G.state = st;
    Save.get().plays++;
    Save.save();

    /* 存档恢复：炮塔 / 敌人 / 波次进度 / 资源 */
    if (slot) restoreState(st, slot);

    NB.Audio.playMusic('battle');
    /* 每局重置交互模式。原先这三行 + 下面五行业务代码散落在函数尾部的
       错位缩进段里，且 syncModeClass / G.moveMode / G.toggleMoveMode 曾被误嵌进
       本函数体内，导致每次开局都重复定义一遍 —— 现已移到模块级（见下方独立段落）。 */
    G.shovelMode = false;
    G.stackMode = false;
    G.moveMode = false;
    G.buildType = null;
    /* 清掉上一局可能残留的模式 class */
    if (canvas) {
      canvas.classList.remove('shovel-mode');
      canvas.classList.remove('stack-mode');
      canvas.classList.remove('build-mode');
    }
    NB.UI.buildBarRender();
    NB.UI.hudSync();
    NB.UI.nextWaveShow(st);
    resize();
    return st;
  };

  /* ============================================================
     模式 -> CSS class 同步（光标与边框辉光由 CSS 负责，开销极低）
     ============================================================ */
  var wrapEl = null;
  function syncModeClass() {
    if (!canvas) return;
    if (!wrapEl) wrapEl = document.getElementById('stage-wrap') || canvas.parentNode;
    if (!wrapEl) return;
    var k = '';
    if (G.shovelMode) k = 'mv-shovel';
    else if (G.stackMode) k = 'mv-stack';
    else if (G.moveMode && G.selected && G.selected.flying) k = 'mv-move';
    else if (G.buildType) k = 'mv-build';
    wrapEl.className = (wrapEl.className || '').replace(/\bmv-[a-z]+\b/g, '').trim() + (k ? ' ' + k : '');
    canvas.className = (canvas.className || '')
      .replace(/\bcur-[a-z]+\b/g, '')
      .replace(/\bbuild-mode\b/g, '')
      .replace(/\bstack-mode\b/g, '')
      .replace(/\bshovel-mode\b/g, '').trim()
      + (k ? ' ' + k.replace('mv-', 'cur-') : '')
      + (G.buildType ? ' build-mode' : '')
      + (G.stackMode ? ' stack-mode' : '');
    void wrapEl;
  }
  G.syncModeClass = syncModeClass;

  /* 交互模式状态：模块级，只初始化一次（原先写在 G.start 内） */
  G.moveMode = false;
  G.stackMode = false;
  G.shovelMode = false;

  /* 进入/退出「转移模式」：选中空中单位后，顶栏/侧栏按钮或 R 键切换。
     开启后鼠标悬停任意格都会显示可落点判定与落点预览。 */
  G.toggleMoveMode = function () {
    var st = G.state;
    if (!st || st.status !== 'playing') return false;
    if (!G.selected || !G.selected.flying) {
      NB.Audio.play('uiDenied');
      NB.UI.toast('只有空中单位可以转移', 'rd', 1500);
      return false;
    }
    G.moveMode = !G.moveMode;
    if (G.moveMode) {
      G.buildType = null; G.stackMode = false; G.shovelMode = false;
      canvas.classList.remove('build-mode');
      canvas.classList.remove('stack-mode');
      canvas.classList.remove('shovel-mode');
      NB.UI.toast('转移模式：点击目标格移动 ' + G.selected.def.name, 'cy', 2000);
    } else {
      NB.UI.toast('已退出转移模式', 'nd', 1100);
    }
    NB.Audio.sfx('uiClick', 40);
    syncModeClass();
    NB.UI.buildBarRender();
    return G.moveMode;
  };

  /* 无尽模式合成关卡（闯关的 LEVELS 不适用） */
  function endlessLevel(layout) {
    var E = C.ENDLESS;
    return {
      id: 0, name: '无尽模式', diff: 0, layout: layout, waves: Infinity,
      hpMul: 1, spMul: 1, startGold: E.startGold, lives: E.lives,
      reward: 0, comp: E.comp, endless: true,
      desc: '波次无限、强度持续成长。守住反应堆，挑战你的极限波数。'
    };
  }
  G.endlessLevel = endlessLevel;

  /* ============================================================
     帧率监测 + 自适应画质
     ------------------------------------------------------------
     测量：取 1 秒窗口内帧间隔的**中位数**（不是平均值）。
     中位数对 GC 停顿、切换标签页、系统调度抖动天然免疫 ——
     早期版本用平均值，一个 500ms 卡顿就会把读数拉到 2 FPS，
     且由于窗口立即结算，误差会持续污染后续读数。

     降档顺序（从便宜到贵，先砍最不影响观感的）：
       0 high  粒子 100% / 动态装饰全开 / 装饰性叠加全开
       1 med   粒子 55%  / 动态装饰全开 / 关装饰性叠加（选中环、尾迹等）
       2 low   粒子 30%  / 动态装饰减半 / 关装饰性叠加 + 关辉光/光束贴花
     升级需要持续更高帧率，且带迟滞，避免在临界点反复横跳。
     ============================================================ */
  var Perf = NB.Perf = {
    fps: 60, ms: 16.7, tier: 0, auto: true,
    samples: [],          /* 当前窗口的帧间隔样本（ms） */
    _warm: 0,             /* 预热剩余（ms），预热期内不统计 */
    _since: 0,            /* 距上次结算的累计时长 */
    _low: 0, _high: 0, _cool: 0,
    _disp: 60,            /* 显示用缓动值 */
    _lastRaw: 0,
    units: 0, particles: 0,
    _outliers: 0        /* 本局被剔除的异常帧计数（诊断用） */
  };
  /* 四档：high / med / low / minimal
     minimal 不再降粒子（同 low 的 0.3），而是让渲染器跳过逐塔武器美术 ——
     剖析显示那是 120 塔场景下的真正大头。 */
  var TIERS = ['high', 'med', 'low', 'minimal'];
  var MAX_TIER = 3;
  var WARMUP_MS = 1200;      /* 忽略开局 1.2 秒（地图构建 / 首帧着色器编译） */
  var WIN_MS = 1000;         /* 统计窗口 1 秒 */
  var WIN_MIN_FRAMES = 12;   /* 中位数有意义所需的最小样本数 */
  var WIN_MIN_FRAMES_SLOW = 8;  /* 已经攒够 8 帧就允许按时间结算 */
  var FRAME_MIN = 0.5;       /* 小于 0.5ms 的间隔是异常值（同一时间戳），丢弃 */
  var FRAME_MAX = 400;       /* 大于 400ms 视为卡死/切后台，丢弃并重置窗口 */

  /* 各档具体砍了什么，用于给玩家的悬浮提示 */
  /* 各档简化内容由 UI 常驻说明展示，此处不再重复维护文案 */

  function applyTier(t, reason) {
    t = Math.max(0, Math.min(MAX_TIER, t | 0));
    if (t === Perf.tier) { applyTierState(t); return false; }
    Perf.tier = t;
    applyTierState(t);
    /* 画质说明由 UI 侧常驻显示（由 tier 状态驱动），此处不再弹一次性 toast。
       reason 保留用于将来区分自动降档 / 手动切换。 */
    void reason;
    NB.UI.perfNotice && NB.UI.perfNotice();
    return true;
  }
  function applyTierState(t) {
    R.setQuality(TIERS[t]);   /* render 内部按 tier 决定装饰动画频率 */
    NB.UI.fpsTick && NB.UI.fpsTick(Perf);
  }
  Perf.setTier = applyTier;
  Perf.setAuto = function (v) {
    Perf.auto = !!v;
    Perf._cool = 1.2;
    if (!v) NB.UI.fpsTick && NB.UI.fpsTick(Perf);
  };
  Perf.reset = function () {
    Perf.samples.length = 0;
    Perf._warm = WARMUP_MS;
    Perf._since = 0; Perf._low = 0; Perf._high = 0; Perf._cool = 1.2;
    Perf.fps = 60; Perf.ms = 16.7; Perf._disp = 60;
    Perf._outliers = 0;
  };

  function median(list) {
    var a = list.slice().sort(function (x, y) { return x - y; });
    var n = a.length;
    if (!n) return 0;
    return (n & 1) ? a[(n - 1) >> 1] : (a[n / 2 - 1] + a[n / 2]) * 0.5;
  }

  function perfSample(rawMs) {
    /* --- 预热期：不统计 --- */
    if (Perf._warm > 0) {
      Perf._warm -= rawMs;
      if (Perf._warm > 0) return;
      rawMs = -Perf._warm;         /* 预热剩余计入本窗起点，避免空窗 */
      Perf._warm = 0;
    }

    /* --- 剔除异常帧 --- */
    if (rawMs < FRAME_MIN) return;                       /* 时间戳重复 */
    if (rawMs > FRAME_MAX) {
      /* 巨帧（GC / 卡死 / 调度抖动）：**只跳过这一个样本**。
         早期实现在这里清空整个窗口，结果周期性尖峰会让窗口永远攒不满
         1000ms，fps 读数冻结在旧值不再更新（真机 30fps 却被报成 60）。
         中位数天然对离群值免疫，所以剔除样本即可，无需重置窗口。
         真正的标签页切换由 visibilitychange 单独重置（见 perfSuspend）。 */
      Perf._outliers++;
      return;
    }

    Perf.samples.push(rawMs);
    Perf._since += rawMs;
    Perf._lastRaw = rawMs;

    /* --- 结算：时间满 1 秒，且样本数足够让中位数有意义 ---
       真机很慢时（如 12fps）20 帧要等 1.6 秒才凑齐，会拖慢响应；
       所以放宽为「满 8 帧即可按时间结算」，兼顾准确与及时。 */
    var need = Perf._since >= WIN_MS * 2 ? WIN_MIN_FRAMES : WIN_MIN_FRAMES_SLOW;
    if (Perf._since < WIN_MS || Perf.samples.length < need) return;

    var med = median(Perf.samples);
    Perf.ms = med;
    Perf.fps = med > 0.01 ? Math.round(1000 / med) : 0;
    Perf.samples.length = 0;
    Perf._since = 0;

    /* --- 显示缓动：数字不跳变 --- */
    /* 显示缓动：指数逼近，但按帧率差自适应步长 ——
       差距大时收敛快（跟随真实掉帧），差距小时收敛慢（防止数字乱跳）。 */
    var gap = Perf.fps - Perf._disp;
    var k = (gap < 0 ? 0.62 : 0.5);      /* 掉帧比回升更敏感，掉档要及时可见 */
    Perf._disp += gap * k;
    if (Math.abs(gap) < 0.6) Perf._disp = Perf.fps;

    if (!Perf.auto) { NB.UI.fpsTick && NB.UI.fpsTick(Perf); return; }
    if (Perf._cool > 0) { Perf._cool -= 1; NB.UI.fpsTick && NB.UI.fpsTick(Perf); return; }

    /* --- 自适应：阈值下调到 38（中位数比平均值稳，可以更早动手） --- */
    if (Perf.fps < 38 && Perf.tier < MAX_TIER) {
      Perf._low++; Perf._high = 0;
      if (Perf._low >= 2) {          /* 连续 2 秒低于 38fps 才降档 */
        Perf._low = 0;
        applyTier(Perf.tier + 1, 'down');
        Perf._cool = 3;
      }
    } else if (Perf.fps > 56 && Perf.tier > 0) {
      Perf._high++; Perf._low = 0;
      if (Perf._high >= 6) {          /* 连续 6 秒高于 56fps 才升档 */
        Perf._high = 0;
        applyTier(Perf.tier - 1);
        Perf._cool = 5;
      }
    } else {
      Perf._low = 0; Perf._high = 0;
    }
    NB.UI.fpsTick && NB.UI.fpsTick(Perf);
  }

  /* 测试钩子：直接喂帧间隔，走与 rAF 主循环完全相同的采样路径 */
  Perf.feed = function (ms) { perfSample(ms); };

  /* 切换标签页 / 窗口时丢弃当前窗口，避免回来瞬间误判 */
  function perfSuspend() {
    Perf.samples.length = 0;
    Perf._since = 0;
    Perf._low = 0; Perf._high = 0;
    /* 切回来后前几帧往往还在补偿布局/重绘，跳过少量即可，不要太长 */
    Perf._warm = 200;
    Perf._disp = 0;      /* 下一帧立即重算显示值，不沿用切换前的读数 */
  }
  w.addEventListener('visibilitychange', function () { if (document.hidden) perfSuspend(); else perfSuspend(); });
  w.addEventListener('blur', perfSuspend);
  w.addEventListener('focus', perfSuspend);

  /* ============================================================
     主循环
     ============================================================ */
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (!lastT) lastT = ts;
    var dt = Math.min(0.1, (ts - lastT) / 1000);
    lastT = ts;

    NB.Audio.tickMusic(dt);

    if (!lastRafTs) lastRafTs = ts;
    var rawMs = ts - lastRafTs;
    lastRafTs = ts;
    perfSample(rawMs);

    var st = G.state;
    if (!st) return;

    if (st.status === 'playing') {
      var sd = dt * st.speed;
      /* 固定步长推进，保证高速下物理稳定 */
      acc += sd;
      var guard = 0;
      while (acc >= STEP && guard++ < 12) {
        update(STEP, st);
        acc -= STEP;
        if (st.status !== 'playing') break;
      }
      FX.update(sd);
      st.time += sd;
    } else {
      /* 非游玩状态仍推进粒子淡出 */
      FX.update(dt);
      st.time += dt * 0.4;
      if (st.status === 'paused') NB.UI.pulseModal();
    }

    draw(st);
  }

  /* ============================================================
     逻辑更新
     ============================================================ */
  function update(dt, st) {
    st.playTime += dt;

    /* 无尽模式：波表滚动补充（有界内存） */
    if (st.endless) refillWaves(st);

    /* --- 波次调度 --- */
    if (st.waveActive) {
      st.waveT += dt;
      /* 取出到点的生成指令 */
      var ps = st.pendingSpawns;
      while (ps.length && ps[0].t <= st.waveT) {
        var sp = ps.shift();
        spawnEnemy(st, sp.type, sp.elite);
      }
      /* 本波清空？ */
      if (ps.length === 0 && st.enemies.length === 0) {
        finishWave(st);
      }
    } else if (st.status === 'playing') {
      if (st.waveIndex >= 0 && st.waveIndex < st.waves.length - 1) {
        st.nextWaveT -= dt;
        if (st.nextWaveT <= 0) startWave(st);
      } else if (st.waveIndex === -1) {
        st.nextWaveT -= dt;
        if (st.nextWaveT <= 0) startWave(st);
      }
      NB.UI.nextWaveTick(st);
    }

    /* --- 敌人 --- */
    var i, list = st.enemies;
    for (i = list.length - 1; i >= 0; i--) {
      var keep = list[i].update(dt);
      if (!keep) list.splice(i, 1);
    }

    /* --- 信标光环：脏标记重算（只在塔/信标变化时才真正算） --- */
    Ent.recomputeBeacon(st);

    /* --- 炮塔 --- */
    for (i = 0; i < st.towers.length; i++) {
      var tw2 = st.towers[i];
      /* 应用信标加成：只在加成值真正变化时才换对象，
         否则上百座塔每帧各新建一个对象，纯 GC 压力。 */
      if (tw2._bd > 0) {
        if (!tw2._bonus || tw2._bonus.dmg !== tw2._bd || tw2._bonus.rate !== tw2._br) {
          tw2._bonus = { dmg: tw2._bd, rate: tw2._br };
        }
      } else if (tw2._bonus) {
        tw2._bonus = null;
      }
      tw2.update(dt, st.enemies);
    }

    /* --- 弹丸 --- */
    for (i = st.bullets.length - 1; i >= 0; i--) {
      if (!st.bullets[i].update(dt)) st.bullets.splice(i, 1);
    }

    /* --- 轨道轰炸：延迟落点 --- */
    for (i = st.strikes.length - 1; i >= 0; i--) {
      var sk = st.strikes[i];
      sk.t -= dt;
      if (sk.t <= 0) {
        st.strikes.splice(i, 1);
        Ent.detonateStrike(st, sk);
      }
    }

    /* --- 逆转快照：每 2.5s 一份，保留最近 5 分钟（120 份） --- */
    if (st.endless && st.status === 'playing') {
      var rw = st.rewind;
      rw.t -= dt;
      if (rw.t <= 0) {
        rw.t = 2.5;
        rw.snaps.push(snapshotState(st));
        if (rw.snaps.length > 120) rw.snaps.shift();
      }
    }

    /* --- 突袭标记衰减 --- */
    for (var ri = st.raidMarks.length - 1; ri >= 0; ri--) {
      st.raidMarks[ri].t -= dt;
      if (st.raidMarks[ri].t <= 0) st.raidMarks.splice(ri, 1);
    }

    /* --- 震动衰减 --- */
    if (st.shakeT > 0) {
      st.shakeT -= dt;
      if (st.shakeT <= 0) { st.shakeT = 0; st.shakeAmt = 0; }
    }

    /* --- HUD 同步（节流） --- */
    st.hudT = (st.hudT || 0) - dt;
    if (st.hudT <= 0) {
      st.hudT = 0.1;
      NB.UI.hudSync();
    }

    /* --- 定时存档 --- */
    st.autoSaveT += dt;
    if (st.autoSaveT > 12) {
      st.autoSaveT = 0;
      if (st.level && st.result) persistLevel(st, false);
    }
  }

  /* ---------- 生成敌人 ---------- */
  /* ============================================================
     突袭刷新：无尽模式后期，在随机可建格投放少量突袭兵
     不走固定跑道，直接朝基地推进，逼迫玩家留防空
     ============================================================ */
  var RAIDERS = ['breacher', 'sapper', 'droner'];

  function spawnRaiders(st, wv) {
    if (!st.endless) return;
    var idx = wv.index;
    if (idx < 12 || (idx - 12) % 3 !== 0) return;

    var map = st.map;
    var spots = [];
    for (var gy = 1; gy < P.GH - 1; gy++) {
      for (var gx = 1; gx < P.GW - 1; gx++) {
        if (P.blockedAt(map, gx, gy) !== 0) continue;
        var ddx = gx * C.CELL + C.CELL / 2 - map.base.x;
        var ddy = gy * C.CELL + C.CELL / 2 - map.base.y;
        if (ddx * ddx + ddy * ddy < C.CELL * C.CELL * 25) continue;
        spots.push({ gx: gx, gy: gy });
      }
    }
    if (!spots.length) return;

    var n = 1 + Math.min(4, Math.floor((idx - 12) / 8));
    var used = {}, spawned = 0;
    for (var k = 0; k < n; k++) {
      var pick = null;
      for (var tr = 0; tr < 14; tr++) {
        var cand = spots[(Math.random() * spots.length) | 0];
        if (!used[cand.gx + ',' + cand.gy]) { pick = cand; break; }
      }
      if (!pick) break;
      used[pick.gx + ',' + pick.gy] = 1;

      var e = new Ent.Enemy(st, RAIDERS[k % RAIDERS.length], wv.hpMul * 0.85, wv.spMul);
      e.placeAt(pick.gx, pick.gy);
      st.enemies.push(e);

      var cx = pick.gx * C.CELL + C.CELL / 2;
      var cy = pick.gy * C.CELL + C.CELL / 2;
      FX.ring(cx, cy, { r0: 4, r1: C.CELL * 1.5, life: 0.6, color: '#ff4d6d', width: 3 });
      FX.ring(cx, cy, { r0: C.CELL * 1.2, r1: 4, life: 0.9, color: '#ff2e42', width: 2 });
      FX.spark(cx, cy, {
        n: 18, c1: '#ff2e42', c2: '#ffffff',
        spMin: 60, spMax: 220, lifeMin: 0.3, lifeMax: 0.75,
        sizeMin: 1.6, sizeMax: 4.4, ang: -Math.PI / 2, grav: 120
      });
      FX.smoke(cx, cy, { n: 4, c1: '#5a2020', c2: '#1a0808', sp: 26, rise: 34, lifeMin: 0.4, lifeMax: 0.9, sizeMin: 3, sizeMax: 7 });
      st.raidMarks.push({ x: cx, y: cy, t: 1.4 });
      spawned++;
    }
    if (spawned) {
      st.shake(5);
      NB.Audio.play('explodeSmall');
      NB.UI.toast('侦测到 ' + spawned + ' 支突袭小队 · 直扑基地', 'rd', 2600);
    }
  }

  function spawnEnemy(st, type, elite) {
    /* 波次强度：闯关取关卡固定值，无尽逐波成长；难度倍率叠加其上 */
    var wv = st.waves[st.waveIndex] || st.level;
    var hpMul = (wv.hpMul != null ? wv.hpMul : st.level.hpMul) * st.difficulty.hpMul;
    var spMul = (wv.spMul != null ? wv.spMul : st.level.spMul) * st.difficulty.spMul;
    /* 精英单位：血量 ×2.6、收益 ×2 */
    if (elite) { hpMul *= 2.6; }
    var e = new Ent.Enemy(st, type, hpMul, spMul);
    /* 击杀收益按难度缩放 */
    e.gold = Math.max(1, Math.round(e.gold * st.difficulty.goldMul * (elite ? 2 : 1)));
    st.enemies.push(e);
    FX.glow(e.x, e.y, { size: 14, life: 0.2, color: e.color });
    if (e.def.attacker) {
      FX.ring(e.x, e.y, { r0: 4, r1: 26, life: 0.4, color: e.color, width: 2 });
    }
  }

  /* ---------- 开始一波 ---------- */
  function startWave(st) {
    st.waveIndex++;
    /* 闯关模式有最后一波；无尽模式永不结束（波表滚动追加） */
    if (st.waveIndex >= st.waves.length) {
      if (st.endless) {
        var more = Waves.buildEndless(st.waveIndex, C.ENDLESS.batchSize, st.difficulty.key);
        for (var mi = 0; mi < more.length; mi++) st.waves.push(more[mi]);
      } else {
        st.waveIndex = st.waves.length - 1;
        return;
      }
    }
    var wv = st.waves[st.waveIndex];
    st.waveActive = true;
    st.waveT = 0;
    st.waveKills = 0;
    st.waveNo++;   /* 绝对波号：波表裁剪后仍保持连续，用于显示与存档 */
    st.pendingSpawns = wv.entries.map(function (en) {
      return { t: en.delay, type: en.type, elite: en.elite };
    });
    spawnRaiders(st, wv);
    NB.UI.waveBanner(st.waveNo, wv.name, wv.isBoss);
    NB.UI.nextWaveHide();
    NB.Audio.play('waveStart');
    if (wv.isBoss) NB.UI.toast('警告：BOSS 信号接近！', 'rd', 2600);
  }
  G.startWave = startWave;

  /* 无尽模式：波表滚动补充（保持内存有界，只保留邻近波次） */
  function refillWaves(st) {
    if (!st.endless) return;
    /* 当前波接近波表末尾时，向后追加一批 */
    if (st.waveIndex >= st.waves.length - 2) {
      var more = Waves.buildEndless(st.waveIndex + 1, C.ENDLESS.batchSize, st.difficulty.key);
      for (var i = 0; i < more.length; i++) st.waves.push(more[i]);
    }
    /* 波表过长时丢弃最旧的（索引同步左移，waveNo 为绝对波号不受影响） */
    while (st.waves.length > C.ENDLESS.batchSize * 4 && st.waveIndex > 2) {
      st.waves.shift();
      st.waveIndex--;
    }
  }
  G.refillWaves = refillWaves;

  /* ---------- 立即出击（手动提前） ---------- */
  G.callWaveNow = function () {
    var st = G.state;
    if (!st || st.status !== 'playing' || st.waveActive) return;
    /* 奖励剩余等待时间换来的金币 */
    var bonus = Math.max(0, Math.round(st.nextWaveT * 6));
    st.gold += bonus;
    FX.coin(st.map.base.x, st.map.base.y - 30, bonus);
    NB.UI.hudSync();
    startWave(st);
  };

  /* ---------- 一波结束 ---------- */
  function finishWave(st) {
    st.waveActive = false;
    var wv = st.waves[st.waveIndex];
    /* 奖励：每打通一个额外敌人入口 +20%（风险换收益） */
    var spawnBonus = 1 + 0.2 * Math.max(0, st.activeSpawns.length - 1);
    var reward = Math.round(wv.reward * spawnBonus);
    st.gold += reward;
    /* 利息 */
    var interestLv = Save.talent('interest');
    if (interestLv > 0 && st.gold > 0) {
      var rate = Math.min(0.12, interestLv * 0.03);
      var ii = Math.floor(st.gold * rate);
      if (ii > 0) {
        st.gold += ii;
        FX.coin(st.map.base.x, st.map.base.y - 40, ii);
      }
    }
    NB.UI.waveClear(st.waveNo, reward);
    if (spawnBonus > 1) {
      NB.UI.toast('多入口作战 · 波次奖励 +' + Math.round((spawnBonus - 1) * 100) + '%', 'gd', 1600);
    }

    /* 成就 */
    if (st.waveNo >= 10) Save.unlockAch('wave10');
    /* 累计击杀已在 onKill 实时计数与判成就，此处无需重复判断 */

    /* 是否最后一波（闯关模式才存在） */
    if (!st.endless && st.waveIndex >= st.waves.length - 1) {
      G.win();
      return;
    }

    /* 无尽模式：记录最高波数 + 自动存档 + 波表滚动补充 */
    if (st.endless) {
      if (st.waveNo > (Save.endlessBest().wave || 0)) Save.endlessSetBest({ wave: st.waveNo, kills: st.kills });
      if (st.saveSlot) Save.endlessUpdate(st.saveSlot, snapshotState(st));
      refillWaves(st);
    }

    st.nextWaveT = wv.interval;
    NB.UI.nextWaveShow(st);
  }

  /* ============================================================
     胜利 / 失败
     ============================================================ */
  G.win = function () {
    var st = G.state;
    if (!st || st.status === 'won') return;
    /* 无尽模式没有胜利终点 */
    if (st.endless) return;
    st.status = 'won';
    var lv = st.level;
    var rec = Save.level(lv.id);

    /* 星级 */
    var lifePct = st.lives / st.maxLives;
    var target = C.targetTime(lv);
    var s1 = true;
    var s2 = lifePct >= 0.7;
    var s3 = st.playTime <= target;
    var stars = (s1 ? 1 : 0) + (s2 ? 1 : 0) + (s3 ? 1 : 0);

    /* 晶币 */
    var cores = Math.round(lv.reward * (1 + (stars - 1) * 0.4) * st.mods.bounty);
    var firstClear = !rec.clear;
    if (firstClear) cores = Math.round(cores * 1.5);

    /* 写入存档 */
    rec.clear = true;
    rec.stars = Math.max(rec.stars || 0, stars);
    if (!rec.best || st.playTime < rec.best) rec.best = Math.round(st.playTime);
    var d = Save.get();
    d.cores += cores;
    d.stats.wins++;
    d.stats.goldEarned += st.kills;
    /* kills / towers 已在击杀与建造时实时计数，此处不重复累加 */
    d.stats.bestWave = Math.max(d.stats.bestWave || 0, st.waves.length);
    /* 注意：towers / kills 在建造与击杀时已实时计数（见 tryBuild / onKill），此处不可重复累加 */
    d.stats.damage = (d.stats.damage || 0) + st.damageDealt;

    /* 成就：用累计值判断 */
    if (firstClear) Save.unlockAch('first_blood');
    var cleared = Save.clearCount();
    if (cleared >= 5) Save.unlockAch('clear5');
    if (cleared >= C.LEVELS.length) Save.unlockAch('clear_all');
    if (Save.totalStars() >= 9) Save.unlockAch('star9');
    if (Save.totalStars() >= 36) Save.unlockAch('star36');
    if (lifePct >= 1) Save.unlockAch('no_leak');
    if (d.stats.towers >= 20) Save.unlockAch('towers20');
    if (d.stats.towers >= 100) Save.unlockAch('towers100');
    if (d.stats.kills >= 1000) Save.unlockAch('kills1000');
    if (d.stats.kills >= 5000) Save.unlockAch('kills5000');
    if (d.cores >= 1000) Save.unlockAch('rich');
    Save.save(true);

    st.result = {
      win: true, stars: stars, cores: cores, firstClear: firstClear,
      s2: s2, s3: s3, targetTime: target,
      kills: st.kills, time: st.playTime, lifePct: lifePct,
      towers: st.towers.length, damage: st.damageDealt
    };
    FX.clearAll();
    var b = st.map.base;
    for (var i = 0; i < 22; i++) {
      FX.spark(b.x + U.rand(-40, 40), b.y + U.rand(-40, 40), {
        n: 3, c1: ['#4fe3ff', '#7dff5a', '#ffc93c'][i % 3], c2: '#ffffff',
        spMin: 90, spMax: 340, lifeMin: 0.5, lifeMax: 1.3, grav: 60
      });
    }
    NB.Audio.play('victory');
    NB.Audio.playMusic('victory');
    setTimeout(function () { NB.UI.resultModal(st); }, 620);
  };

  G.lose = function () {
    var st = G.state;
    if (!st || st.status === 'lost') return;
    st.status = 'lost';
    var d = Save.get();
    var salvage = Math.floor(st.kills * 0.12);
    d.cores += salvage;
    d.stats.losses++;
    /* kills / towers 已实时计数；damage 在结算时统一累加 */
    d.stats.damage = (d.stats.damage || 0) + st.damageDealt;
    if (d.stats.kills >= 1000) Save.unlockAch('kills1000');
    if (d.stats.kills >= 5000) Save.unlockAch('kills5000');
    if (d.stats.towers >= 20) Save.unlockAch('towers20');
    if (d.stats.towers >= 100) Save.unlockAch('towers100');
    if (d.cores >= 1000) Save.unlockAch('rich');
    Save.save(true);

    st.result = {
      win: false, stars: 0, cores: salvage,
      kills: st.kills, time: st.playTime,
      wave: st.waveNo || (st.waveIndex + 1), towers: st.towers.length
    };
    /* 无尽模式：记录最高波数（存档保留在最近一次波次结束的自动存档，可继续） */
    if (st.endless) {
      Save.endlessSetBest({ wave: st.waveNo, kills: st.kills });
    }
    NB.Audio.play('defeat');
    NB.Audio.playMusic('defeat');
    setTimeout(function () { NB.UI.resultModal(st); }, 700);
  };

  function persistLevel(st) { Save.save(true); }

  /* ============================================================
     无尽模式：存档快照 / 恢复
     —— 波次内容由波号确定性生成，因此快照只需记录波号；
        其余为炮塔、敌人、资源等运行时状态。
     ============================================================ */
  function snapshotState(st) {
    return {
      layout: st.map.key,
      variant: st.variant,
      difficulty: st.difficulty.key,
      waveNo: st.waveNo,
      waveActive: st.waveActive,
      waveT: st.waveT,
      nextWaveT: st.nextWaveT,
      raidMarks: st.raidMarks.map(function (m2) { return { x: m2.x, y: m2.y, t: m2.t }; }),
      pendingSpawns: st.pendingSpawns.map(function (p) {
        return { t: p.t, type: p.type, elite: p.elite };
      }),
      enemies: st.enemies.map(function (e) {
        return {
          type: e.type, hp: e.hp, maxHp: e.maxHp, dist: e.dist,
          slowT: e.slowT, slowF: e.slowF, stunT: e.stunT,
          dotT: e.dotT, dotDmg: e.dotDmg, shield: e.shield || 0, gold: e.gold,
          pathIdx: e.pathIdx,
          /* 攻击型敌人的追击状态：不存则读档后瞬间丢失目标重新索敌，
             与「完全复原」的承诺不符（存档里存索引，恢复时按索引回填） */
          atkT: e.attackTarget ? st.enemies.indexOf(e.attackTarget) : -1,
          atkCdT: e.atkCdT || 0, attackCdT: e.attackCdT || 0, atkWind: e.atkWind || 0
        };
      }),
      towers: st.towers.map(function (t) {
        return {
          type: t.type, gx: t.gx, gy: t.gy, level: t.level,
          hp: t.hp, invested: t.invested, kills: t.kills, damageDone: t.damageDone
        };
      }),
      gold: st.gold, lives: st.lives, maxLives: st.maxLives,
      kills: st.kills, damageDealt: st.damageDealt, playTime: st.playTime,
      speed: st.speed,
      activeSpawns: st.activeSpawns.slice(),
      stacked: Object.keys(st.stacked),
      /* src 存塔在 st.towers 里的索引：恢复后重新指向，命中才能计入伤害/击杀统计 */
      strikes: st.strikes.map(function (sk) {
        return {
          x: sk.x, y: sk.y, t: sk.t, dmg: sk.dmg, blast: sk.blast, blastDmg: sk.blastDmg,
          src: sk.src ? st.towers.indexOf(sk.src) : -1
        };
      })
    };
  }

  function restoreState(st, slot) {
    var d = slot.data || {};
    /* 先清空：存档恢复与时间回溯都会走到这里，不清会累积塔/敌人 */
    st.towers.length = 0;
    st.enemies.length = 0;
    st.bullets.length = 0;
    st.gold = d.gold != null ? d.gold : st.gold;
    if (d.activeSpawns && d.activeSpawns.length) {
      st.activeSpawns = d.activeSpawns.slice();
    }
    st.stacked = {};
    (d.stacked || []).forEach(function (k) { st.stacked[k] = true; });
    st._beaconSig = null;
    /* 先建塔再回填 strikes.src：飞行中的轨道轰炸/导弹命中要计入炮塔统计 */
    var _restoredTowers = null;
    st.strikes = (d.strikes || []).map(function (sk) {
      return { x: sk.x, y: sk.y, t: sk.t, dmg: sk.dmg, blast: sk.blast, blastDmg: sk.blastDmg, color: '#ff6b9d', src: null };
    });
    st._pendingStrikeSrc = (d.strikes || []).map(function (sk) { return sk.src; });
    st.lives = d.lives != null ? d.lives : st.lives;
    st.maxLives = d.maxLives != null ? d.maxLives : st.maxLives;
    st.kills = d.kills || 0;
    st.damageDealt = d.damageDealt || 0;
    st.playTime = d.playTime || 0;
    st.speed = d.speed || 1;

    /* 波表：按存档波号确定性重建，当前波对齐。
       绝对波号 waveNo 是 1 基（startWave 里从 0 自增到 1），
       而 buildEndless 的 fromIdx 是 0 基索引 —— 直接传 waveNo 会整体偏一波，
       且 waveIndex 恒为 -1 会让「波中存档」清波后从第 1 波重开。
       正确做法：waveIndex 对齐到 waveNo-1，波表从该索引开始生成。 */
    st.waveNo = d.waveNo || 0;
    if (st.endless) {
      if (st.waveNo > 0) {
        st.waveIndex = st.waveNo - 1;
        st.waves = Waves.buildEndless(st.waveIndex, C.ENDLESS.batchSize, st.difficulty.key);
      } else {
        /* 还没开始过任何波：保持 -1，主循环靠它触发首发 */
        st.waveIndex = -1;
        st.waves = Waves.buildEndless(0, C.ENDLESS.batchSize, st.difficulty.key);
      }
    } else {
      st.waveIndex = -1;
      st.waves = st.level.waves;
    }

    /* 炮塔复原 */
    (d.towers || []).forEach(function (ts) {
      var tw = new Ent.Tower(st, ts.type, ts.gx, ts.gy);
      tw.level = Math.max(1, Math.min(tw.def.maxLevel, ts.level || 1));
      tw.invested = ts.invested || 0;
      tw.kills = ts.kills || 0;
      tw.damageDone = ts.damageDone || 0;
      tw.buildT = 0;
      tw.hp = Math.min(tw.maxHp, ts.hp != null ? ts.hp : tw.maxHp);
      st.towers.push(tw);
    });
    /* 塔已就位，把飞行中的打击效果重新挂回所属炮塔（否则伤害不计入统计） */
    if (st._pendingStrikeSrc) {
      for (var si = 0; si < st.strikes.length; si++) {
        var ti = st._pendingStrikeSrc[si];
        if (ti != null && ti >= 0 && ti < st.towers.length) st.strikes[si].src = st.towers[ti];
      }
      st._pendingStrikeSrc = null;
    }

    /* 敌人与波内进度复原 */
    st.waveActive = !!d.waveActive;
    st.waveT = d.waveT || 0;
    st.nextWaveT = d.nextWaveT != null ? d.nextWaveT : 4.0;
    st.raidMarks = (d.raidMarks || []).map(function (m2) { return { x: m2.x, y: m2.y, t: m2.t }; });
    st.pendingSpawns = (d.pendingSpawns || []).map(function (p) {
      return { t: p.t, type: p.type, elite: p.elite };
    });
    (d.enemies || []).forEach(function (es) {
      var wv = st.waves[0] || { hpMul: 1, spMul: 1 };
      var e = new Ent.Enemy(st, es.type, wv.hpMul, wv.spMul);
      if (es.maxHp) e.maxHp = es.maxHp;
      e.hp = Math.min(e.maxHp, es.hp != null ? es.hp : e.maxHp);
      e.dist = es.dist || 0;
      e.slowT = es.slowT || 0; e.slowF = es.slowF || 0;
      e.stunT = es.stunT || 0;
      e.dotT = es.dotT || 0; e.dotDmg = es.dotDmg || 0;
      e.shield = es.shield || 0;
      if (es.gold) e.gold = es.gold;
      e.pathIdx = (es.pathIdx != null && st.activeSpawns.indexOf(es.pathIdx) >= 0) ? es.pathIdx : 0;
      e.atkCdT = es.atkCdT || 0;
      e.attackCdT = es.attackCdT || 0;
      e.atkWind = es.atkWind || 0;
      e._atkT = es.atkT != null ? es.atkT : -1;   /* 暂存，第二趟回填 */
      e.pathTotal = P.pathTotal(st.map, e.pathIdx);
      var p = P.posAt(st.map, e.dist, e.pathIdx);
      e.x = p.x; e.y = p.y; e.ang = p.ang;
      st.enemies.push(e);
    });
    /* 第二趟：所有敌人都已入列，按快照索引回填追击目标。
       必须分两趟 —— 目标可能排在本敌人之后，第一趟时还没 push。 */
    for (var ei = 0; ei < st.enemies.length; ei++) {
      var te = st.enemies[ei];
      if (te._atkT != null && te._atkT >= 0 && te._atkT < st.enemies.length) {
        te.attackTarget = st.enemies[te._atkT];
      }
      te._atkT = null;
    }
  }

  /* 保存当前无尽对局；slotId 为空则新建槽位 */
  G.saveEndless = function (slotId, name) {
    var st = G.state;
    if (!st || !st.endless) return null;
    var data = snapshotState(st);
    if (slotId) {
      if (!Save.endlessSlot(slotId)) return null;
      Save.endlessUpdate(slotId, data);
      st.saveSlot = slotId;
      return slotId;
    }
    var id = Save.endlessCreate(name || ('无尽存档 ' + (Save.endlessSlots().length + 1)), data);
    st.saveSlot = id;
    return id;
  };
  G.currentSlot = function () { return G.state ? G.state.saveSlot : null; };

  /* ============================================================
     操作：建造 / 升级 / 出售
     ============================================================ */
  G.selectBuild = function (type) {
    var st = G.state;
    if (!st || st.status !== 'playing') return;
    G.selected = null;
    NB.UI.sidePanelHide();
    /* 无尽模式自动解锁全部炮塔 */
    if (!Save.hasTower(type) && !st.endless) {
      NB.UI.toast('该炮塔尚未在商城授权', 'rd', 1800);
      NB.Audio.play('uiDenied');
      G.buildType = null;
      NB.UI.buildBarRender();
      return;
    }
    G.buildType = (G.buildType === type) ? null : type;
    NB.Audio.play('uiClick');
    NB.UI.buildBarRender();
    canvas.classList.toggle('build-mode', !!G.buildType);
    syncModeClass();
  };

  G.tryBuild = function (gx, gy) {
    var st = G.state;
    if (!st || !G.buildType) return false;
    var type = G.buildType;
    var cost = C.TOWER_COST[type];
    /* 通讯中继站：只能建在出生点塔位上 */
    if (type === 'relay') {
      var slot = P.relaySlotAt(st.map, gx, gy);
      if (!slot) { NB.Audio.play('uiDenied'); NB.UI.toast('中继站只能建在黄色标记的出生点塔位', 'rd', 1800); return false; }
      if (st.activeSpawns.indexOf(slot.path) >= 0) {
        NB.Audio.play('uiDenied'); NB.UI.toast('该入口已经打通', 'rd', 1500); return false;
      }
      if (st.towerCountAt(gx, gy) >= 1) { NB.Audio.play('uiDenied'); NB.UI.toast('该塔位已被占用', 'rd', 1200); return false; }
      if (st.gold < cost) { NB.Audio.play('uiDenied'); NB.UI.toast('资金不足', 'rd', 1200); return false; }
      st.gold -= cost;
      var rtw = new Ent.Tower(st, type, gx, gy);
      st.towers.push(rtw);
      st._beaconSig = null;
      /* 一次性打通该出生点（中继站之后被拆也不会关闭） */
      st.activeSpawns.push(slot.path);
      st.activeSpawns.sort(function (a, b) { return a - b; });
      FX.build(rtw.x, rtw.y, rtw.def.color);
      FX.ring(rtw.x, rtw.y, { r0: 8, r1: 70, life: 0.7, color: '#ffd23d', width: 3 });
      NB.Audio.play('build');
      NB.UI.toast('敌人入口已打通！每波资金 +20%', 'gr', 2600);
      G.buildType = null;
      NB.UI.buildBarRender();
      NB.UI.hudSync();
      return true;
    }
    /* 普通塔：格子容量 = 双开叠加 ? 2 : 1 */
    var cap = st.stacked[gx + ',' + gy] ? 2 : 1;
    var have = st.towerCountAt(gx, gy);
    if (have >= cap) {
      NB.Audio.play('uiDenied');
      NB.UI.toast(cap > 1 ? '该位置已有两座炮塔' : '该位置已有炮塔', 'rd', 1200);
      return false;
    }
    /* 空中塔可跨越路径格（飞行），地面塔必须可建格；
       但双方都不能占用中继站塔位（blocked=4，专供 relay） */
    var flying = !!(C.TOWERS[type] && C.TOWERS[type].flying);
    var bk = P.blockedAt(st.map, gx, gy);
    if (bk === 4) { NB.Audio.play('uiDenied'); NB.UI.toast('该塔位专供通讯中继站', 'rd', 1500); return false; }
    if (!flying && bk !== 0) { NB.Audio.play('uiDenied'); NB.UI.toast('无法在此建造', 'rd', 1200); return false; }
    if (st.gold < cost) { NB.Audio.play('uiDenied'); NB.UI.toast('资金不足', 'rd', 1200); return false; }

    st.gold -= cost;
    var tw = new Ent.Tower(st, type, gx, gy);
    /* 双开叠塔：第二座塔在同格内做视觉偏移，避免完全重叠看不出来 */
    if (have >= 1) {
      tw.stackSlot = have;
      var off = (C.CELL * 0.19);
      tw.drawX = tw.x + (have % 2 === 1 ? off : -off);
      tw.drawY = tw.y + (have >= 2 ? off * 0.7 : 0);
    } else {
      tw.stackSlot = 0;
      tw.drawX = tw.x; tw.drawY = tw.y;
    }
    st.towers.push(tw);
    st._beaconSig = null;      /* 塔集合变化 -> 光环需重算 */
    FX.build(tw.x, tw.y, tw.def.color);
    if (have >= 1) {
      FX.ring(tw.x, tw.y, { r0: 4, r1: C.CELL * 0.8, life: 0.5, color: '#c8e6ff', width: 2.4 });
      NB.UI.toast('双开夹具生效：同格第二座炮塔', 'cy', 1800);
    }
    NB.Audio.play('build');
    st.shake(3);
    var d = Save.get();
    d.stats.towers++;
    if (d.stats.towers >= 20) Save.unlockAch('towers20');
    if (d.stats.towers >= 100) Save.unlockAch('towers100');
    Save.save();

    /* 持续建造模式：按住 Shift 或默认不取消 */
    if (!NB.UI.keepBuild) {
      G.buildType = null;
      canvas.classList.remove('build-mode');
    }
    NB.UI.buildBarRender();
    NB.UI.hudSync();
    return true;
  };

  G.upgradeTower = function (tw) {
    var st = G.state;
    if (!st || !tw) return;
    if (tw.level >= tw.def.maxLevel) { NB.Audio.play('uiDenied'); return; }
    var c = tw.upCost();
    if (st.gold < c) {
      NB.Audio.play('uiDenied');
      NB.UI.toast('资金不足，还需 ' + (c - st.gold), 'rd', 1500);
      return;
    }
    tw.upgrade();
    st.shake(3.5);
    NB.UI.sidePanelShow(tw);
    NB.UI.buildBarRender();
    NB.UI.hudSync();
  };

  G.upgradeMax = function (tw) {
    var st = G.state;
    if (!st || !tw) return;
    var maxLv = tw.def.maxLevel;
    if (tw.level >= maxLv) { NB.Audio.play('uiDenied'); return; }
    /* 先算总花费，再一次性扣除并一次性提升等级（避免逐级时价格按新等级重算） */
    var spent = 0, budget = st.gold, lv = tw.level;
    while (lv < maxLv) {
      var c = upgradeCostAt(tw, lv + 1);
      if (c > budget) break;
      budget -= c;
      spent += c;
      lv++;
    }
    if (lv === tw.level) {
      NB.Audio.play('uiDenied');
      NB.UI.toast('资金不足，无法升级', 'rd', 1300);
      return;
    }
    st.gold -= spent;
    tw.invested += spent;
    tw.level = lv;
    FX.upgrade(tw.x, tw.y, tw.def.color);
    if (lv === maxLv) FX.ring(tw.x, tw.y, { r0: 50, r1: 6, life: 0.6, color: '#ffc93c', width: 3 });
    st.shake(5);
    NB.Audio.play('upgrade');
    NB.UI.sidePanelShow(tw);
    NB.UI.buildBarRender();
    NB.UI.hudSync();
  };

  /* 指定「升到第 n 级」的费用，与 Tower.upCost 同公式 */
  function upgradeCostAt(tw, n) {
    return Math.round(C.TOWER_COST[tw.type] * Math.pow(C.UPGRADE_COST_MUL, n - 2) * 0.78);
  }

  G.sellTower = function (tw, silent) {
    var st = G.state;
    if (!st || !tw) return false;
    var v = tw.sellValue();
    st.gold += v;
    FX.coin(tw.x, tw.y - 12, v);
    FX.ring(tw.x, tw.y, { r0: 26, r1: 4, life: 0.45, color: '#ffc93c', width: 2.6 });
    FX.ring(tw.x, tw.y, { r0: 4, r1: 22, life: 0.3, color: '#ffffff', width: 1.6 });
    FX.spark(tw.x, tw.y, {
      n: 12, c1: '#ffc93c', c2: '#ffffff', spMin: 50, spMax: 200,
      lifeMin: 0.2, lifeMax: 0.5
    });
    var i = st.towers.indexOf(tw);
    if (i >= 0) st.towers.splice(i, 1);
    NB.Audio.play('sell');
    st.shake(2);
    st._beaconSig = null;
    if (G.selected === tw) { G.selected = null; NB.UI.sidePanelHide(); }
    NB.UI.buildBarRender();
    NB.UI.hudSync();
    if (!silent) NB.UI.toast('已拆除 ' + tw.def.name + '  返还 ⬢ ' + v, 'gd', 1600);
    return true;
  };

  /* 拆除确认（价格超过阈值时） */
  G.confirmSell = function (tw) {
    var st = G.state;
    if (!st || !tw) return;
    var v = tw.sellValue();
    var pct = Math.round(C.sellRate() * 100);
    if (v < 30) { G.sellTower(tw); return; }
    NB.UI.confirmSell(tw, v, pct);
  };

  /* ============================================================
     铲子：PVZ 式直接移除炮塔，不返还资金
     ============================================================ */
  G.shovelMode = false;

  G.toggleShovel = function () {
    var st = G.state;
    if (!st || st.status !== 'playing') return;
    G.shovelMode = !G.shovelMode;
    if (G.shovelMode) {
      /* 拿起铲子时退出建造/选中态 */
      G.buildType = null;
      G.selected = null;
      NB.UI.sidePanelHide();
      canvas.classList.remove('build-mode');
    }
    NB.Audio.play('uiClick');
    NB.UI.buildBarRender();
    canvas.classList.toggle('shovel-mode', !!G.shovelMode);
    syncModeClass();
  };

  G.shovelRemove = function (tw) {
    var st = G.state;
    if (!st || !tw) return false;
    var i = st.towers.indexOf(tw);
    if (i < 0) return false;
    st.towers.splice(i, 1);
    st._beaconSig = null;      /* 塔集合变化 -> 光环需重算 */
    /* 无资金返还：仅拆除特效与音效 */
    FX.ring(tw.x, tw.y, { r0: 6, r1: 34, life: 0.32, color: '#c8d8e8', width: 2.2 });
    FX.spark(tw.x, tw.y, {
      n: 12, c1: '#8fa8c4', c2: '#4a5a68',
      spMin: 40, spMax: 170, lifeMin: 0.25, lifeMax: 0.6,
      sizeMin: 1.4, sizeMax: 3.4, grav: 240
    });
    FX.smoke(tw.x, tw.y, {
      n: 5, c1: '#4e5a68', c2: '#121820', sp: 40, rise: 30,
      sizeMin: 4, sizeMax: 10, lifeMin: 0.4, lifeMax: 0.8
    });
    NB.Audio.play('shovel');
    st.shake(2);
    if (G.selected === tw) { G.selected = null; NB.UI.sidePanelHide(); }
    NB.UI.buildBarRender();
    NB.UI.hudSync();
    return true;
  };

  /* ============================================================
     双开夹具：让一个格子可以建第二座炮塔（叠加）
     ============================================================ */
  G.stackMode = false;

  G.toggleStack = function () {
    var st = G.state;
    if (!st || st.status !== 'playing') return;
    G.stackMode = !G.stackMode;
    if (G.stackMode) {
      G.moveMode = false;
      G.buildType = null;
      G.shovelMode = false;
      G.selected = null;
      NB.UI.sidePanelHide();
      canvas.classList.remove('build-mode');
      canvas.classList.remove('shovel-mode');
    }
    NB.Audio.play('uiClick');
    NB.UI.buildBarRender();
    canvas.classList.toggle('stack-mode', !!G.stackMode);
    syncModeClass();
  };

  /* 对一个已有炮塔的格子启用叠加能力 */
  G.applyStack = function (gx, gy) {
    var st = G.state;
    if (!st) return false;
    var key = gx + ',' + gy;
    if (st.stacked[key]) {
      NB.UI.toast('该位置已装配双开夹具', 'rd', 1400);
      return false;
    }
    if (st.towerCountAt(gx, gy) < 1) {
      NB.UI.toast('双开夹具只能装在已有炮塔的格子上', 'rd', 1600);
      return false;
    }
    st.stacked[key] = true;
    FX.ring(P.cellCenter(gx, gy).x, P.cellCenter(gx, gy).y, {
      r0: 6, r1: 40, life: 0.45, color: '#c8e6ff', width: 2.6
    });
    NB.Audio.play('upgrade');
    NB.UI.toast('双开夹具就绪：可在此格建造第二座炮塔', 'cy', 2200);
    return true;
  };

  /* ============================================================
     逆转（回溯）：回到 5 分钟内任意快照点
     ============================================================ */
  G.rewindList = function () {
    var st = G.state;
    if (!st || !st.endless) return [];
    var snaps = st.rewind.snaps;
    var out = [];
    for (var i = snaps.length - 1; i >= 0; i--) {
      out.push({
        idx: i,
        ago: Math.round((snaps.length - 1 - i) * 2.5),
        waveNo: snaps[i].waveNo || 0,
        gold: snaps[i].gold || 0,
        lives: snaps[i].lives || 0
      });
    }
    return out;
  };

  G.rewindLeft = function () {
    var st = G.state;
    return st && st.rewind ? st.rewind.left : 0;
  };

  G.rewindTo = function (idx) {
    var st = G.state;
    if (!st || !st.endless || st.status !== 'playing') return false;
    var rw = st.rewind;
    if (rw.left <= 0) { NB.UI.toast('逆转次数已用完', 'rd', 1800); return false; }
    var snap = rw.snaps[idx];
    if (!snap) { NB.UI.toast('该时间点不可用', 'rd', 1500); return false; }
    /* 用快照数据恢复（波表按 waveNo 确定性重建，pendingSpawns 已保存，
       因此回溯后敌人生成序列与原来完全一致） */
    restoreState(st, { data: snap });
    /* 回溯后清掉该时间点之后的快照，避免回到未来 */
    rw.snaps = rw.snaps.slice(0, idx + 1);
    rw.left--;
    rw.t = 2.5;
    /* 视觉反馈 */
    FX.ring(st.map.base.x, st.map.base.y, { r0: 20, r1: 300, life: 0.8, color: '#8fd4ff', width: 3 });
    NB.UI.toast('已回溯至 第 ' + (st.waveNo || 0) + ' 波前', 'cy', 2000);
    NB.Audio.play('waveStart');
    NB.UI.hudSync();
    NB.UI.buildBarRender();
    return true;
  };

  G.selectTower = function (tw) {
    G.selected = tw;
    G.buildType = null;
    if (G.shovelMode) { G.shovelMode = false; canvas.classList.remove('shovel-mode'); }
    canvas.classList.remove('build-mode');
    NB.UI.buildBarRender();
    if (tw) { NB.UI.sidePanelShow(tw); NB.Audio.play('uiClick'); }
    else NB.UI.sidePanelHide();    if (!tw || !tw.flying) G.moveMode = false;
    if (typeof syncModeClass === 'function') syncModeClass();
  };

  /* ============================================================
     暂停 / 速度
     ============================================================ */
  G.togglePause = function () {
    var st = G.state;
    if (!st || (st.status !== 'playing' && st.status !== 'paused')) return;
    if (st.status === 'playing') {
      st.status = 'paused';
      NB.Audio.play('uiClick');
      NB.UI.pauseModal(st);
    } else {
      st.status = 'playing';
      NB.Audio.play('uiClick');
      NB.UI.modalHide();
    }
    NB.UI.hudSync();
  };

  G.toggleSpeed = function () {
    var st = G.state;
    if (!st) return;
    /* 1 -> 2 -> ... -> 8 -> 1 */
    st.speed = st.speed >= 8 ? 1 : st.speed + 1;
    NB.Audio.play('uiClick');
    NB.UI.hudSync();
  };

  /* 撤退 */
  G.quit = function () {
    var st = G.state;
    if (st && st.status === 'playing') {
      NB.UI.confirmQuit(st);
      return;
    }
    G.abort();
  };
  G.abort = function () {
    NB.Audio.stopMusic();
    NB.Audio.play('uiBack');
    G.shovelMode = false;
    G.stackMode = false;
    if (canvas) {
      canvas.classList.remove('shovel-mode');
      canvas.classList.remove('stack-mode');
    }
    /* 模态层已提升到 #app 根级，离开游戏时需显式关闭，避免残留覆盖菜单 */
    if (NB.UI && NB.UI.modalHide) NB.UI.modalHide();
    /* 无尽模式撤退前自动保存当前进度到绑定槽位 */
    var st0 = G.state;
    if (st0 && st0.endless && st0.saveSlot && st0.status !== 'lost') {
      Save.endlessUpdate(st0.saveSlot, snapshotState(st0));
    }
    G.state = null;
    NB.UI.sidePanelHide();
    NB.Router.go('menu');
  };

  /* ============================================================
     输入
     ============================================================ */
  function bindInput() {
    if (!canvas) return;

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    canvas.addEventListener('mousemove', function (e) {
      var r = canvas.getBoundingClientRect();
      U.mouse.sx = e.clientX - r.left;
      U.mouse.sy = e.clientY - r.top;
      var mc = toCell(U.mouse.sx, U.mouse.sy);
      U.mouse.cx = mc.cx; U.mouse.cy = mc.cy;
      U.mouse.wx = mc.wx; U.mouse.wy = mc.wy;
      U.mouse.inside = true;
      updateHover();
    });

    canvas.addEventListener('mouseleave', function () {
      U.mouse.inside = false;
      U.mouse.cx = -1; U.mouse.cy = -1;
      if (G.state) G.state.hoverTower = null;
    });

    canvas.addEventListener('mousedown', function (e) {
      var st = G.state;
      if (!st || st.status !== 'playing') return;
      if (e.button === 2) {
        /* 右键：模式开关 > 炮塔上打开属性侧栏 > 空白处取消选中 */
        if (G.shovelMode) {
          G.shovelMode = false;
          canvas.classList.remove('shovel-mode');
          NB.UI.buildBarRender();
          NB.Audio.play('uiBack');
          return;
        }
        if (G.stackMode) {
          G.stackMode = false;
          canvas.classList.remove('stack-mode');
          NB.UI.buildBarRender();
          NB.Audio.play('uiBack');
          return;
        }
        if (G.buildType) {
          G.buildType = null; canvas.classList.remove('build-mode'); NB.UI.buildBarRender();
          NB.Audio.play('uiBack');
          return;
        }
        var rgx = U.mouse.cx, rgy = U.mouse.cy;
        if (P.inBounds(rgx, rgy)) {
          var rtw = st.towerAt(rgx, rgy);
          if (rtw) {
            /* 右键炮塔：直接开右侧属性栏（拆除改用 X 键或侧栏按钮） */
            G.selectTower(rtw);
            NB.UI.sidePanelShow(rtw);
            NB.Audio.sfx('uiClick', 60);
            return;
          }
          /* 同格双开时右键切换到第二座塔 */
          var pair = st.towersAt(rgx, rgy);
          if (pair.length > 1) {
            var idx = pair.indexOf(G.selected);
            var nxt = pair[(idx + 1) % pair.length];
            G.selectTower(nxt);
            NB.UI.sidePanelShow(nxt);
            NB.Audio.sfx('uiClick', 60);
            return;
          }
        }
        if (G.selected) G.selectTower(null);
        return;
      }
      if (e.button !== 0) return;
      var gx = U.mouse.cx, gy = U.mouse.cy;
      if (!P.inBounds(gx, gy)) return;
      /* 铲子模式：点到塔即直接移除（不返还资金） */
      if (G.shovelMode) {
        var rm = st.towerAt(gx, gy);
        if (rm) G.shovelRemove(rm);
        return;
      }
      /* 双开模式：给该格装配叠加能力 */
      if (G.stackMode) {
        G.applyStack(gx, gy);
        return;
      }
      if (G.buildType) { G.tryBuild(gx, gy); return; }

      /* --- 左键：点到炮塔一律先选中 --- */
      var tw = st.towerAt(gx, gy);
      if (tw) {
        /* 同格双开：点到已有塔时若已选中另一座，则循环切换 */
        var same = st.towersAt(gx, gy);
        if (same.length > 1 && G.selected && same.indexOf(G.selected) >= 0) {
          var at = same.indexOf(G.selected);
          G.selectTower(same[(at + 1) % same.length]);
          NB.Audio.sfx('uiClick', 60);
          return;
        }
        G.selectTower(tw);
        return;
      }

      /* --- 点到空格：若选中的是可移动单位，则执行移动 --- */
      if (G.selected && G.selected.flying) {
        if (G.selected.moveTo(gx, gy)) {
          NB.UI.toast(G.selected.def.name + ' 转移中', 'cy', 1000);
          G.moveMode = false;
          syncModeClass();
          NB.UI.sidePanelHide();
          return;
        }
      }
      /* 空格且无移动意图：取消选中 */
      G.selectTower(null);
    });

    /* ---------- 触摸支持 ----------
       原先只有 touchstart：手机上选塔后看不到落点预览、也无法拖拽确认。
       现在补 touchmove（移动光标做建造预览）+ touchend（抬手才真正建造，
       避免误触；拖动超过阈值则视为取消）。 */
    var touchMoved = false, touchStartX = 0, touchStartY = 0;
    var TOUCH_SLOP = 12;   /* 像素：超过算拖动，不算点击 */

    function touchTrack(e) {
      if (!e.touches.length) return null;
      var t = e.touches[0];
      var r = canvas.getBoundingClientRect();
      var sx = t.clientX - r.left, sy = t.clientY - r.top;
      var tc = toCell(sx, sy);
      U.mouse.sx = sx; U.mouse.sy = sy;
      U.mouse.cx = tc.cx; U.mouse.cy = tc.cy;
      U.mouse.wx = tc.wx; U.mouse.wy = tc.wy;
      U.mouse.inside = true;
      return tc;
    }

    canvas.addEventListener('touchstart', function (e) {
      var tc = touchTrack(e);
      if (!tc) return;
      touchMoved = false;
      touchStartX = U.mouse.sx; touchStartY = U.mouse.sy;
      var st = G.state;
      if (!st || st.status !== 'playing' || !P.inBounds(U.mouse.cx, U.mouse.cy)) return;
      /* 按下即选中已有塔：手机上需要即时反馈（桌面是 hover 就能看） */
      if (!G.buildType && !G.shovelMode) {
        var tw0 = st.towerAt(U.mouse.cx, U.mouse.cy);
        if (tw0) G.selectTower(tw0);
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', function (e) {
      var tc = touchTrack(e);
      if (!tc) return;
      if (Math.abs(U.mouse.sx - touchStartX) > TOUCH_SLOP ||
          Math.abs(U.mouse.sy - touchStartY) > TOUCH_SLOP) touchMoved = true;
    }, { passive: true });

    canvas.addEventListener('touchend', function (e) {
      /* 拖动过的不算点击，防止边拖动边误建 */
      if (touchMoved) { touchMoved = false; return; }
      var st = G.state;
      if (!st || st.status !== 'playing' || !P.inBounds(U.mouse.cx, U.mouse.cy)) return;
      if (G.shovelMode) {
        var rmt = st.towerAt(U.mouse.cx, U.mouse.cy);
        if (rmt) G.shovelRemove(rmt);
        return;
      }
      if (G.buildType) { G.tryBuild(U.mouse.cx, U.mouse.cy); return; }
      var tw = st.towerAt(U.mouse.cx, U.mouse.cy);
      if (tw) G.selectTower(tw); else G.selectTower(null);
    }, { passive: true });

    /* 键盘 */
    w.addEventListener('keydown', function (e) {
      /* 焦点在输入框/文本域/可编辑元素时一律放行：
         否则存档命名框里打数字会触发选塔、打空格被 preventDefault 吞掉、
         打字母会误触快捷键。saves.js 只挡了 Enter，这里做统一兜底。 */
      var tg = e.target || e.srcElement;
      if (tg) {
        var tn = (tg.tagName || '').toUpperCase();
        if (tn === 'INPUT' || tn === 'TEXTAREA' || tn === 'SELECT' || tg.isContentEditable) return;
      }
      var st = G.state;
      if (!st) return;
      var k = e.key.toLowerCase();
      if (k === 'escape') {
        e.preventDefault();
        if (G.moveMode) {
          G.moveMode = false;
          syncModeClass();
          NB.UI.toast('已退出转移模式', 'nd', 1000);
          return;
        }
        if (G.shovelMode) {
          G.shovelMode = false;
          canvas.classList.remove('shovel-mode');
          NB.UI.buildBarRender();
        } else if (G.stackMode) {
          G.stackMode = false;
          canvas.classList.remove('stack-mode');
          NB.UI.buildBarRender();
        } else if (G.buildType) { G.buildType = null; canvas.classList.remove('build-mode'); NB.UI.buildBarRender(); }
        else if (G.selected) G.selectTower(null);
        else if (st.status === 'playing') G.togglePause();
        else if (st.status === 'paused') G.togglePause();
        return;
      }
      if (k === ' ') {
        e.preventDefault();
        if (st.status === 'playing' && !st.waveActive) G.callWaveNow();
        return;
      }
      if (k === 'p') { G.togglePause(); return; }
      if (k === 'f') { G.toggleSpeed(); return; }
      if (k === 'q') { G.toggleShovel(); return; }
      if (k === 'e') { G.toggleStack(); return; }
      if (k === 'r') { G.toggleMoveMode(); return; }
      /* 数字键选塔（1~9 + 0 对应第 10 个） */
      var n = parseInt(k, 10);
      var idx = (n >= 1 && n <= 9) ? n - 1 : (n === 0 ? 9 : -1);
      if (idx >= 0) {
        var id = C.TOWER_ORDER[idx];
        if (id) G.selectBuild(id);
      }
      /* U 升级 / X 拆除 */
      if ((k === 'u' || k === 'x') && G.selected) {
        if (k === 'u') G.upgradeTower(G.selected);
        else G.confirmSell(G.selected);
      }
    });
  }

  /* 屏幕坐标 -> 世界格坐标
     cover 适配后画布与网格不再一一对应，必须除以缩放并减去偏移。 */
  function toCell(sx, sy) {
    var wi = R.worldInfo();
    var sc = wi.scale || 1;
    var wx = (sx - (wi.ox || 0)) / sc;
    var wy = (sy - (wi.oy || 0)) / sc;
    var cx = Math.floor(wx / P.CELL);
    var cy = Math.floor(wy / P.CELL);
    /* 被裁掉的边距区域落在网格外，统一置 -1 让点击逻辑忽略 */
    if (!P.inBounds(cx, cy)) return { cx: -1, cy: -1, wx: wx, wy: wy };
    return { cx: cx, cy: cy, wx: wx, wy: wy };
  }

  function updateHover() {
    var st = G.state;
    if (!st || !U.mouse.inside) return;
    if (G.buildType) { st.hoverTower = null; return; }
    if (!P.inBounds(U.mouse.cx, U.mouse.cy)) { st.hoverTower = null; return; }
    st.hoverTower = st.towerAt(U.mouse.cx, U.mouse.cy);
  }

  /* ============================================================
     绘制
     ============================================================ */
  function draw(st) {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var cv = canvas;
    var dpr = cv.width / parseFloat(cv.style.width || '1');
    /* cover 适配：世界按 worldScale 放大并居中裁切，战场铺满画布不露黑边。
       R.fit 在每次 resize 时算出 worldScale/worldOX/worldOY。 */
    var wi = R.worldInfo();
    var ws = wi.scale || 1, wox = wi.ox || 0, woy = wi.oy || 0;
    ctx.setTransform(dpr * ws, 0, 0, dpr * ws, dpr * wox, dpr * woy);

    /* 震动：只在画布内做小幅位移（ctx.translate），
       幅度已由 st.shake() 封顶到 6px —— 不碰 DOM、不碰窗口、不触发重排。
       用高频抖动 + 平方衰减，读起来是「冲击」而不是「漂移」。 */
    var sx = 0, sy = 0;
    if (st.shakeT > 0 && st.shakeAmt > 0) {
      var dur = st.shakeDur || 0.18;
      var p = st.shakeT / dur;                 /* 1 -> 0 线性剩余 */
      if (p > 1) p = 1;
      var a = st.shakeAmt * p * p;             /* 平方衰减，起始猛、收尾快 */
      var cap = st.SHAKE_MAX || 6;
      if (a > cap) a = cap;
      /* 高频：时间相关相位，避免每帧同向偏移造成整体平移感 */
      var ph = st.time * 47;
      sx = Math.sin(ph * 1.7) * a;
      sy = Math.cos(ph * 2.3) * a * 0.75;
    }
    ctx.save();
    if (sx || sy) ctx.translate(sx, sy);

    /* 悬停高亮 */
    if (st.hoverTower && st.status === 'playing') {
      var tw = st.hoverTower;
      drawHoverRing(tw);
    }

    R.render(ctx, st);
    ctx.restore();

    /* 提示条：选中塔信息浮层跟随 */
    void 0;
  }

  function drawHoverRing(tw) {
    var c = ctx;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = 'rgba(55,230,255,.5)';
    c.lineWidth = 1.6;
    c.setLineDash([5, 6]);
    c.beginPath();
    c.arc(tw.x, tw.y, C.CELL * 0.52, 0, U.TAU);
    c.stroke();
    c.restore();
  }

  G.ctx = function () { return ctx; };
  G.canvas = function () { return canvas; };

})(window);
