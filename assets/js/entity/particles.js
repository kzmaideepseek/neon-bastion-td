/* ============================================================
   particles.js — 特效粒子系统
   池化 + 定长更新，low 画质自动降规模
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U;
  var FX = NB.FX = {};

  var MAX = 1400;
  /* 软上限：达到软上限后新粒子会顶掉最老的一个，低画质下更早触发，
     避免稳态下粒子无限堆积把帧率拖垮 */
  function softCap() { return Math.round(MAX * (0.35 + qScale * 0.65)); }
  var pool = [];
  var live = 0;
  /* 画质档：high=1.0 / med=0.55 / low=0.3
     数值化后可被自适应性能系统连续调节，粒子数按比例削减 */
  var qScale = 1;
  var quality = 'high';

  function mk() {
    return {
      on: false, kind: 0, x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0,
      life: 0, max: 1, size: 2, size2: 0, color: '#fff', color2: null,
      rot: 0, vr: 0, drag: 1, glow: 0, alpha: 1, add: true, txt: '',
      /* 预生成的确定性形状数据：电弧抖动偏移 / 裂纹各分支长度。
         在 mk() 里占位是为了让池中 1400 个对象形状完全一致（V8 隐藏类稳定），
         运行时只赋值不新增字段。 */
      jagOff: null, crackLen: null
    };
  }
  for (var i = 0; i < MAX; i++) pool.push(mk());

  var cursor = 0;
  function alloc() {
    /* 超过软上限：回收一个粒子，保证新粒子总能入场，
       同时把稳态粒子数压在软上限附近。
       早期实现从游标往后找第一个活跃粒子回收，等于「最古老的先死」——
       RING/BEAM/LINE/SHOCK/CRACK/TRACER 这类长生命特效会被成片误杀。
       改为在游标附近扫一小段，优先回收剩余寿命比例最小的（快结束的），
       长生命特效因此能活到自然消亡。扫描范围固定 64，开销可忽略。 */
    if (live >= softCap()) {
      var bestQ = -1, bestRatio = 2;
      for (var q = 0; q < 64; q++) {
        var qq = (cursor + 1 + q) % MAX;
        var qp = pool[qq];
        if (!qp.on) continue;
        var ratio = qp.max > 0 ? (qp.life / qp.max) : 0;
        if (ratio < bestRatio) { bestRatio = ratio; bestQ = qq; if (ratio <= 0) break; }
      }
      if (bestQ >= 0) {
        pool[bestQ].on = false;
        pool[bestQ].jagOff = null; pool[bestQ].crackLen = null;
        live--;
      }
    }
    for (var k = 0; k < MAX; k++) {
      cursor = (cursor + 1) % MAX;
      if (!pool[cursor].on) { live++; return pool[cursor]; }
    }
    /* 池满：覆盖最老的 */
    cursor = (cursor + 1) % MAX;
    return pool[cursor];
  }

  var KIND = { SPARK: 0, SMOKE: 1, RING: 2, SHARD: 3, GLOW: 4, TEXT: 5, LINE: 6, BEAM: 7, DEBRIS: 8, TRACER: 9, SHOCK: 10, CRACK: 11 };

  /* ---------- 确定性形状数据（创建时随机一次，存活期内不变） ----------
     早期实现在渲染循环里调 Math.random() 决定电弧偏移和裂纹长度，
     后果是同一条电弧 / 同一道裂纹每一帧都换一个形状：
     视觉上是高频噪点闪烁，而不是"稳定的电弧"和"裂开的纹路"。 */
  function mkJagOff(segs) {
    var a = new Array(segs - 1);
    for (var i = 0; i < segs - 1; i++) a[i] = (Math.random() - 0.5) * 2;
    return a;
  }
  function mkCrackLens(n) {
    var a = new Array(n);
    for (var i = 0; i < n; i++) a[i] = 0.6 + Math.random() * 0.8;
    return a;
  }

  /* 粒子数量缩放：至少 1 个，避免 n 被压成 0 导致特效消失 */
  function scale() { return qScale; }
  function qn(n) { return Math.max(1, Math.round(n * qScale)); }
  /* 低画质时允许某些一次性小特效直接不生成（保持画面密度但减负） */
  function qSkip(n) {
    /* n<=3 的小装饰粒子在低档位有概率整体跳过 */
    return qScale < 0.5 && n <= 3 && Math.random() > (qScale / 0.5);
  }

  /* ============================================================
     预渲染 Glow Sprite 缓存
     —— radial gradient 每帧创建开销极大，改为按「颜色+尺寸」预渲染，
        运行时只做 drawImage。这是能同屏堆叠大量辉光特效而不掉帧的关键。
     ============================================================ */
  var spriteCache = {};
  var SPRITE_PX = 128;     /* 固定尺寸：一个颜色只缓存一张，绘制时缩放，杜绝缓存抖动 */

  /* 预渲染辉光 sprite：每种颜色一张 128px 径向渐变，drawImage 时自由缩放。
     相比「颜色×尺寸」分别缓存，条目从数百降到 ~20，稳态零创建。 */
  function glowSprite(color, size) {
    /* 防御：颜色必须是以 # 开头的合法值 */
    if (typeof color !== 'string' || color.charAt(0) !== '#') color = '#ffffff';
    var key = color;
    var s = spriteCache[key];
    if (s) return s;

    var c = document.createElement('canvas');
    c.width = SPRITE_PX; c.height = SPRITE_PX;
    var g = c.getContext('2d');
    var half = SPRITE_PX / 2;
    var gr = g.createRadialGradient(half, half, 0, half, half, half);
    gr.addColorStop(0, U.rgba(color, 1));
    gr.addColorStop(0.28, U.rgba(color, 0.72));
    gr.addColorStop(0.55, U.rgba(color, 0.28));
    gr.addColorStop(1, U.rgba(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);

    spriteCache[key] = c;
    return c;
  }
  FX.glowSprite = glowSprite;

  /* ---------- 发射接口 ---------- */
  FX.spark = function (x, y, opt) {
    opt = opt || {};
    var n = Math.max(1, Math.round((opt.n || 6) * scale()));
    if (qSkip(n)) return;
    for (var i = 0; i < n; i++) {
      var p = alloc();
      var a = opt.ang != null ? opt.ang + U.rand(-(opt.spread || 0.6), opt.spread || 0.6) : U.rand(0, U.TAU);
      var sp = U.rand(opt.spMin || 60, opt.spMax || 220);
      p.on = true; p.kind = KIND.SPARK;
      p.x = x + U.rand(-2, 2); p.y = y + U.rand(-2, 2);
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
      p.ax = 0; p.ay = 0;
      p.max = p.life = U.rand(opt.lifeMin || 0.22, opt.lifeMax || 0.5);
      p.size = U.rand(opt.sizeMin || 1.4, opt.sizeMax || 3);
      p.size2 = 0;
      p.color = opt.c1 || '#4fe3ff'; p.color2 = opt.c2 || null;
      p.drag = opt.drag == null ? 0.90 : opt.drag;
      p.glow = opt.glow == null ? 1 : opt.glow;
      p.add = true;
      p.rot = 0; p.vr = 0;
    }
  };

  FX.smoke = function (x, y, opt) {
    opt = opt || {};
    var n = Math.max(1, Math.round((opt.n || 4) * scale()));
    if (qSkip(n)) return;
    for (var i = 0; i < n; i++) {
      var p = alloc();
      var a = U.rand(0, U.TAU), sp = U.rand(6, opt.sp || 44);
      p.on = true; p.kind = KIND.SMOKE;
      p.x = x + U.rand(-4, 4); p.y = y + U.rand(-4, 4);
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp - (opt.rise || 18);
      p.ax = 0; p.ay = opt.grav == null ? -6 : opt.grav;
      p.max = p.life = U.rand(opt.lifeMin || 0.5, opt.lifeMax || 1.0);
      p.size = U.rand(opt.sizeMin || 5, opt.sizeMax || 13);
      p.size2 = p.size * U.rand(2.2, 3.6);
      p.color = opt.c1 || '#3a4756'; p.color2 = opt.c2 || '#12181f';
      p.drag = 0.94; p.glow = 0; p.add = false;
    }
  };

  FX.ring = function (x, y, opt) {
    opt = opt || {};
    var p = alloc();
    p.on = true; p.kind = KIND.RING;
    p.x = x; p.y = y;
    p.vx = 0; p.vy = 0;
    p.max = p.life = opt.life || 0.42;
    p.size = opt.r0 == null ? 3 : opt.r0;
    p.size2 = opt.r1 == null ? 40 : opt.r1;
    p.color = opt.color || '#4fe3ff';
    p.color2 = null;
    p.drag = 1; p.glow = opt.glow == null ? 1 : opt.glow; p.add = true;
    p.alpha = opt.alpha == null ? 1 : opt.alpha;
    p.rot = opt.width || 2.4;
  };

  FX.shard = function (x, y, opt) {
    opt = opt || {};
    var n = Math.max(1, Math.round((opt.n || 8) * scale()));
    for (var i = 0; i < n; i++) {
      var p = alloc();
      var a = U.rand(0, U.TAU);
      var sp = U.rand(opt.spMin || 90, opt.spMax || 320);
      p.on = true; p.kind = KIND.SHARD;
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
      p.ax = 0; p.ay = opt.grav == null ? 300 : opt.grav;
      p.max = p.life = U.rand(0.42, 0.95);
      p.size = U.rand(opt.sizeMin || 2.5, opt.sizeMax || 6);
      p.size2 = p.size * U.rand(1.4, 2.6);
      p.color = opt.c1 || '#4fe3ff'; p.color2 = opt.c2 || '#e05fd0';
      p.rot = U.rand(0, U.TAU); p.vr = U.rand(-9, 9);
      p.drag = 0.985; p.glow = opt.glow == null ? 1 : opt.glow; p.add = true;
    }
  };

  FX.glow = function (x, y, opt) {
    opt = opt || {};
    var p = alloc();
    p.on = true; p.kind = KIND.GLOW;
    p.x = x; p.y = y; p.vx = opt.vx || 0; p.vy = opt.vy || 0;
    p.ax = 0; p.ay = 0;
    p.max = p.life = opt.life || 0.24;
    p.size = opt.size || 22; p.size2 = p.size;
    p.color = opt.color || '#4fe3ff';
    p.drag = 1; p.glow = 1; p.add = true;
  };

  FX.text = function (x, y, txt, opt) {
    opt = opt || {};
    var p = alloc();
    p.on = true; p.kind = KIND.TEXT;
    p.x = x; p.y = y;
    p.vx = opt.vx == null ? U.rand(-14, 14) : opt.vx;
    p.vy = opt.vy == null ? -46 : opt.vy;
    p.ax = 0; p.ay = opt.grav == null ? 42 : opt.grav;
    p.max = p.life = opt.life || 0.85;
    p.size = opt.size || 13;
    p.color = opt.color || '#ffc93c';
    p.txt = txt;
    p.drag = 0.985; p.glow = 0; p.add = false;
    p.rot = 0; p.vr = 0;
  };

  /* 直线电弧/曳光（存活期固定） */
  FX.line = function (x1, y1, x2, y2, opt) {
    opt = opt || {};
    var p = alloc();
    p.on = true; p.kind = KIND.LINE;
    p.x = x1; p.y = y1; p.vx = x2; p.vy = y2;
    p.max = p.life = opt.life || 0.13;
    p.size = opt.width || 2;
    p.color = opt.color || '#b6f4ff';
    p.drag = 1; p.glow = 1; p.add = true;
    p.rot = opt.jag || 0;
    p.size2 = opt.jag ? (opt.seg || 7) : 0;
    /* 电弧抖动形状创建时定死（mkJagOff 返回 [-1,1] 的固定系数） */
    p.jagOff = opt.jag ? mkJagOff(p.size2 | 0) : null;
    p.alpha = opt.alpha == null ? 1 : opt.alpha;
  };

  FX.beam = function (x1, y1, x2, y2, opt) {
    opt = opt || {};
    var p = alloc();
    p.on = true; p.kind = KIND.BEAM;
    p.x = x1; p.y = y1; p.vx = x2; p.vy = y2;
    p.max = p.life = opt.life || 0.18;
    p.size = opt.width || 4;
    p.color = opt.color || '#e05fd0';
    p.color2 = opt.color2 || '#ffffff';
    p.drag = 1; p.glow = 1; p.add = true;
    p.alpha = opt.alpha == null ? 1 : opt.alpha;
  };

  /* ---------- 新增：冲击波（外扩辉光 + 收缩细环） ---------- */
  FX.shock = function (x, y, opt) {
    opt = opt || {};
    var p = alloc();
    p.on = true; p.kind = KIND.SHOCK;
    p.x = x; p.y = y; p.vx = 0; p.vy = 0;
    p.max = p.life = opt.life || 0.34;
    p.size = opt.r0 == null ? 6 : opt.r0;
    p.size2 = opt.r1 == null ? 46 : opt.r1;
    p.color = opt.color || '#ffffff';
    p.color2 = opt.color2 || '#ffffff';
    p.drag = 1; p.glow = 1; p.add = true;
    p.rot = opt.width || 2.6;
  };

  /* ---------- 新增：曳光拖尾（跟随实体，每帧调 updateTrail） ---------- */
  FX.tracer = function (x, y, opt) {
    opt = opt || {};
    var p = alloc();
    p.on = true; p.kind = KIND.TRACER;
    p.x = x; p.y = y; p.vx = 0; p.vy = 0;
    p.max = p.life = opt.life || 0.22;
    p.size = opt.width || 2.6;
    p.color = opt.color || '#ffd76a';
    p.color2 = opt.color2 || '#ffffff';
    p.trail = [];
    p.drag = 1; p.glow = 1; p.add = true;
  };
  FX.tracerPush = function (p, x, y) {
    if (!p || p.kind !== KIND.TRACER) return;
    p.trail.push(x, y);
    if (p.trail.length > 16) p.trail.splice(0, 2);
  };

  /* ---------- 新增：枪口火焰锥（多层叠加，比 glow 更像火焰） ---------- */
  FX.flame = function (x, y, ang, color) {
    var n = qn(quality === 'low' ? 2 : 3);
    for (var i = 0; i < n; i++) {
      var p = alloc();
      p.on = true; p.kind = KIND.GLOW;
      p.x = x + Math.cos(ang) * i * 3;
      p.y = y + Math.sin(ang) * i * 3;
      p.vx = Math.cos(ang) * (110 + i * 55);
      p.vy = Math.sin(ang) * (110 + i * 55);
      p.ax = -Math.cos(ang) * 90;
      p.ay = -Math.sin(ang) * 90;
      p.max = p.life = (0.13 - i * 0.03);
      p.size = 15 - i * 4;
      p.size2 = p.size;
      p.color = i === 0 ? '#ffffff' : color;
      p.drag = 0.90; p.glow = 1; p.add = true;
    }
  };

  /* ---------- 新增：命中裂纹 ---------- */
  FX.crack = function (x, y, opt) {
    opt = opt || {};
    var p = alloc();
    p.on = true; p.kind = KIND.CRACK;
    p.x = x; p.y = y; p.vx = 0; p.vy = 0;
    p.max = p.life = opt.life || 0.20;
    p.size = opt.len || 12;
    p.size2 = opt.n || 5;
    p.rot = Math.random() * U.TAU;
    /* 各分支长度创建时定死，避免每帧重算让裂纹持续抽动 */
    p.crackLen = mkCrackLens(p.size2 | 0);
    p.color = opt.color || '#ffffff';
    p.color2 = opt.color2 || '#ffffff';
    p.drag = 1; p.glow = 1; p.add = true;
  };

  /* ---------- 增强：枪口焰（火焰锥 + 火花 + 冲击微环） ---------- */
  FX.muzzle = function (x, y, ang, color) {
    FX.flame(x, y, ang, color);
    FX.spark(x, y, {
      ang: ang, spread: 0.34, n: qn(quality === 'low' ? 3 : 5),
      c1: color, c2: '#ffffff',
      spMin: 120, spMax: 300, lifeMin: 0.08, lifeMax: 0.2,
      sizeMin: 1.2, sizeMax: 2.6, drag: 0.86
    });
    FX.shock(x + Math.cos(ang) * 5, y + Math.sin(ang) * 5, {
      r0: 2, r1: 16, life: 0.16, color: color, color2: '#ffffff', width: 1.6
    });
  };

  /* ---------- 增强：命中（火花 + 冲击环 + 裂纹） ---------- */
  FX.hitBurst = function (x, y, color, amount) {
    FX.spark(x, y, {
      n: amount || 6, c1: color, c2: '#ffffff',
      spMin: 50, spMax: 190, lifeMin: 0.14, lifeMax: 0.34,
      sizeMin: 1.1, sizeMax: 2.4, drag: 0.88
    });
    FX.shock(x, y, { r0: 3, r1: 15, life: 0.20, color: color, color2: '#ffffff', width: 1.6 });
    FX.crack(x, y, { len: 9, n: 5, life: 0.18, color2: color });
    FX.glow(x, y, { size: 16, life: 0.14, color: color });
  };

  /* ---------- 增强：爆炸（冲击波 + 火球 + 碎片 + 烟 + 余烬） ---------- */
  FX.explode = function (x, y, opt) {
    opt = opt || {};
    var s = opt.scale || 1;
    var c = opt.color || '#ff7a2a';
    /* 主冲击波 */
    FX.shock(x, y, {
      r0: 8 * s, r1: 58 * s, life: 0.40, color: c, color2: '#ffffff', width: 3.4 * s
    });
    /* 内层白炽环 */
    FX.shock(x, y, {
      r0: 3 * s, r1: 30 * s, life: 0.24, color: '#ffffff', color2: c, width: 2.2 * s
    });
    /* 火球核心 */
    FX.glow(x, y, { size: 46 * s, life: 0.24, color: c });
    FX.glow(x, y, { size: 26 * s, life: 0.18, color: '#ffffff' });
    /* 火花 */
    FX.spark(x, y, {
      n: (opt.n || 14) * s, c1: c, c2: opt.c2 || '#ffc93c',
      spMin: 70 * s, spMax: 340 * s, lifeMin: 0.2, lifeMax: 0.6,
      sizeMin: 1.4, sizeMax: 3.6 * s, drag: 0.9
    });
    /* 上浮火星 */
    FX.spark(x, y, {
      n: Math.round(6 * s), c1: '#ffc93c', c2: '#ff7a2a',
      spMin: 30, spMax: 110, lifeMin: 0.5, lifeMax: 1.1,
      sizeMin: 1.2, sizeMax: 2.6, grav: -70, drag: 0.96
    });
    /* 烟 */
    FX.smoke(x, y, {
      n: (opt.smoke || 4) * s, c1: '#4a3d2e', c2: '#181310',
      sp: 46 * s, rise: 26, sizeMin: 5 * s, sizeMax: 15 * s,
      lifeMin: 0.45, lifeMax: 0.95
    });
    /* 碎片 */
    if (opt.shards !== false) {
      FX.shard(x, y, {
        n: (opt.shards || 6) * s, c1: c, c2: opt.c2 || '#ffc93c',
        spMin: 100, spMax: 360
      });
    }
  };

  /* ---------- 增强：死亡（内爆 + 外扩 + 碎片） ---------- */
  FX.death = function (x, y, color, size) {
    var s = size || 1;
    /* 先内爆再外扩，更有冲击节奏 */
    FX.shock(x, y, { r0: 16 * s, r1: 2, life: 0.12, color: '#ffffff', color2: color, width: 1.8 * s });
    FX.shock(x, y, { r0: 3, r1: 26 * s, life: 0.30, color: color, color2: '#ffffff', width: 2 * s });
    FX.spark(x, y, {
      n: 8 * s, c1: color, c2: '#ffffff',
      spMin: 60, spMax: 230 * s, lifeMin: 0.16, lifeMax: 0.42,
      sizeMin: 1.2, sizeMax: 2.8 * s
    });
    FX.glow(x, y, { size: 24 * s, life: 0.18, color: color });
    FX.crack(x, y, { len: 12 * s, n: 7, life: 0.22, color2: color });
    FX.shard(x, y, {
      n: Math.round(5 * s), c1: color, c2: '#ffffff',
      spMin: 80, spMax: 240, grav: 200, lifeMax: 0.7
    });
  };

  FX.build = function (x, y, color) {
    FX.ring(x, y, { r0: 30, r1: 4, life: 0.42, color: color, width: 2.6 });
    FX.spark(x, y, {
      n: 14, c1: color, c2: '#ffffff', spMin: 60, spMax: 190,
      lifeMin: 0.2, lifeMax: 0.5, drag: 0.88
    });
    FX.ring(x, y, { r0: 4, r1: 26, life: 0.34, color: '#ffffff', width: 1.6, alpha: 0.7 });
  };

  FX.upgrade = function (x, y, color) {
    FX.ring(x, y, { r0: 6, r1: 40, life: 0.5, color: color, width: 2.4 });
    FX.spark(x, y, {
      n: 16, c1: color, c2: '#ffffff', spMin: 40, spMax: 170,
      lifeMin: 0.3, lifeMax: 0.72, drag: 0.93, grav: -20
    });
    FX.glow(x, y, { size: 34, life: 0.3, color: color });
  };

  FX.coin = function (x, y, amount) {
    FX.text(x + U.rand(-8, 8), y, '+' + amount, {
      color: '#ffc93c', size: 13, life: 0.8, vy: -52, vx: U.rand(-20, 20)
    });
  };

  FX.frostPulse = function (x, y, r, color) {
    FX.ring(x, y, { r0: r * 0.5, r1: r, life: 0.55, color: color || '#8fd8ff', width: 1.8, alpha: 0.6 });
  };

  FX.charge = function (x, y, color) {
    FX.glow(x, y, { size: 16, life: 0.1, color: color || '#b6f4ff' });
  };

  /* 回收时清掉形状数据引用，避免已淘汰粒子被数组长期持有 */
  FX.clearAll = function () {
    for (var i = 0; i < MAX; i++) { pool[i].on = false; pool[i].jagOff = null; pool[i].crackLen = null; }
    live = 0; cursor = 0;
  };

  FX.count = function () { return live; };
  FX.softCap = softCap;
  var QMAP = { high: 1, med: 0.55, low: 0.3 };
  FX.setQuality = function (q) {
    quality = q;
    qScale = (q in QMAP) ? QMAP[q] : (typeof q === 'number' ? U.clamp(q, 0.1, 1) : 1);
  };
  FX.getQuality = function () { return quality; };
  FX.getScale = function () { return qScale; };

  /* ---------- 更新 ---------- */
  FX.update = function (dt) {
    for (var i = 0; i < MAX; i++) {
      var p = pool[i];
      if (!p.on) continue;
      p.life -= dt;
      if (p.life <= 0) { p.on = false; live--; continue; }
      if (p.kind === KIND.RING || p.kind === KIND.GLOW || p.kind === KIND.LINE ||
        p.kind === KIND.BEAM || p.kind === KIND.SHOCK || p.kind === KIND.CRACK ||
        p.kind === KIND.TRACER) continue;
      p.vx += p.ax * dt; p.vy += p.ay * dt;
      if (p.drag !== 1) {
        var d = Math.pow(p.drag, dt * 60);
        p.vx *= d; p.vy *= d;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.vr) p.rot += p.vr * dt;
    }
  };

  /* ---------- 渲染 ---------- */
  /* 透明度曲线：先淡入后淡出。
     注意必须夹取到 [0,1] —— p.life/p.max 存在浮点误差，
     未夹取时会产出 1.012 这类非法 alpha，导致 addColorStop 抛异常。 */
  function alphaOf(p) {
    var t = U.clamp(p.life / p.max, 0, 1);
    var a = t > 0.82 ? (1 - t) / 0.18 : t / 0.82;
    return U.clamp(a, 0, 1);
  }

  FX.render = function (ctx) {
    var i, p;
    /* 先绘制非加法（烟雾/文字） */
    ctx.save();
    for (i = 0; i < MAX; i++) {
      p = pool[i];
      if (!p.on || p.add) continue;
      var a = alphaOf(p);
      if (a <= 0) continue;
      if (p.kind === KIND.SMOKE) {
        /* 烟雾：预渲染 sprite 替代每帧渐变（烟雾为柔和暗团，单色ramp等效） */
        var r = p.size + (p.size2 - p.size) * (1 - p.life / p.max);
        var sp = glowSprite(p.color, r);
        ctx.globalAlpha = a * 0.55;
        var sw = r * 2;
        ctx.drawImage(sp, p.x - r, p.y - r, sw, sw);
        ctx.globalAlpha = 1;
      } else if (p.kind === KIND.TEXT) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, a * 1.4);
        ctx.font = '700 ' + p.size + 'px Consolas,monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)';
        ctx.strokeText(p.txt, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.txt, p.x, p.y);
        ctx.restore();
      } else if (p.kind === KIND.SHARD) {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        var sx = p.size * (0.4 + a * 0.6);
        ctx.fillRect(-sx / 2, -p.size2 * 0.5 * a, sx, p.size2 * a);
        ctx.restore();
      }
    }
    ctx.restore();

    /* 加法混合层 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < MAX; i++) {
      p = pool[i];
      if (!p.on || !p.add) continue;
      var al = alphaOf(p);
      if (al <= 0) continue;
      if (p.kind === KIND.SPARK) {
        var t = al;
        ctx.globalAlpha = t;
        ctx.fillStyle = t > 0.55 ? p.color2 || '#ffffff' : p.color;
        var s = p.size * (0.35 + t * 0.85);
        ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, U.TAU); ctx.fill();
      } else if (p.kind === KIND.RING) {
        var rr = p.size + (p.size2 - p.size) * (1 - al);
        ctx.globalAlpha = al * (p.alpha == null ? 1 : p.alpha);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(0.6, p.rot * al);
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, U.TAU); ctx.stroke();
      } else if (p.kind === KIND.GLOW) {
        /* 预渲染 sprite：drawImage 远比每帧 createRadialGradient 快 */
        var sp = glowSprite(p.color, p.size);
        var sw = p.size * 2 * al;
        ctx.globalAlpha = al * 0.9;
        ctx.drawImage(sp, p.x - sw / 2, p.y - sw / 2, sw, sw);
      } else if (p.kind === KIND.SHOCK) {
        /* 冲击波：外扩辉光 + 收缩细环 */
        var tp = 1 - p.life / p.max;
        var rr2 = p.size + (p.size2 - p.size) * tp;
        ctx.globalAlpha = (1 - tp) * 0.85;
        var sg2 = glowSprite(p.color, rr2);
        ctx.drawImage(sg2, p.x - rr2, p.y - rr2, rr2 * 2, rr2 * 2);
        ctx.globalAlpha = (1 - tp) * 0.55;
        ctx.strokeStyle = p.color2 || '#ffffff';
        ctx.lineWidth = Math.max(0.8, (p.rot || 2) * (1 - tp));
        ctx.beginPath(); ctx.arc(p.x, p.y, rr2 * 0.96, 0, U.TAU); ctx.stroke();
      } else if (p.kind === KIND.TRACER) {
        /* 曳光：沿拖尾路径的渐隐亮线 */
        if (p.trail && p.trail.length >= 4) {
          ctx.globalAlpha = al * 0.9;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.trail[0], p.trail[1]);
          for (var tr = 2; tr < p.trail.length; tr += 2) ctx.lineTo(p.trail[tr], p.trail[tr + 1]);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          ctx.strokeStyle = p.color2 || '#ffffff';
          ctx.lineWidth = p.size * 0.42;
          ctx.stroke();
        }
      } else if (p.kind === KIND.CRACK) {
        /* 命中裂纹：从中心放射的短线 */
        ctx.globalAlpha = al * 0.85;
        ctx.strokeStyle = p.color2 || '#ffffff';
        ctx.lineWidth = p.size;
        ctx.beginPath();
        var cn = p.size2 | 0;
        for (var cr = 0; cr < cn; cr++) {
          var ca = (cr / cn) * U.TAU + p.rot;
          var len = p.size * (p.crackLen ? p.crackLen[cr] : 1);
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + Math.cos(ca) * len, p.y + Math.sin(ca) * len);
        }
        ctx.stroke();
      } else if (p.kind === KIND.LINE) {
        ctx.globalAlpha = al * (p.alpha == null ? 1 : p.alpha);
        var x1 = p.x, y1 = p.y, x2 = p.vx, y2 = p.vy;
        if (p.size2 > 0) {
          /* 抖动电弧 */
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.shadowColor = p.color; ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.moveTo(x1, y1);
          var segs = p.size2 | 0;
          for (var k = 1; k < segs; k++) {
            var tt = k / segs;
            var mx = x1 + (x2 - x1) * tt, my = y1 + (y2 - y1) * tt;
            var nx = -(y2 - y1), ny = (x2 - x1);
            var nl = Math.sqrt(nx * nx + ny * ny) || 1;
            /* 幅度 = rot（创建时传入的抖动强度）× 固定系数 × 中凸包络，
               整条电弧的形状在存活期内保持不变 */
            var off = (p.jagOff ? p.jagOff[k - 1] : 0) * p.rot * Math.sin(tt * Math.PI);
            ctx.lineTo(mx + nx / nl * off, my + ny / nl * off);
          }
          ctx.lineTo(x2, y2); ctx.stroke();
          ctx.shadowBlur = 0;
        } else {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
      } else if (p.kind === KIND.BEAM) {
        var bw = p.size * (0.35 + al * 0.9);
        ctx.globalAlpha = al;
        ctx.strokeStyle = p.color2;
        ctx.lineWidth = bw * 2.4;
        ctx.shadowColor = p.color; ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.vx, p.vy); ctx.stroke();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = bw;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.vx, p.vy); ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  };

})(window);
