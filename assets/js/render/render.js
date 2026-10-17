/* ============================================================
   render.js — Canvas 渲染器
   负责：战场背景、网格、路径、基地、炮塔、敌人、特效叠加、HUD 覆盖层
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U, C = NB.CFG, FX = NB.FX, P = NB.Path, Ent = NB.Ent;
  var R = NB.Render = {};

  var W = P.WIDTH, H = P.HEIGHT;
  var quality = 'high';
  var qTier = 0;
  /* high=0 / med=1 / low=2 / minimal=3
     minimal 保留同样的粒子比例，但渲染器跳过逐塔武器美术。 */
  var QTIER = { high: 0, med: 1, low: 2, minimal: 3 };
  R.setQuality = function (q) {
    quality = q;
    qTier = (q in QTIER) ? QTIER[q] : 0;
    FX.setQuality(q);
  };
  R.tier = function () { return qTier; };

  /* 预渲染静态背景层（装甲甲板 + 路径） */
  var bgCache = null, bgKey = '';

  /* ============================================================
     渐变缓存
     —— 每帧数百次 createLinearGradient/RadialGradient 是主要
        GC 压力源（30 座塔 × 每塔 6~8 个渐变 ≈ 200 个/帧）。
     —— Canvas 渐变的坐标在「绘制时」按当前用户空间解析，
        因此局部坐标系创建的梯度可在不同 translate 的炮塔 /
        敌人上复用；按 key 缓存，上下文变更或超量时重建。
     ============================================================ */
  var _ctx = null;
  var gradCache = {};
  var gradKeys = [];        /* 插入顺序，用于淘汰 */
  var GRAD_MAX = 400;       /* 容量上限：键基数随敌人/武器种类增长，留足余量 */

  /* 存入缓存；满了按插入顺序淘汰最老的一个。
     早期实现是「满了就停止缓存新键」—— 那等于给性能挖了另一道悬崖：
     一旦触顶，之后所有新键每帧重建，帧率会突然劣化且不会恢复。
     淘汰单个最老键的成本远低于整体清空，也不会让热点键突然全部失效。 */
  function gradPut(key, g) {
    if (gradKeys.length >= GRAD_MAX) {
      var drop = gradKeys.shift();
      if (drop !== key) delete gradCache[drop];
    }
    gradCache[key] = g;
    gradKeys.push(key);
    return g;
  }

  function gradL(key, x0, y0, x1, y1, stops) {
    var g = gradCache[key];
    if (g) return g;
    g = _ctx.createLinearGradient(x0, y0, x1, y1);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return gradPut(key, g);
  }
  function gradR(key, x0, y0, r0, x1, y1, r1, stops) {
    var g = gradCache[key];
    if (g) return g;
    g = _ctx.createRadialGradient(x0, y0, r0, x1, y1, r1, stops);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return gradPut(key, g);
  }
  /* 上下文变更时废弃缓存（理论上整个会话只有一个 ctx） */
  function bindCtx(c) {
    if (_ctx !== c) { _ctx = c; gradCache = {}; gradKeys = []; }
  }

  function buildBG(map) {
    var c = document.createElement('canvas');
    var dpr = Math.min(w.devicePixelRatio || 1, 2);
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* --- 机甲甲板底色：金属拉丝 --- */
    var bg = g.createLinearGradient(140, 0, W - 120, H);
    bg.addColorStop(0, '#101821');
    bg.addColorStop(0.42, '#0c141c');
    bg.addColorStop(0.72, '#0a1118');
    bg.addColorStop(1, '#060a0f');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    /* 拉丝纹理：细密横线 */
    g.globalAlpha = 0.5;
    for (var y = 0; y < H; y += 3) {
      g.fillStyle = (y % 6 === 0) ? 'rgba(140,180,215,.020)' : 'rgba(0,0,0,.14)';
      g.fillRect(0, y, W, 1.4);
    }
    g.globalAlpha = 1;

    /* 中心环境光 */
    var rg = g.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.68);
    rg.addColorStop(0, 'rgba(46,96,140,.20)');
    rg.addColorStop(0.55, 'rgba(24,50,76,.09)');
    rg.addColorStop(1, 'rgba(3,6,10,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);

    /* --- 装甲板块：错缝矩形（低对比，作为底纹） --- */
    var PW = 178, PH = 118;
    for (var py = 0; py < H; py += PH) {
      var off = (Math.floor(py / PH) % 2) ? PW / 2 : 0;
      for (var px = -PW / 2 + off; px < W; px += PW) {
        var x0 = Math.max(0, px), y0 = py;
        var x1 = Math.min(W, px + PW - 4), y1 = Math.min(H, py + PH - 4);
        if (x1 <= x0 || y1 <= y0) continue;
        /* 板缝：细弱暗线 */
        g.strokeStyle = 'rgba(0,0,0,.34)';
        g.lineWidth = 1;
        g.strokeRect(x0, y0, x1 - x0, y1 - y0);
        /* 板面上缘微高光 */
        g.strokeStyle = 'rgba(160,200,235,.05)';
        g.beginPath();
        g.moveTo(x0, y0 + 0.5); g.lineTo(x1, y0 + 0.5);
        g.stroke();
      }
    }

    /* --- 能量网格（细） --- */
    var CELL = C.CELL;
    g.strokeStyle = 'rgba(79,227,255,.045)';
    g.lineWidth = 1;
    g.beginPath();
    for (var x = 0; x <= W; x += CELL) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
    for (var yy = 0; yy <= H; yy += CELL) { g.moveTo(0, yy + 0.5); g.lineTo(W, yy + 0.5); }
    g.stroke();

    /* 每 4 格主网格 */
    g.strokeStyle = 'rgba(79,227,255,.10)';
    g.beginPath();
    for (var x2 = 0; x2 <= W; x2 += CELL * 4) { g.moveTo(x2 + 0.5, 0); g.lineTo(x2 + 0.5, H); }
    for (var y2 = 0; y2 <= H; y2 += CELL * 4) { g.moveTo(0, y2 + 0.5); g.lineTo(W, y2 + 0.5); }
    g.stroke();

    /* 十字靶标 */
    g.strokeStyle = 'rgba(140,200,235,.20)';
    g.lineWidth = 1.2;
    g.beginPath();
    for (var x3 = 0; x3 <= W; x3 += CELL * 4) {
      for (var y3 = 0; y3 <= H; y3 += CELL * 4) {
        g.moveTo(x3 - 4, y3 + 0.5); g.lineTo(x3 + 4, y3 + 0.5);
        g.moveTo(x3 + 0.5, y3 - 4); g.lineTo(x3 + 0.5, y3 + 4);
        g.beginPath(); g.arc(x3, y3, 2.2, 0, U.TAU); g.stroke();
      }
    }
    g.stroke();

    /* --- 可建造格：嵌槽底 --- */
    for (var gy = 0; gy < C.GRID_H; gy++) {
      for (var gx = 0; gx < C.GRID_W; gx++) {
        if (map.blocked[gy * C.GRID_W + gx] !== 0) continue;
        var bx = gx * CELL, by = gy * CELL;
        g.fillStyle = 'rgba(70,160,205,.030)';
        g.fillRect(bx + 3, by + 3, CELL - 6, CELL - 6);
        g.strokeStyle = 'rgba(90,180,225,.07)';
        g.lineWidth = 1;
        /* 四角定位标记 */
        var m = 6, L = 5;
        g.beginPath();
        g.moveTo(bx + 3, by + 3 + m); g.lineTo(bx + 3, by + 3); g.lineTo(bx + 3 + m, by + 3);
        g.moveTo(bx + CELL - 3 - m, by + 3); g.lineTo(bx + CELL - 3, by + 3); g.lineTo(bx + CELL - 3, by + 3 + m);
        g.moveTo(bx + 3, by + CELL - 3 - m); g.lineTo(bx + 3, by + CELL - 3); g.lineTo(bx + 3 + m, by + CELL - 3);
        g.moveTo(bx + CELL - 3 - m, by + CELL - 3); g.lineTo(bx + CELL - 3, by + CELL - 3); g.lineTo(bx + CELL - 3, by + CELL - 3 - m);
        g.stroke();
        void L;
      }
    }

    /* --- 路径：主沟槽（视觉主角，明亮可辨） + 备用沟槽（暗） --- */
    drawPathFull(g, map);
    for (var dpi = 1; dpi < map.paths.length; dpi++) drawPathSimple(g, map, dpi);

    /* 运输轨枕（仅主路径） */
    g.strokeStyle = 'rgba(0,0,0,.42)';
    g.lineWidth = 3.4;
    for (var si = 0; si < map.segs.length; si++) {
      var sg = map.segs[si];
      var step = 30;
      for (var d = 0; d <= sg.len; d += step) {
        var px2 = sg.ax + (sg.bx - sg.ax) * (d / sg.len);
        var py2 = sg.ay + (sg.by - sg.ay) * (d / sg.len);
        var nx = -Math.sin(sg.ang) * (C.CELL * 0.28);
        var ny = Math.cos(sg.ang) * (C.CELL * 0.28);
        g.beginPath();
        g.moveTo(px2 - nx, py2 - ny);
        g.lineTo(px2 + nx, py2 + ny);
        g.stroke();
      }
    }
    /* 轨枕高光 */
    g.strokeStyle = 'rgba(160,215,250,.26)';
    g.lineWidth = 1.6;
    for (var si2 = 0; si2 < map.segs.length; si2++) {
      var sg3 = map.segs[si2];
      var step2 = 30;
      for (var d2 = 0; d2 <= sg3.len; d2 += step2) {
        var px3 = sg3.ax + (sg3.bx - sg3.ax) * (d2 / sg3.len);
        var py3 = sg3.ay + (sg3.by - sg3.ay) * (d2 / sg3.len);
        var nx2 = -Math.sin(sg3.ang) * (C.CELL * 0.28);
        var ny2 = Math.cos(sg3.ang) * (C.CELL * 0.28);
        g.beginPath();
        g.moveTo(px3 - nx2, py3 - ny2 - 1);
        g.lineTo(px3 + nx2, py3 + ny2 - 1);
        g.stroke();
      }
    }

    /* --- 外框：厚重装甲 --- */
    g.strokeStyle = 'rgba(0,0,0,.85)';
    g.lineWidth = 10;
    g.strokeRect(0, 0, W, H);
    g.strokeStyle = 'rgba(130,175,215,.34)';
    g.lineWidth = 3;
    g.strokeRect(5, 5, W - 10, H - 10);
    g.strokeStyle = 'rgba(0,0,0,.6)';
    g.lineWidth = 2;
    g.strokeRect(11, 11, W - 22, H - 22);

    /* 四角装甲块 + 警示斜纹 */
    var cl = 40;
    var corners = [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]];
    for (var ci = 0; ci < corners.length; ci++) {
      var cx = corners[ci][0], cy = corners[ci][1], sx = corners[ci][2], sy = corners[ci][3];
      /* L 形装甲角 */
      g.fillStyle = 'rgba(40,55,70,.9)';
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + sx * cl, cy);
      g.lineTo(cx + sx * cl, cy + sy * 9);
      g.lineTo(cx + sx * 9, cy + sy * 9);
      g.lineTo(cx + sx * 9, cy + sy * cl);
      g.lineTo(cx, cy + sy * cl);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(150,200,235,.42)';
      g.lineWidth = 2;
      g.stroke();
      /* 角内警示斜纹 */
      g.save();
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + sx * cl, cy);
      g.lineTo(cx + sx * cl, cy + sy * 9);
      g.lineTo(cx + sx * 9, cy + sy * 9);
      g.lineTo(cx + sx * 9, cy + sy * cl);
      g.lineTo(cx, cy + sy * cl);
      g.closePath();
      g.clip();
      g.strokeStyle = 'rgba(255,210,61,.30)';
      g.lineWidth = 3;
      for (var k = -60; k < 120; k += 11) {
        g.beginPath();
        g.moveTo(cx + sx * k, cy);
        g.lineTo(cx + sx * (k + 70), cy + sy * 70);
        g.stroke();
      }
      g.restore();
      /* 铆钉 */
      g.fillStyle = 'rgba(190,220,245,.35)';
      for (var rv = 12; rv < cl - 4; rv += 11) {
        g.beginPath(); g.arc(cx + sx * rv, cy + sy * 4.5, 2, 0, U.TAU); g.fill();
        g.beginPath(); g.arc(cx + sx * 4.5, cy + sy * rv, 2, 0, U.TAU); g.fill();
      }
    }

    /* 静态装饰预渲染进背景（之后每帧只画动态部件） */
    if (map.decor && map.decor.length) drawDecorStatic(g, map);

    return c;
  }

  function tracePath(g, map, pi) {
    var pth = map.paths && map.paths[pi || 0];
    var n = pth ? pth.nodes : map.nodes;
    g.beginPath();
    g.moveTo(n[0].x, n[0].y);
    for (var i = 1; i < n.length; i++) g.lineTo(n[i].x, n[i].y);
  }

  /* 完整沟槽绘制（主路径） */
  function drawPathFull(g, map) {
    g.lineCap = 'butt';
    g.lineJoin = 'miter';
    tracePath(g, map, 0);
    g.strokeStyle = 'rgba(0,0,0,.85)';
    g.lineWidth = C.CELL * 0.94;
    g.stroke();
    g.strokeStyle = '#2c3d4e';
    g.lineWidth = C.CELL * 0.84;
    g.stroke();
    g.strokeStyle = '#0d151d';
    g.lineWidth = C.CELL * 0.70;
    g.stroke();
    var pg = g.createLinearGradient(0, 0, W * 0.4, H);
    pg.addColorStop(0, '#31536e');
    pg.addColorStop(0.5, '#28455c');
    pg.addColorStop(1, '#1e3648');
    g.strokeStyle = pg;
    g.lineWidth = C.CELL * 0.54;
    g.stroke();
    g.strokeStyle = 'rgba(150,205,245,.30)';
    g.lineWidth = 1.6;
    g.stroke();
  }

  /* 简化沟槽（备用路径：暗一档，提示存在但未激活） */
  function drawPathSimple(g, map, pi) {
    g.lineCap = 'butt';
    g.lineJoin = 'miter';
    tracePath(g, map, pi);
    g.strokeStyle = 'rgba(0,0,0,.6)';
    g.lineWidth = C.CELL * 0.80;
    g.stroke();
    g.strokeStyle = '#233242';
    g.lineWidth = C.CELL * 0.60;
    g.stroke();
    g.strokeStyle = '#1b2c3a';
    g.lineWidth = C.CELL * 0.40;
    g.stroke();
    g.strokeStyle = 'rgba(150,205,245,.12)';
    g.lineWidth = 1.3;
    g.stroke();
  }

  /* ============================================================
     场景装饰：随机厂区设施，纯装饰不影响建造
     ============================================================ */
  /* 静态装饰：一次性预渲染进背景层（大幅降低每帧绘制量） */
  function drawDecorStatic(g, map) {
    var d = map.decor;
    for (var i = 0; i < d.length; i++) {
      var o = d[i];
      if (o.kind === 'vent' || o.kind === 'cooler') continue;
      g.save();
      g.translate(o.x, o.y);
      g.rotate(o.rot);
      g.scale(o.s, o.s);
      switch (o.kind) {
        case 'tank': drawDecorTank(g, o); break;
        case 'crate': drawDecorCrate(g, o); break;
        case 'breaker': drawDecorBreaker(g, o); break;
        case 'pipe': drawDecorPipe(g, o); break;
      }
      g.restore();
    }
  }

  /* 动态装饰：只画带动画部件（风扇/蒸汽/警示灯），数量仅 1/3 */
  function drawDecor(ctx, map, t) {
    var d = map.decor;
    for (var i = 0; i < d.length; i++) {
      var o = d[i];
      if (o.kind !== 'vent' && o.kind !== 'cooler') continue;
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(o.rot);
      var s = o.s;
      ctx.scale(s, s);
      switch (o.kind) {
        case 'vent': drawDecorVent(ctx, o, t); break;
        case 'cooler': drawDecorCooler(ctx, o, t); break;
      }
      ctx.restore();
    }
  }

  /* 储罐 */
  function drawDecorTank(ctx, o) {
    ctx.fillStyle = 'rgba(0,0,0,.34)';
    ctx.beginPath(); ctx.ellipse(0, 13, 15, 5, 0, 0, U.TAU); ctx.fill();
    /* 罐体 */
    var g = gradL('d_tank', -14, -12, 14, 12, [
      [0, '#3f4d59'], [0.45, '#2b3640'], [1, '#1a222a']]);
    ctx.fillStyle = g;
    roundRect(ctx, -13, -12, 26, 25, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,195,230,.28)'; ctx.lineWidth = 1.2; ctx.stroke();
    /* 箍环 */
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-13, -3); ctx.lineTo(13, -3);
    ctx.moveTo(-13, 6); ctx.lineTo(13, 6);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(170,210,240,.18)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-13, -5); ctx.lineTo(13, -5);
    ctx.moveTo(-13, 4); ctx.lineTo(13, 4);
    ctx.stroke();
    /* 顶部阀门 */
    ctx.fillStyle = '#242e38';
    roundRect(ctx, -4, -17, 8, 6, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,61,.4)'; ctx.lineWidth = 1; ctx.stroke();
  }

  /* 集装箱 */
  function drawDecorCrate(ctx, o) {
    var w = 20 + (o.variant % 2) * 6, h = 14 + ((o.variant >> 1) % 2) * 4;
    ctx.fillStyle = 'rgba(0,0,0,.34)';
    ctx.beginPath(); ctx.ellipse(0, h * 0.62, w * 0.56, 4, 0, 0, U.TAU); ctx.fill();
    /* 波纹侧板 */
    var g = gradL('d_crate' + w + '_' + h, -w / 2, -h / 2, w / 2, h / 2, [
      [0, '#4a3a22'], [0.5, '#33291a'], [1, '#221b12']]);
    ctx.fillStyle = g;
    roundRect(ctx, -w / 2, -h / 2, w, h, 2.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,200,235,.24)'; ctx.lineWidth = 1.1; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (var i = 1; i < 5; i++) {
      var px = -w / 2 + (w / 5) * i;
      ctx.moveTo(px, -h / 2 + 2); ctx.lineTo(px, h / 2 - 2);
    }
    ctx.stroke();
    /* 顶盖高光 */
    ctx.fillStyle = 'rgba(190,220,245,.10)';
    ctx.fillRect(-w / 2 + 2, -h / 2 + 1.5, w - 4, 2);
  }

  /* 通风塔 */
  function drawDecorVent(ctx, o, t) {
    ctx.fillStyle = 'rgba(0,0,0,.34)';
    ctx.beginPath(); ctx.ellipse(0, 15, 12, 4, 0, 0, U.TAU); ctx.fill();
    /* 塔身 */
    var g = gradL('d_vent', -10, -16, 10, 14, [
      [0, '#39454f'], [1, '#1c242c']]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-7, 14); ctx.lineTo(-5, -14); ctx.lineTo(5, -14); ctx.lineTo(7, 14);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(150,195,230,.26)'; ctx.lineWidth = 1.1; ctx.stroke();
    /* 百叶窗 */
    ctx.fillStyle = 'rgba(6,10,14,.75)';
    ctx.fillRect(-6, -11, 12, 8);
    ctx.strokeStyle = 'rgba(120,160,195,.24)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < 4; i++) {
      var y = -10 + i * 2.2;
      ctx.moveTo(-5.4, y); ctx.lineTo(5.4, y);
    }
    ctx.stroke();
    /* 旋转风扇 */
    var spin = t * (1.2 + (o.variant % 3) * 0.4) + o.phase;
    ctx.save();
    ctx.translate(0, -7);
    ctx.globalCompositeOperation = 'lighter';
    ctx.rotate(spin);
    ctx.strokeStyle = 'rgba(140,200,235,.22)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-5, 0); ctx.lineTo(5, 0);
    ctx.moveTo(0, -5); ctx.lineTo(0, 5);
    ctx.stroke();
    ctx.restore();
    /* 警示灯 */
    var blink = (Math.sin(t * 3 + o.phase) > 0.4);
    ctx.fillStyle = blink ? 'rgba(255,59,71,.9)' : 'rgba(120,40,50,.5)';
    ctx.beginPath(); ctx.arc(0, -17, 2, 0, U.TAU); ctx.fill();
  }

  /* 冷却柱 */
  function drawDecorCooler(ctx, o, t) {
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath(); ctx.ellipse(0, 14, 11, 4, 0, 0, U.TAU); ctx.fill();
    /* 主体 */
    var g = gradL('d_cool', -10, -14, 10, 14, [
      [0, '#2f4450'], [0.5, '#1e2c35'], [1, '#131b22']]);
    ctx.fillStyle = g;
    roundRect(ctx, -9, -13, 18, 27, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(130,190,225,.28)'; ctx.lineWidth = 1.2; ctx.stroke();
    /* 散热鳍片 */
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var y = -10 + i * 3.4;
      ctx.moveTo(-8, y); ctx.lineTo(8, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,190,230,.16)'; ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (var i2 = 0; i2 < 6; i2++) {
      var y2 = -10 + i2 * 3.4;
      ctx.moveTo(-8, y2 + 1.2); ctx.lineTo(8, y2 + 1.2);
    }
    ctx.stroke();
    /* 顶部蒸汽 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var ph = (t * 0.5 + o.phase) % 1;
    ctx.globalAlpha = (1 - ph) * 0.20;
    var sg = gradR('d_stm' + (ph * 5 | 0), 0, -14 - ph * 16, 0, 0, -14 - ph * 16, 9 + ph * 8, [
      [0, 'rgba(180,215,240,.7)'],
      [1, 'rgba(180,215,240,0)']]);
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(0, -14 - ph * 16, 9 + ph * 8, 0, U.TAU); ctx.fill();
    ctx.restore();
  }

  /* 配电箱 */
  function drawDecorBreaker(ctx, o) {
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath(); ctx.ellipse(0, 11, 9, 3.4, 0, 0, U.TAU); ctx.fill();
    var g = gradL('d_brk', -8, -11, 8, 11, [
      [0, '#3d4552'], [1, '#1a2028']]);
    ctx.fillStyle = g;
    roundRect(ctx, -7.5, -10, 15, 21, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,195,230,.3)'; ctx.lineWidth = 1.1; ctx.stroke();
    /* 门缝 + 把手 */
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.stroke();
    ctx.fillStyle = 'rgba(200,225,245,.35)';
    ctx.fillRect(-6, -2, 2, 4);
    ctx.fillRect(4, -2, 2, 4);
    /* 警示标 */
    ctx.fillStyle = 'rgba(255,210,61,.55)';
    ctx.beginPath();
    ctx.moveTo(0, -6.5); ctx.lineTo(2.4, -3.4); ctx.lineTo(-2.4, -3.4);
    ctx.closePath(); ctx.fill();
  }

  /* 管道段 */
  function drawDecorPipe(ctx, o) {
    ctx.strokeStyle = 'rgba(0,0,0,.42)';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.stroke();
    var g = gradL('d_pipe', 0, -4, 0, 4, [
      [0, '#55636f'], [0.5, '#333e48'], [1, '#1b2229']]);
    ctx.strokeStyle = g;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.stroke();
    /* 法兰 */
    ctx.fillStyle = '#2a333c';
    ctx.fillRect(-5, -5, 3, 10);
    ctx.fillRect(2, -5, 3, 10);
    ctx.strokeStyle = 'rgba(160,205,240,.28)'; ctx.lineWidth = 1;
    ctx.strokeRect(-5, -5, 3, 10);
    ctx.strokeRect(2, -5, 3, 10);
    /* 支架 */
    ctx.strokeStyle = 'rgba(80,110,140,.4)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, 3); ctx.lineTo(-8, 9);
    ctx.moveTo(8, 3); ctx.lineTo(8, 9);
    ctx.stroke();
  }

  /* ============================================================
     主渲染
     ============================================================ */
  R.render = function (ctx, G) {
    var t = G.time;
    bindCtx(ctx);

    /* --- 背景 --- */
    if (!bgCache || bgKey !== G.map.key) {
      bgCache = buildBG(G.map);
      bgKey = G.map.key;
    }
    ctx.drawImage(bgCache, 0, 0, W, H);

    /* --- 网格扫描光带（缓慢巡检灯）：缓存渐变 + translate 复用 --- */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var scanY = (t * 46) % (H + 260) - 130;
    var sg = gradL('scan', 0, -90, 0, 90, [
      [0, 'rgba(79,227,255,0)'],
      [0.5, 'rgba(79,227,255,.05)'],
      [1, 'rgba(79,227,255,0)']
    ]);
    ctx.translate(0, scanY);
    ctx.fillStyle = sg;
    ctx.fillRect(0, -90, W, 180);
    ctx.restore();

    /* --- 路径导流灯：只画已激活的敌人路径 --- */
    var act = G.activeSpawns || [0];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.setLineDash([14, 30]);
    ctx.lineDashOffset = -t * 38;
    for (var ai = 0; ai < act.length; ai++) {
      tracePath(ctx, G.map, act[ai]);
      ctx.strokeStyle = act[ai] === 0 ? 'rgba(120,225,255,.42)' : 'rgba(255,210,61,.40)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    /* --- 中继站塔位标记（未打通且未建造时显示） --- */
    if (G.map.relaySlots && G.map.relaySlots.length) {
      for (var rli = 0; rli < G.map.relaySlots.length; rli++) {
        var rl = G.map.relaySlots[rli];
        if (act.indexOf(rl.path) >= 0) continue;
        if (G.towerCountAt && G.towerCountAt(rl.gx, rl.gy) > 0) continue;
        var pl = 0.5 + 0.5 * Math.sin(t * 3 + rli);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,210,61,' + (0.4 + pl * 0.45) + ')';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([6, 5]);
        ctx.lineDashOffset = -t * 14;
        ctx.strokeRect(rl.cx - C.CELL * 0.42, rl.cy - C.CELL * 0.42, C.CELL * 0.84, C.CELL * 0.84);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,210,61,' + (0.55 + pl * 0.35) + ')';
        ctx.font = 'bold ' + Math.round(C.CELL * 0.42) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('📡', rl.cx, rl.cy);
        ctx.restore();
      }
    }

    /* --- 双开夹具标记 --- */
    if (G.stacked) {
      for (var sk in G.stacked) {
        if (!G.stacked.hasOwnProperty(sk)) continue;
        var parts = sk.split(',');
        var sc2 = P.cellCenter(parseInt(parts[0], 10), parseInt(parts[1], 10));
        ctx.save();
        ctx.strokeStyle = 'rgba(200,230,255,.75)';
        ctx.lineWidth = 1.8;
        var q3 = C.CELL * 0.34;
        /* 四角L形标记 */
        var cs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
        for (var ci = 0; ci < 4; ci++) {
          var ox = cs[ci][0] * q3, oy = cs[ci][1] * q3;
          ctx.beginPath();
          ctx.moveTo(sc2.x + ox, sc2.y + oy - cs[ci][1] * 7);
          ctx.lineTo(sc2.x + ox, sc2.y + oy);
          ctx.lineTo(sc2.x + ox - cs[ci][0] * 7, sc2.y + oy);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    /* --- 场景装饰（随机厂区设施） --- */
    if (G.map.decor && G.map.decor.length && qTier < 3) drawDecor(ctx, G.map, qTier >= 2 ? t * 0.5 : t);

    /* --- 建造预览 --- */
    if (G.buildType) drawBuildGhost(ctx, G);

    /* --- 铲子模式：格子框 + 红叉 + 铲子光标 --- */
    if (G.shovelMode && U.mouse.inside && P.inBounds(U.mouse.cx, U.mouse.cy)) {
      var sc = P.cellCenter(U.mouse.cx, U.mouse.cy);
      var stw = G.towerAt(U.mouse.cx, U.mouse.cy);
      ctx.save();
      /* 格子框 */
      ctx.strokeStyle = stw ? 'rgba(255,96,96,.95)' : 'rgba(200,216,232,.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(sc.x - C.CELL / 2 + 2, sc.y - C.CELL / 2 + 2, C.CELL - 4, C.CELL - 4);
      if (stw) {
        /* 红叉 */
        var q2 = C.CELL * 0.30;
        ctx.strokeStyle = '#ff5a5a';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(sc.x - q2, sc.y - q2); ctx.lineTo(sc.x + q2, sc.y + q2);
        ctx.moveTo(sc.x + q2, sc.y - q2); ctx.lineTo(sc.x - q2, sc.y + q2);
        ctx.stroke();
        /* 悬停塔红色描边提示 */
        ctx.strokeStyle = 'rgba(255,90,90,.55)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.lineDashOffset = -t * 20;
        ctx.beginPath(); ctx.arc(stw.x, stw.y, C.CELL * 0.46, 0, U.TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      /* 铲子图形（格中心，轻微摆动） */
      ctx.translate(sc.x, sc.y);
      ctx.rotate(-0.5 + Math.sin(t * 6) * 0.07);
      var sk = C.CELL / 44;
      ctx.scale(sk, sk);
      /* 木柄 */
      ctx.strokeStyle = '#8a6a3a';
      ctx.lineWidth = 4.2;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-7, 11); ctx.lineTo(7, -12); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,225,180,.35)';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-6, 10); ctx.lineTo(6, -11); ctx.stroke();
      /* 铲头 */
      ctx.fillStyle = '#c8d8e8';
      ctx.beginPath();
      ctx.moveTo(2, -6); ctx.lineTo(13, -13); ctx.lineTo(17, -3); ctx.lineTo(6, 5);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.restore();
    }

    /* --- 射程范围：选中塔常显；悬停塔淡显 --- */
    if (G.selected) {
      var sel = G.selected;
      var selS = sel.stats();
      /* 选中可移动单位：全图标注可移动格 + 落点预览，不画巨大射程圈 */
      if (sel.flying && !G.buildType) {
        drawLaneMobility(ctx, G, sel, t);
        drawMovePreview(ctx, G, sel, t);
      } else if (selS.range < 9000) {
        drawRange(ctx, G, sel.x, sel.y, selS.range, sel.def.color, 0.20);
        drawRangeTicks(ctx, sel, t);
      } else {
        /* 全图射程（东风导弹）用地图边框光晕代替实心大圈 */
        drawGlobalRange(ctx, G, sel, t);
      }
    } else if (G.hoverTower && !G.buildType) {
      var hv = G.hoverTower;
      if (hv.stats().range < 9000) {
        drawRange(ctx, G, hv.x, hv.y, hv.stats().range, hv.def.color, 0.11);
      }
    }

    /* --- 敌人路径预览（选中时） --- */

    /* --- 基地 --- */
    drawBase(ctx, G, t);

    /* --- 炮塔（含视口剔除） --- */
    /* 可见区域：加上外扩边距，避免塔在边缘被裁出又入画时闪烁 */
    var mL = -C.CELL * 2, mT = -C.CELL * 2;
    var mR = W + C.CELL * 2, mB = H + C.CELL * 2;
    /* 极简档只对「离光标较远」的塔做简化绘制：
       玩家正在操作的那一片永远保持完整，其余只画底座色块。
       这样既保住可读性与交互反馈，又把远处的逐塔美术开销砍掉。 */
    var lx = U.mouse.cx * C.CELL + C.CELL / 2, ly = U.mouse.cy * C.CELL + C.CELL / 2;
    var farR = C.CELL * 7, farR2 = farR * farR;
    for (var i = 0; i < G.towers.length; i++) {
      var tw = G.towers[i];
      /* 视口剔除：完全在画面外的塔整棵跳过 */
      if (tw.drawX < mL || tw.drawX > mR || tw.drawY < mT || tw.drawY > mB) continue;

      /* 极简档（tier 3）只裁掉「武器美术」，绝不裁掉塔身 ——
         塔身 sprite 保留底座/轮廓/等级标记，辨识度不受影响。
         （早前这里对远距塔画纯色圆饼，实测整屏变成饼图，必须去掉。） */
      void lx; void ly; void farR2;
      /* 移动尾迹画在塔身之下 */
      if (tw.flying && tw.moving && qTier <= 1) drawMoveTrail(ctx, tw, t);
      /* 悬停光环（仅选中/悬停的那一座，开销可忽略；med 档起关闭） */
      if (G.hoverTower === tw && G.selected !== tw && qTier === 0) drawHoverAura(ctx, tw, t);
      /* 信标光环画在塔身之下 */
      if (tw.kind === 'beacon' && tw.buildT <= 0 && qTier < 3) drawBeaconAura(ctx, tw, t);
      drawTower(ctx, tw, t, G);
    }

    /* --- 蜂群单元（独立机体，画在塔之上） --- */
    for (var sw = 0; sw < G.towers.length; sw++) {
      var stw = G.towers[sw];
      if (stw.kind === 'dronebay') {
        if (!stw.drones || stw.buildT > 0) continue;
        for (var bdu = 0; bdu < stw.drones.length; bdu++) {
          var bd = stw.drones[bdu];
          if (bd.alive) drawBayDrone(ctx, bd, stw.def.color, t, stw);
        }
        continue;
      }
      if (stw.kind !== 'swarm' || !stw.units || stw.buildT > 0) continue;
      for (var su = 0; su < stw.units.length; su++) {
        var un = stw.units[su];
        drawDroneUnit(ctx, un, stw.def.color, t);
      }
    }
    /* 母舰补充进度环（画在塔之上） */
    for (var brp = 0; brp < G.towers.length; brp++) {
      var brt = G.towers[brp];
      if (brt.kind === 'dronebay' && brt.buildT <= 0) drawDroneSpawnFx(ctx, brt, t);
    }

    /* --- 修复厂作业束（画在塔之上，连到被修复目标与基地） --- */
    for (var rp = 0; rp < G.towers.length; rp++) {
      var rpt = G.towers[rp];
      if (rpt.kind !== 'repair' || rpt.buildT > 0) continue;
      if ((rpt.attackAnim || 0) < 0.05) continue;
      drawRepairBeams(ctx, rpt, G, t);
    }

    /* --- 敌人 --- */
    for (var j = 0; j < G.enemies.length; j++) drawEnemy(ctx, G.enemies[j], t);

    /* --- 弹丸 --- */
    for (var b = 0; b < G.bullets.length; b++) G.bullets[b].render(ctx);

    /* --- 粒子 --- */
    FX.render(ctx);

    /* --- 东风导弹：飞行段可视化（从发射塔飞向锁定点） --- */
    for (var sfi = 0; sfi < G.strikes.length; sfi++) {
      var skf = G.strikes[sfi];
      if (!skf.ballistic) continue;
      var srcf = skf.src;
      if (!srcf) continue;
      var total = (srcf.def.base.delay || 3.4);
      var prog = U.clamp(1 - skf.t / total, 0, 1);      /* 0=发射 1=命中 */
      var ix = srcf.x + (skf.x - srcf.x) * prog;
      var iy = srcf.y + (skf.y - srcf.y) * prog;
      /* 先竖直爬升再俯冲，弧线感更强 */
      var arcH = C.CELL * (1.6 + prog * 0.6);
      var perpX = -(skf.y - srcf.y), perpY = (skf.x - srcf.x);
      var pl = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
      var bow = Math.sin(prog * Math.PI) * arcH;
      ix += perpX / pl * bow;
      iy += perpY / pl * bow - C.CELL * 1.2 * Math.sin(prog * Math.PI);
      /* 尾迹 */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var ta = Math.atan2(skf.y - srcf.y, skf.x - srcf.x);
      for (var tp = 1; tp <= 7; tp++) {
        var bp = prog - tp * 0.028;
        if (bp < 0) continue;
        var bx2 = srcf.x + (skf.x - srcf.x) * bp;
        var by2 = srcf.y + (skf.y - srcf.y) * bp;
        var bh2 = Math.sin(bp * Math.PI) * arcH;
        bx2 += perpX / pl * bh2;
        by2 += perpY / pl * bh2 - C.CELL * 1.2 * Math.sin(bp * Math.PI);
        glowAt(ctx, bx2, by2, C.CELL * 0.22 * (1 - tp / 9), '#ff8a2a', 0.22 * (1 - tp / 8));
      }
      /* 弹体 */
      ctx.save();
      ctx.translate(ix, iy);
      ctx.rotate(ta + Math.PI / 2);
      ctx.fillStyle = '#eef2f6';
      ctx.beginPath();
      ctx.moveTo(-3.2, -9); ctx.lineTo(3.2, -9); ctx.lineTo(3.2, 7); ctx.lineTo(-3.2, 7);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff2e42';
      ctx.beginPath();
      ctx.moveTo(0, -14); ctx.lineTo(3.2, -9); ctx.lineTo(-3.2, -9);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff8a2a';
      ctx.beginPath();
      ctx.moveTo(-2, 7); ctx.lineTo(-6, 14); ctx.lineTo(-2, 13); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(2, 7); ctx.lineTo(6, 14); ctx.lineTo(2, 13); ctx.closePath(); ctx.fill();
      glowAt(ctx, 0, 12, 12, '#ffd23d', 0.7);
      ctx.restore();
      ctx.restore();
    }

    /* --- 突袭刷新标记：红色旋转警示环 + 收缩倒计时 --- */
    for (var rmi = 0; rmi < G.raidMarks.length; rmi++) {
      var mk = G.raidMarks[rmi];
      var life = U.clamp(mk.t / 1.4, 0, 1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = U.rgba('#ff2e42', 0.30 + 0.55 * (1 - life));
      ctx.lineWidth = 2.4;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -t * 34;
      ctx.beginPath();
      ctx.arc(mk.x, mk.y, C.CELL * (1.6 - 0.5 * life), 0, U.TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = U.rgba('#ff4d6d', 0.8);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(mk.x, mk.y, C.CELL * 0.46, -Math.PI / 2, -Math.PI / 2 + U.TAU * (1 - life));
      ctx.stroke();
      glowAt(ctx, mk.x, mk.y, C.CELL * 0.7, '#ff2e42', 0.22 * (1 - life));
      ctx.restore();
    }

    /* --- 建造中动画覆盖 --- */
    drawBuildAnim(ctx, G, t);

    /* --- 屏幕震动偏移已在 ctx 变换中处理 --- */

    /* --- 暗角（缓存，每帧同一渐变） --- */
    ctx.save();
    var vg = gradR('vig', W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.78, [
      [0, 'rgba(0,0,0,0)'],
      [1, 'rgba(0,0,0,.46)']
    ]);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    /* --- 低耐久红色警戒边（缓存渐变，透明度用 globalAlpha 控制） --- */
    var lifePct = G.lives / G.maxLives;
    if (lifePct <= 0.34 && G.status === 'playing') {
      var pulse = 0.5 + 0.5 * Math.sin(t * 4.4);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.16 * pulse;
      var ag = gradL('alert', 0, 0, 0, H, [
        [0, '#ff2e42'],
        [0.35, 'rgba(255,61,110,0)'],
        [0.65, 'rgba(255,61,110,0)'],
        [1, '#ff2e42']
      ]);
      ctx.fillStyle = ag;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  };

  /* ============================================================
     基地：泰坦反应堆（多层装甲环 + 液压爪 + 能量核心）
     ============================================================ */
  function drawBase(ctx, G, t) {
    var b = G.map.base;
    var lifePct = U.clamp(G.lives / G.maxLives, 0, 1);
    var col = lifePct > 0.6 ? '#4fe3ff' : (lifePct > 0.3 ? '#ffd23d' : '#ff3b47');
    var r = C.CELL * 0.86;

    ctx.save();
    ctx.translate(b.x, b.y);

    /* 地面支撑基座：六边形钢台 */
    ctx.fillStyle = 'rgba(0,0,0,.62)';
    hexPath(ctx, r * 1.34, Math.PI / 6);
    ctx.fill();
    var baseG = gradL('base_body', -r, -r, r, r, [
      [0, '#2b3945'], [0.5, '#1b242e'], [1, '#101820']]);
    ctx.fillStyle = baseG;
    hexPath(ctx, r * 1.28, Math.PI / 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,195,230,.36)';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    /* 基座铆钉 */
    ctx.fillStyle = 'rgba(190,220,245,.34)';
    for (var rv = 0; rv < 6; rv++) {
      var ra = Math.PI / 6 + rv * U.TAU / 6;
      ctx.beginPath();
      ctx.arc(Math.cos(ra) * r * 1.13, Math.sin(ra) * r * 1.13, 2.4, 0, U.TAU);
      ctx.fill();
    }

    /* 四条液压支撑臂 */
    ctx.strokeStyle = '#37485a';
    ctx.lineWidth = 4.5;
    for (var h = 0; h < 4; h++) {
      var ha = Math.PI / 4 + h * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ha) * r * 0.72, Math.sin(ha) * r * 0.72);
      ctx.lineTo(Math.cos(ha) * r * 1.12, Math.sin(ha) * r * 1.12);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(160,205,235,.30)';
    ctx.lineWidth = 1.4;
    for (var h2 = 0; h2 < 4; h2++) {
      var ha2 = Math.PI / 4 + h2 * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ha2) * r * 0.72, Math.sin(ha2) * r * 0.72);
      ctx.lineTo(Math.cos(ha2) * r * 1.12, Math.sin(ha2) * r * 1.12);
      ctx.stroke();
    }

    /* 能量外辉光 */
    ctx.globalCompositeOperation = 'lighter';
    var pr = 1 + 0.12 * Math.sin(t * 2.1);
    var gg = gradR('base_glow_' + col, 0, 0, r * 0.35, 0, 0, r * 1.9, [
      [0, U.rgba(col, 0.30)],
      [1, U.rgba(col, 0)]
    ]);
    ctx.save();
    ctx.scale(pr, pr);
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.9, 0, U.TAU); ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';

    /* 主装甲环（八边形） */
    var ringG = gradL('base_ring', -r, -r, r, r, [
      [0, '#32414f'], [0.45, '#1e2833'], [1, '#131c25']]);
    ctx.fillStyle = ringG;
    octPath(ctx, r, t * 0.22);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.6;
    ctx.shadowColor = col; ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    /* 装甲分割线 */
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 1.6;
    for (var sd = 0; sd < 8; sd++) {
      var sda = t * 0.22 + sd * U.TAU / 8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(sda) * r * 0.55, Math.sin(sda) * r * 0.55);
      ctx.lineTo(Math.cos(sda) * r * 0.94, Math.sin(sda) * r * 0.94);
      ctx.stroke();
    }

    /* 内层旋转齿环 */
    ctx.save();
    ctx.rotate(-t * 0.75);
    ctx.fillStyle = 'rgba(90,140,180,.35)';
    for (var gt = 0; gt < 12; gt++) {
      var ga = gt * U.TAU / 12;
      ctx.save();
      ctx.rotate(ga);
      ctx.fillRect(r * 0.56, -2.2, r * 0.20, 4.4);
      ctx.restore();
    }
    ctx.restore();

    /* 反应炉核心 */
    ctx.save();
    var pulse = 0.72 + 0.28 * Math.sin(t * 3.2);
    ctx.globalCompositeOperation = 'lighter';
    var cg = gradR('base_core_' + col + (pulse * 4 | 0), 0, 0, 0, 0, 0, r * 0.62, [
      [0, '#ffffff'],
      [0.24, col],
      [0.6, U.rgba(col, 0.42 * pulse)],
      [1, U.rgba(col, 0)]
    ]);
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, U.TAU); ctx.fill();
    ctx.restore();

    /* 核心能量环 */
    ctx.strokeStyle = U.rgba('#ffffff', 0.55 * pulse);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.36, 0, U.TAU); ctx.stroke();
    ctx.strokeStyle = U.rgba(col, 0.7);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.46, -t * 1.4, -t * 1.4 + 2.1); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.46, -t * 1.4 + Math.PI, -t * 1.4 + Math.PI + 2.1); ctx.stroke();

    /* 耐久条：装甲槽样式 */
    var bw = r * 1.72, bh = 7, by = r * 1.42;
    ctx.fillStyle = 'rgba(0,0,0,.8)';
    ctx.fillRect(-bw / 2 - 1.5, by - 1.5, bw + 3, bh + 3);
    ctx.fillStyle = 'rgba(30,44,58,.9)';
    ctx.fillRect(-bw / 2, by, bw, bh);
    /* 分段格 */
    var segs = 10;
    for (var sg2 = 0; sg2 < segs; sg2++) {
      var sw = bw / segs - 1.6;
      var sx2 = -bw / 2 + sg2 * (bw / segs);
      var on = (sg2 + 1) / segs <= lifePct + 0.001;
      if (on) {
        ctx.fillStyle = col;
        ctx.shadowColor = col; ctx.shadowBlur = 7;
      } else ctx.fillStyle = 'rgba(70,92,112,.42)';
      ctx.fillRect(sx2, by, sw, bh);
      ctx.shadowBlur = 0;
    }
    ctx.strokeStyle = U.rgba(col, 0.5);
    ctx.lineWidth = 1;
    ctx.strokeRect(-bw / 2 - 1.5, by - 1.5, bw + 3, bh + 3);

    /* 标签铭牌 */
    ctx.font = '700 9px Consolas,monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var lw = 46, lh = 14;
    ctx.fillStyle = 'rgba(6,10,14,.85)';
    ctx.fillRect(-lw / 2, -r * 1.42 - lh / 2, lw, lh);
    ctx.strokeStyle = U.rgba(col, 0.45);
    ctx.lineWidth = 1;
    ctx.strokeRect(-lw / 2, -r * 1.42 - lh / 2, lw, lh);
    ctx.fillStyle = U.rgba(col, 0.95);
    ctx.fillText('CORE', 0, -r * 1.42);
    ctx.restore();
  }

  function hexPath(ctx, rr, rot) {
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = rot + i * U.TAU / 6;
      var x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function octPath(ctx, rr, rot) {
    ctx.beginPath();
    for (var i = 0; i < 8; i++) {
      var a = rot + i * U.TAU / 8;
      var x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /* ============================================================
     炮塔
     ============================================================ */
  /* ============================================================
     增幅信标光环
     ============================================================ */
  function drawBeaconAura(ctx, tw, t) {
    var s = tw.stats();
    if (!(s.range > 0)) return;
    var r = s.range;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* 内层暖光（局部坐标缓存，translate 复用） */
    var g = gradR('aura_' + tw.def.color + '_' + (r | 0), 0, 0, r * 0.3, 0, 0, r, [
      [0, U.rgba(tw.def.color, 0.09)],
      [0.75, U.rgba(tw.def.color, 0.05)],
      [1, U.rgba(tw.def.color, 0.015)]
    ]);
    ctx.save();
    ctx.translate(tw.x, tw.y);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, U.TAU); ctx.fill();
    ctx.restore();
    /* 双层旋转虚线圈 */
    ctx.setLineDash([12, 10]);
    ctx.lineDashOffset = -t * 22;
    ctx.strokeStyle = U.rgba(tw.def.color, 0.34);
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(tw.x, tw.y, r * 0.96, 0, U.TAU); ctx.stroke();
    ctx.lineDashOffset = -t * -14;
    ctx.strokeStyle = U.rgba(tw.def.color, 0.20);
    ctx.beginPath(); ctx.arc(tw.x, tw.y, r * 0.80, 0, U.TAU); ctx.stroke();
    ctx.setLineDash([]);
    /* 连接节点的短针 */
    ctx.strokeStyle = U.rgba(tw.def.color, 0.28);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (var k = 0; k < 6; k++) {
      var a = k * U.TAU / 6 + t * 0.3;
      ctx.moveTo(tw.x + Math.cos(a) * r * 0.80, tw.y + Math.sin(a) * r * 0.80);
      ctx.lineTo(tw.x + Math.cos(a) * r * 0.96, tw.y + Math.sin(a) * r * 0.96);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* 修复厂作业束：向范围内受损友军与基地发射能量束 */
  function drawRepairBeams(ctx, rpt, G, t) {
    var s = rpt.stats();
    var r2 = s.range * s.range;
    var count = 0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var towers = G.towers;
    for (var i = 0; i < towers.length && count < 6; i++) {
      var tg = towers[i];
      if (tg === rpt || tg.hp >= tg.maxHp) continue;
      var dx = tg.x - rpt.x, dy = tg.y - rpt.y;
      if (dx * dx + dy * dy > r2) continue;
      count++;
      /* 光束主体 */
      var flick = 0.55 + 0.45 * Math.abs(Math.sin(t * 14 + i));
      ctx.strokeStyle = U.rgba('#5bff9b', 0.30 * flick * rpt.attackAnim);
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(rpt.x, rpt.y - C.CELL * 0.2);
      ctx.lineTo(tg.x, tg.y);
      ctx.stroke();
      /* 内芯 */
      ctx.strokeStyle = U.rgba('#d8ffe8', 0.55 * flick * rpt.attackAnim);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      /* 目标端接收光点 */
      var gsz = C.CELL * 0.20;
      var sp = NB.FX.glowSprite('#5bff9b', gsz);
      var sw = gsz * 2 * flick;
      ctx.globalAlpha = 0.75 * flick * rpt.attackAnim;
      ctx.drawImage(sp, tg.x - sw / 2, tg.y - sw / 2, sw, sw);
    }

    /* --- 基地修复束：耐久未满且在射程内时连通反应堆 --- */
    var base = G.map.base;
    if (G.lives < G.maxLives && count < 6) {
      var bx = base.x - rpt.x, by = base.y - rpt.y;
      if (bx * bx + by * by <= r2) {
        count++;
        var fk = 0.55 + 0.45 * Math.abs(Math.sin(t * 16 + 3));
        ctx.strokeStyle = U.rgba('#4fe3ff', 0.34 * fk * rpt.attackAnim);
        ctx.lineWidth = 4.2;
        ctx.beginPath();
        ctx.moveTo(rpt.x, rpt.y - C.CELL * 0.2);
        ctx.lineTo(base.x, base.y);
        ctx.stroke();
        ctx.strokeStyle = U.rgba('#d6fbff', 0.60 * fk * rpt.attackAnim);
        ctx.lineWidth = 1.6;
        ctx.stroke();
        var gs2 = C.CELL * 0.28;
        var sp2 = NB.FX.glowSprite('#4fe3ff', gs2);
        var sw2 = gs2 * 2 * fk;
        ctx.globalAlpha = 0.80 * fk * rpt.attackAnim;
        ctx.drawImage(sp2, base.x - sw2 / 2, base.y - sw2 / 2, sw2, sw2);
      }
    }
    ctx.restore();
  }

  /* 蜂群单机体 */
  /* 蜂群母舰的护航无人机：带血条 / 炮口焰 / 受击闪白 */
  function drawBayDrone(ctx, u, col, t, tw) {
    var r = C.CELL * 0.165;
    var hitP = (u.hitT || 0) > 0 ? (u.hitT / 0.14) : 0;
    ctx.save();
    ctx.translate(u.x, u.y);
    ctx.rotate(u.ang2 || 0);

    /* 尾迹：沿运动方向拉一条淡绿光带 */
    var sp = Math.sqrt((u.vx || 0) * (u.vx || 0) + (u.vy || 0) * (u.vy || 0));
    if (sp > 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var tl = Math.min(r * 2.4, sp * 0.02);
      var tg = ctx.createLinearGradient(-r * 0.8, 0, -r * 0.8 - tl, 0);
      tg.addColorStop(0, U.rgba(col, 0.30));
      tg.addColorStop(1, U.rgba(col, 0));
      ctx.fillStyle = tg;
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, -r * 0.20);
      ctx.lineTo(-r * 0.8 - tl, 0);
      ctx.lineTo(-r * 0.8, r * 0.20);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    /* 旋翼（两片，高速旋转模糊） */
    var rp = t * 34 + (u.slot || 0) * 1.3;
    ctx.strokeStyle = U.rgba('#ffffff', 0.32);
    ctx.lineWidth = 1.5;
    for (var k = 0; k < 2; k++) {
      var yy = (k === 0 ? -1 : 1) * r * 0.62;
      var bl = Math.abs(Math.cos(rp)) * r * 0.95;
      ctx.beginPath();
      ctx.moveTo(-bl, yy); ctx.lineTo(bl, yy);
      ctx.stroke();
    }

    /* 机身（受击时偏白） */
    var bodyC = hitP > 0 ? '#ffffff' : '#1d2712';
    ctx.fillStyle = bodyC;
    ctx.beginPath();
    ctx.moveTo(r * 1.15, 0);
    ctx.lineTo(r * 0.10, -r * 0.62);
    ctx.lineTo(-r * 0.85, -r * 0.40);
    ctx.lineTo(-r * 0.85, r * 0.40);
    ctx.lineTo(r * 0.10, r * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = U.rgba(col, hitP > 0 ? 1 : 0.92);
    ctx.lineWidth = 1.35;
    ctx.stroke();

    /* 机腹武器挂架 */
    ctx.fillStyle = U.rgba(col, 0.65);
    ctx.fillRect(r * 0.15, -r * 0.13, r * 0.62, r * 0.26);

    /* 状态灯 + 核心 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, r * 0.30, 0, r * 0.30, col, 0.55 + 0.2 * Math.sin(t * 7 + (u.slot || 0)));
    if (u.muzzle > 0) {
      var mp = u.muzzle / 0.1;
      glowAt(ctx, r * 1.0, 0, r * (0.55 + 0.45 * mp), '#ffffff', 0.85 * mp);
    }
    ctx.restore();

    /* 血条（低于满血才显示） */
    ctx.rotate(-(u.ang2 || 0));
    if (u.hp < u.maxHp) {
      var bw = r * 1.9, bh = 2.2;
      var hpP = U.clamp(u.hp / u.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,.7)';
      ctx.fillRect(-bw / 2, -r * 1.45, bw, bh);
      ctx.fillStyle = hpP > 0.5 ? col : (hpP > 0.25 ? '#ffd23d' : '#ff4d6d');
      ctx.fillRect(-bw / 2, -r * 1.45, bw * hpP, bh);
    }
    ctx.restore();
  }

  /* 母舰放出的替补机出生环 */
  function drawDroneSpawnFx(ctx, tw, t) {
    if (!tw.respawnT) return;
    var p = 1 - tw.respawnT / 0.55;
    if (p <= 0 || p >= 1) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = U.rgba(tw.def.color, 0.5 * (1 - p));
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 5]);
    ctx.lineDashOffset = -t * 26;
    ctx.beginPath();
    ctx.arc(tw.x, tw.y, C.CELL * (0.5 + p * 0.35), 0, U.TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawDroneUnit(ctx, u, col, t) {
    var r = C.CELL * 0.17;
    ctx.save();
    ctx.translate(u.x, u.y);
    /* 机身 */
    ctx.fillStyle = '#1d2712';
    ctx.beginPath();
    ctx.moveTo(r * 1.1, 0);
    ctx.lineTo(0, -r * 0.7);
    ctx.lineTo(-r * 0.9, 0);
    ctx.lineTo(0, r * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.95); ctx.lineWidth = 1.3; ctx.stroke();
    /* 旋翼 */
    ctx.strokeStyle = U.rgba(col, 0.5);
    ctx.lineWidth = 1.2;
    var rp = Math.sin(t * 30 + u.ang * 4) * 0.6;
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.95 + rp * r * 0.15);
    ctx.lineTo(-r * 0.2, r * 0.95 + rp * r * 0.15);
    ctx.stroke();
    /* 状态灯 */
    ctx.fillStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.arc(r * 0.45, 0, r * 0.24, 0, U.TAU); ctx.fill();
    ctx.restore();
  }

  /* ============================================================
     塔身静态部分预渲染缓存（性能关键）
     ------------------------------------------------------------
     剖析结论：120 塔 + 60 敌时 render 153.9ms/帧，而逻辑仅 0.24ms，
     空场景固定开销 10.1ms —— 瓶颈是逐帧重画每座塔的静态几何，
     画质降档只砍粒子/装饰，所以只省下 22%。

     这里把「与时间无关」的部分（投影 / 液压爪 / 装甲板 / 铆钉 /
     等级标记）预渲染成离屏 sprite，逐帧只 drawImage 一次；
     只有真正会动的部分（能量槽、炮管旋转、辉光、血条）保持实时绘制。
     ============================================================ */
  var towerCache = Object.create(null);
  var TOWER_SS = 2;                 /* sprite 超采样倍率，兼顾清晰与体积 */
  var towerCacheHits = 0, towerCacheMiss = 0;

  /* ============================================================
     塔身静态几何 —— 全工程唯一一份定义
     —— sprite 烘焙路径与「sprite 不可用时的实时回退路径」共用它。
        早期两份各写一套且长得还不一样（回退是八角钢体 + 液压爪，
        sprite 是椭圆转盘 + 铆钉带）：改一处漏一处，且异常时画风
        会突然切换，玩家看到的是"塔换了个样子"。
     —— 渐变必须用「传入的这个 context」现场创建：
        缓存版 gradL/gradR 内部固定用主 ctx，跨 context 赋 fillStyle
        不可靠；sprite 烘焙用的正是离屏 context。
     ============================================================ */
  function drawTowerStatic(g, r, col, lv, stk) {
    void col;
    /* 接地投影：双层，越靠外越淡 */
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.beginPath(); g.ellipse(0, r * 0.52, r * 1.06, r * 0.46, 0, 0, U.TAU); g.fill();
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.beginPath(); g.ellipse(0, r * 0.56, r * 1.32, r * 0.56, 0, 0, U.TAU); g.fill();

    /* 叠塔托架投影 */
    if (stk) {
      g.fillStyle = 'rgba(200,230,255,.13)';
      g.beginPath(); g.ellipse(0, r * 0.56, r * 1.24, r * 0.52, 0, 0, U.TAU); g.fill();
    }

    /* 液压支撑爪：外筒 + 内杆 + 油压高光 + 脚垫 */
    for (var lp = 0; lp < 4; lp++) {
      var la = Math.PI / 4 + lp * Math.PI / 2;
      var cxl = Math.cos(la), cyl = Math.sin(la);
      var x0 = cxl * r * 0.62, y0 = cyl * r * 0.62;
      var x1 = cxl * r * 1.02, y1 = cyl * r * 1.02;
      g.strokeStyle = '#2b3946'; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.strokeStyle = 'rgba(170,210,245,.42)'; g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x0 - cyl * 1.2, y0 + cxl * 1.2);
      g.lineTo(x1 - cyl * 1.2, y1 + cxl * 1.2);
      g.stroke();
      g.fillStyle = '#1e2831';
      g.beginPath(); g.arc(x1, y1, 2.6, 0, U.TAU); g.fill();
      g.fillStyle = 'rgba(200,230,255,.22)';
      g.beginPath(); g.arc(x1, y1, 1.2, 0, U.TAU); g.fill();
    }
    g.lineCap = 'butt';

    /* 底座八边形钢体：阴影层 + 渐变主体，两层叠出厚度 */
    octPath(g, r * 1.04, -Math.PI / 8);
    g.fillStyle = 'rgba(0,0,0,.5)';
    g.fill();
    octPath(g, r, -Math.PI / 8);
    var bg = g.createLinearGradient(-r, -r * 0.6, r * 0.7, r);
    bg.addColorStop(0, '#3e4d5a'); bg.addColorStop(0.34, '#28323d');
    bg.addColorStop(0.72, '#1b242d'); bg.addColorStop(1, '#0f151c');
    g.fillStyle = bg;
    g.fill();

    /* 装甲分割线：8 条放射 + 上缘高光（折面感） */
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1.5;
    g.beginPath();
    for (var sd = 0; sd < 8; sd++) {
      var sda = -Math.PI / 8 + sd * U.TAU / 8;
      g.moveTo(Math.cos(sda) * r * 0.50, Math.sin(sda) * r * 0.50);
      g.lineTo(Math.cos(sda) * r * 0.96, Math.sin(sda) * r * 0.96);
    }
    g.stroke();
    g.strokeStyle = 'rgba(175,215,245,.16)'; g.lineWidth = 1;
    g.beginPath();
    for (var sd2 = 0; sd2 < 8; sd2++) {
      var sda2 = -Math.PI / 8 + sd2 * U.TAU / 8;
      g.moveTo(Math.cos(sda2) * r * 0.50, Math.sin(sda2) * r * 0.50 - 1);
      g.lineTo(Math.cos(sda2) * r * 0.96, Math.sin(sda2) * r * 0.96 - 1);
    }
    g.stroke();

    /* 内层嵌板：比底座小一圈，制造"装甲内芯"层次 */
    octPath(g, r * 0.66, -Math.PI / 8 + Math.PI / 8);
    var ig = g.createLinearGradient(0, -r * 0.6, 0, r * 0.6);
    ig.addColorStop(0, '#2b3743'); ig.addColorStop(0.5, '#1c252f'); ig.addColorStop(1, '#121a22');
    g.fillStyle = ig;
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1.2; g.stroke();

    /* 等级标记：静态小方块（数量 = 等级，颜色随档位） */
    var marks = Math.min(12, lv);
    for (var mk = 0; mk < marks; mk++) {
      var mx = -r * 0.40 + mk * (r * 0.072);
      g.fillStyle = (lv >= 8) ? '#ffd23d' : (lv >= 4 ? '#8fd4ff' : 'rgba(180,215,240,.72)');
      g.fillRect(mx, -r * 0.60, r * 0.05, r * 0.05);
    }
  }

  function towerSprite(tw) {
    var key = tw.kind + '|' + tw.level + '|' + (tw.stackSlot > 0 ? 1 : 0);
    var sp = towerCache[key];
    if (sp) { towerCacheHits++; return sp; }
    towerCacheMiss++;

    var r = C.CELL * 0.46;
    var pad = r * 1.5;                       /* 覆盖投影与液压爪外缘 */
    var size = Math.ceil(pad * 2 * TOWER_SS);
    var c = document.createElement('canvas');
    c.width = size; c.height = size;
    var g = c.getContext('2d');
    g.scale(TOWER_SS, TOWER_SS);
    g.translate(pad, pad);

    var col = tw.def.color;
    var lv = tw.level;
    var stk = tw.stackSlot > 0;
    var sMul = stk ? 0.84 : 1;
    g.scale(sMul, sMul);

    /* 静态几何统一走 drawTowerStatic：与实时回退路径同源 */
    drawTowerStatic(g, r, col, lv, stk);

    towerCache[key] = { cv: c, pad: pad };
    return towerCache[key];
  }

  R.towerCacheStats = function () {
    var n = 0;
    for (var k in towerCache) if (Object.prototype.hasOwnProperty.call(towerCache, k)) n++;
    return { entries: n, hits: towerCacheHits, misses: towerCacheMiss };
  };
  R.clearTowerCache = function () {
    towerCache = Object.create(null);
    towerCacheHits = 0; towerCacheMiss = 0;
  };

  /* ============================================================
     炮塔：泰坦装甲炮台
     体积感来源：外暗影边 → 主体钢体渐变 → 内高光唇边 → 中央能量槽
     ============================================================ */
  function drawTower(ctx, tw, t, G) {
    var d = tw.def;
    var col = d.color;
    var r = C.CELL * 0.46;
    var buildP = tw.buildT > 0 ? 1 - tw.buildT / 0.42 : 1;
    var scale = U.clamp(buildP, 0.1, 1);
    var sel = (G.selected === tw);
    var lv = tw.level;

    ctx.save();
    /* 同格双开：用 stackSlot 做 O(1) 偏移，叠塔缩小并加轻微仰角错觉 */
    var dx = tw.drawX, dy = tw.drawY;
    if (tw.stackSlot > 0) {
      var so = C.CELL * 0.20;
      dx += (tw.stackSlot % 2 === 1 ? -so : so) * 0.9;
      dy += (tw.stackSlot >= 1 ? so * 0.6 : 0) * 0.9;
      scale *= 0.84;
      /* 叠塔托架投影 */
      ctx.save();
      ctx.translate(tw.x, tw.y);
      ctx.fillStyle = 'rgba(200,230,255,.13)';
      ctx.beginPath(); ctx.ellipse(0, r * 0.56, r * 1.24, r * 0.52, 0, 0, U.TAU); ctx.fill();
      ctx.restore();
    }
    ctx.translate(dx, dy);
    ctx.scale(scale, scale);

    /* 选中光环：双层旋转环 + 呼吸辉光（med 档起关闭，属装饰性叠加） */
    if (sel && qTier === 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var sa = 0.42 + 0.22 * Math.sin(t * 3.4);
      ctx.strokeStyle = U.rgba(col, sa);
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.16, t * 1.1, t * 1.1 + 2.1); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 1.16, t * 1.1 + Math.PI, t * 1.1 + Math.PI + 2.1); ctx.stroke();
      ctx.strokeStyle = U.rgba('#ffffff', sa * 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.30, -t * 0.7, -t * 0.7 + 1.5); ctx.stroke();
      glowAt(ctx, 0, 0, r * 0.9, col, 0.22 + 0.12 * Math.sin(t * 3.4));
      ctx.restore();
      /* 空中单位：脚下投影换成悬浮环 + 向上箭头，表示可移动 */
      if (tw.flying) {
        ctx.save();
        ctx.strokeStyle = U.rgba('#a8d8ff', 0.55 + 0.25 * Math.sin(t * 4));
        ctx.lineWidth = 1.8;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.ellipse(0, r * 0.62, r * 0.86, r * 0.30, 0, 0, U.TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = U.rgba('#a8d8ff', 0.7);
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.24); ctx.lineTo(-r * 0.16, -r * 1.02);
        ctx.lineTo(r * 0.16, -r * 1.02); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    } else if (tw.flying && G.hoverTower === tw) {
      ctx.save();
      ctx.strokeStyle = U.rgba('#a8d8ff', 0.32);
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.ellipse(0, r * 0.62, r * 0.86, r * 0.30, 0, 0, U.TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    /* --- 塔身静态部分：预渲染 sprite 一次性 blit（见 towerSprite） --- */
    var sp0 = null;
    try { sp0 = towerSprite(tw); } catch (e) { sp0 = null; }
    if (sp0) {
      var spd = sp0.pad / TOWER_SS;
      ctx.drawImage(sp0.cv, -spd, -spd, sp0.pad * 2 / TOWER_SS, sp0.pad * 2 / TOWER_SS);
    }

    if (!sp0) {
      /* sprite 不可用（离屏 canvas 创建失败等）时的实时回退。
         几何与 sprite 烘焙共用 drawTowerStatic，保证两条路径画风一致。 */
      drawTowerStatic(ctx, r, col, lv, tw.stackSlot > 0);
    }   /* end of static-geometry fallback */

    /* --- 动态部分：以下仍逐帧实时绘制 --- */

    /* 底座齿圈：缓慢旋转，必须实时（不进 sprite） */
    ctx.save();
    ctx.rotate(t * 0.22);
    ctx.strokeStyle = 'rgba(120,170,215,.30)';
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.16, 0, U.TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(150,200,240,.26)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (var gt2 = 0; gt2 < 16; gt2++) {
      var ga2 = gt2 * U.TAU / 16;
      ctx.moveTo(Math.cos(ga2) * r * 1.10, Math.sin(ga2) * r * 1.10);
      ctx.lineTo(Math.cos(ga2) * r * 1.22, Math.sin(ga2) * r * 1.22);
    }
    ctx.stroke();
    ctx.restore();

    /* 中央能量槽：呼吸发光 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var puls = 0.5 + 0.5 * Math.sin(t * 2.4 + tw.pulse);
    var cg = gradR('tw_cg_' + col + (puls * 4 | 0), 0, 0, 0, 0, 0, r * 0.42, [
      [0, U.rgba(col, 0.30 + puls * 0.22)],
      [0.6, U.rgba(col, 0.10 + puls * 0.08)],
      [1, U.rgba(col, 0)]
    ]);
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.42, 0, U.TAU); ctx.fill();
    ctx.restore();

    /* 铆钉：交错双圈 */
    ctx.fillStyle = 'rgba(195,225,250,.42)';
    for (var rv2 = 0; rv2 < 8; rv2++) {
      var rva = -Math.PI / 8 + rv2 * U.TAU / 8 + U.TAU / 16;
      ctx.beginPath();
      ctx.arc(Math.cos(rva) * r * 0.83, Math.sin(rva) * r * 0.83, 1.5, 0, U.TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(195,225,250,.28)';
    for (var rv3 = 0; rv3 < 4; rv3++) {
      var rva2 = Math.PI / 4 + rv3 * Math.PI / 2;
      ctx.beginPath();
      ctx.arc(Math.cos(rva2) * r * 0.40, Math.sin(rva2) * r * 0.40, 1.1, 0, U.TAU);
      ctx.fill();
    }

    /* 外轮廓描边 */
    ctx.strokeStyle = sel ? '#ffffff' : U.rgba(col, 0.92);
    ctx.lineWidth = sel ? 2.6 : 2;
    octPath(ctx, r, -Math.PI / 8);
    if (sel) { ctx.shadowColor = col; ctx.shadowBlur = 16; }
    ctx.stroke();
    ctx.shadowBlur = 0;
    /* 上缘高光唇边 */
    ctx.strokeStyle = 'rgba(210,238,255,.30)';
    ctx.lineWidth = 1.2;
    octPath(ctx, r - 1.4, -Math.PI / 8);
    ctx.stroke();

    /* 等级能量条 */
    drawLevelArc(ctx, tw, r, col);

    /* 装甲耐久条（受伤后才显示，位于等级条上方） */
    if (tw.hp < tw.maxHp) drawTowerHp(ctx, tw, r);

    /* 被修复时的绿色反馈 */
    if (tw.repairGlow > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glowAt(ctx, 0, 0, r * 1.2, '#5bff9b', tw.repairGlow * 0.30);
      ctx.restore();
    }

    /* 武器主体 */
    ctx.save();
    ctx.rotate(tw.ang + (tw.recoil > 0 ? -tw.recoil * 0.16 : 0));
    var rec = tw.recoil > 0 ? tw.recoil * 3.2 : 0;
    ctx.translate(-rec, 0);
    drawWeapon(ctx, tw, col, r, t);
    ctx.restore();

    /* 开火闪光 */
    if (tw.fireT > 0) {
      var fp = tw.fireT / 0.14;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var fa = tw.ang;
      var fx = Math.cos(fa) * r * 1.4, fy = Math.sin(fa) * r * 1.4;
      var fg = gradR('mz_' + col + (fp * 6 | 0), 0, 0, 0, 0, 0, r * 0.9 * fp, [
        [0, U.rgba('#ffffff', fp)],
        [0.4, U.rgba(col, fp * 0.8)],
        [1, U.rgba(col, 0)]
      ]);
      ctx.save();
      ctx.translate(fx, fy);
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.9 * fp, 0, U.TAU); ctx.fill();
      ctx.restore();
      ctx.restore();
    }

    /* --- 特斯拉旋转弧 / 被干扰 --- */
    if (tw.jamT > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      /* 紫色电离噪波 */
      ctx.strokeStyle = 'rgba(176,106,224,' + (0.4 + 0.3 * Math.sin(t * 20)) + ')';
      ctx.lineWidth = 1.6;
      for (var jn = 0; jn < 4; jn++) {
        ctx.beginPath();
        var ja = t * 3 + jn * 1.57;
        ctx.moveTo(Math.cos(ja) * r * 0.5, Math.sin(ja) * r * 0.5);
        ctx.lineTo(Math.cos(ja + 0.9) * r * 1.2, Math.sin(ja + 0.9) * r * 1.2);
        ctx.stroke();
      }
      /* 禁用标识 */
      ctx.strokeStyle = 'rgba(255,59,71,.85)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.05, 0, U.TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.5); ctx.lineTo(r * 0.5, r * 0.5);
      ctx.stroke();
      ctx.restore();
    }

    if (tw.kind === 'tesla') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.rotate(tw.spin);
      ctx.strokeStyle = U.rgba(col, 0.5);
      ctx.lineWidth = 1.3;
      for (var q = 0; q < 2; q++) {
        ctx.beginPath();
        ctx.arc(0, 0, r * (0.72 + q * 0.16), q * 1.6, q * 1.6 + 1.5);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* 寒霜场光环 */
    if (tw.kind === 'slow') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var fa2 = 0.35 + 0.3 * Math.sin(t * 2.2 + tw.pulse);
      ctx.strokeStyle = U.rgba(col, fa2 * 0.6);
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 8]);
      ctx.lineDashOffset = -t * 18;
      var rr = tw.stats().range;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, U.TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    /* 选中框：机械瞄准标记 */
    if (sel) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = U.rgba('#ffffff', 0.6);
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 6]);
      ctx.lineDashOffset = -t * 22;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.34, 0, U.TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      /* 四角准星 */
      ctx.strokeStyle = U.rgba(col, 0.9);
      ctx.lineWidth = 2;
      for (var q = 0; q < 4; q++) {
        var qa = Math.PI / 4 + q * Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(qa) * r * 1.18, Math.sin(qa) * r * 1.18);
        ctx.lineTo(Math.cos(qa) * r * 1.44, Math.sin(qa) * r * 1.44);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();
  }

  /* ---------- 等级能量条：金属槽 + 发光填充 + 满级金色脉冲 ---------- */
  function drawLevelArc(ctx, tw, r, col) {
    var maxLv = tw.def.maxLevel;
    var lv = U.clamp(tw.level, 0, maxLv);
    var segs = 12;
    var perSeg = maxLv / segs;
    var w = r * 0.115, h = r * 0.30;
    var gap = w * 0.46;
    var totalW = segs * w + (segs - 1) * gap;
    var x0 = -totalW / 2;
    var y0 = r * 0.56;
    var maxed = lv >= maxLv;

    /* 外槽：深金属 */
    ctx.fillStyle = '#0b1016';
    roundRect(ctx, x0 - 2.2, y0 - 2.2, totalW + 4.4, h + 4.4, 1.8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,195,230,.30)';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    /* 满级时整条槽呼吸金辉 */
    if (maxed) {
      var mp = 0.5 + 0.5 * Math.sin(tw.pulse * 2.2);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,201,60,' + (0.10 + mp * 0.16) + ')';
      roundRect(ctx, x0 - 1, y0 - 1, totalW + 2, h + 2, 1);
      ctx.fill();
      ctx.restore();
    }

    for (var i = 0; i < segs; i++) {
      var fill = U.clamp(lv - i * perSeg, 0, 1);
      var x = x0 + i * (w + gap);
      /* 未填充槽 */
      ctx.fillStyle = 'rgba(95,130,165,.20)';
      ctx.fillRect(x, y0, w, h);
      if (fill > 0) {
        var isLast = i === segs - 1 && maxed;
        var base = isLast ? '#ffc93c' : col;
        /* 主体 */
        ctx.fillStyle = base;
        var fh = Math.max(1.4, h * fill);
        ctx.fillRect(x, y0 + h - fh, w, fh);
        /* 顶部亮线 */
        ctx.fillStyle = isLast ? '#fff3cd' : 'rgba(255,255,255,.85)';
        ctx.fillRect(x, y0 + h - fh, w, 1.2);
        /* 侧边微光，形成圆柱感 */
        ctx.fillStyle = U.rgba(base, 0.45);
        ctx.fillRect(x, y0 + h - fh, 1.2, fh);
      }
    }
    /* 每格分隔刻度 */
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (var g = 1; g < segs; g++) {
      var gx = x0 + g * (w + gap) - gap / 2;
      ctx.moveTo(gx, y0 - 0.5); ctx.lineTo(gx, y0 + h + 0.5);
    }
    ctx.stroke();
  }

  /* ============================================================
     武器通用：金属钢体（渐变 + 高光唇边 + 暗影边）
     所有武器都基于它叠加细节，保证画风统一、有体积感
     ============================================================ */
  function metalBody(ctx, x, y, wd, ht, rr, c1, c2, c3) {
    roundRect(ctx, x, y, wd, ht, rr);
    /* 垂直渐变：只与 (y, ht) 和配色有关，按此缓存 */
    var g = gradL('mb' + y + '_' + ht + '_' + (c1 || '') + (c2 || '') + (c3 || ''),
      0, y, 0, y + ht, [
        [0, c1 || '#41505e'],
        [0.45, c2 || '#2b3743'],
        [1, c3 || '#151d25']
      ]);
    ctx.fillStyle = g;
    ctx.fill();
    /* 上缘高光 */
    ctx.strokeStyle = 'rgba(200,232,255,.30)';
    ctx.lineWidth = 1;
    roundRect(ctx, x + 1, y + 1, wd - 2, ht - 2, Math.max(0, rr - 1));
    ctx.stroke();
    /* 下缘暗影 */
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 1.2;
    roundRect(ctx, x, y, wd, ht, rr);
    ctx.stroke();
  }

  /* 金属圆柱（炮管）：亮侧 + 暗侧 + 顶部高光线 */
  function metalTube(ctx, x, y, wd, ht, c1, c2) {
    roundRect(ctx, x, y, wd, ht, ht * 0.5);
    var g = gradL('mt' + y + '_' + ht + '_' + (c1 || '') + (c2 || ''),
      0, y, 0, y + ht, [
        [0, c1 || '#556a7c'],
        [0.42, c2 || '#2f3d4a'],
        [1, '#10161c']
      ]);
    ctx.fillStyle = g;
    ctx.fill();
    /* 轴向高光线 */
    ctx.strokeStyle = 'rgba(215,240,255,.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + ht * 0.5, y + 1.4);
    ctx.lineTo(x + wd - ht * 0.5, y + 1.4);
    ctx.stroke();
    /* 轮廓 */
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 1.1;
    roundRect(ctx, x, y, wd, ht, ht * 0.5);
    ctx.stroke();
  }

  /* 能量辉光：预渲染 sprite，避免每帧渐变 */
  function glowAt(ctx, x, y, size, color, alpha) {
    var sp = NB.FX.glowSprite(color, size);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    var sw = size * 2;
    ctx.drawImage(sp, x - sw / 2, y - sw / 2, sw, sw);
    ctx.restore();
  }

  /* 铆钉带：沿矩形边缘等距 */
  function rivetRow(ctx, x0, x1, y, n, rad, col) {
    ctx.fillStyle = col || 'rgba(200,230,255,.40)';
    var step = (x1 - x0) / (n - 1);
    for (var i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(x0 + step * i, y, rad, 0, U.TAU);
      ctx.fill();
    }
  }

  /* ---------- 炮塔装甲耐久条 ---------- */
  function drawTowerHp(ctx, tw, r) {
    var pct = U.clamp(tw.hp / tw.maxHp, 0, 1);
    var w = r * 1.55, h = Math.max(2.6, r * 0.14);
    var y = -r * 0.98;
    /* 底槽 */
    ctx.fillStyle = 'rgba(0,0,0,.78)';
    roundRect(ctx, -w / 2 - 1.4, y - 1.4, w + 2.8, h + 2.8, 1.4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,195,230,.34)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    /* 空槽 */
    ctx.fillStyle = 'rgba(95,130,165,.22)';
    ctx.fillRect(-w / 2, y, w, h);
    /* 填充 */
    var col = pct > 0.55 ? '#7dff5a' : (pct > 0.25 ? '#ffd23d' : '#ff2e42');
    ctx.fillStyle = col;
    ctx.fillRect(-w / 2, y, w * pct, h);
    /* 顶部亮线 */
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.fillRect(-w / 2, y, w * pct, 1);
    /* 分隔刻度 */
    ctx.strokeStyle = 'rgba(0,0,0,.4)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (var g = 1; g < 4; g++) {
      var gx = -w / 2 + (w / 4) * g;
      ctx.moveTo(gx, y - 0.5); ctx.lineTo(gx, y + h + 0.5);
    }
    ctx.stroke();
  }

  /* ---------- 各塔武器造型 ---------- */
    /* 各塔武器造型：按 kind 分发的独立绘制函数（见下方 wp_*）。
     早期是一个 1000 行的 switch，24 个 case 全挤在同一个函数里：
     局部变量上百个、无法单独阅读/测试某一座塔的造型，加一种塔就要在
     千行里找位置。拆开后每座塔一段，dispatch 走对象表（比 switch 更快）。 */
  var WEAPON_DRAW = {
    'bullet': wp_bullet,
    'beam': wp_beam,
    'slow': wp_slow,
    'tesla': wp_tesla,
    'arc': wp_arc,
    'missile': wp_missile,
    'spike': wp_spike,
    'lance': wp_lance,
    'swarm': wp_swarm,
    'gas': wp_gas,
    'gravity': wp_gravity,
    'sniper': wp_sniper,
    'mine': wp_mine,
    'relay': wp_relay,
    'hover': wp_hover,
    'dronebay': wp_dronebay,
    'dfm': wp_dfm,
    'gustav': wp_gustav,
    'torpedo': wp_torpedo,
    'storm': wp_storm,
    'orbital': wp_orbital,
    'scatter': wp_scatter,
    'beacon': wp_beacon,
    'repair': wp_repair,
    '_default': wp__default,
  };

  function drawWeapon(ctx, tw, col, r, t) {
    /* 极简档（tier 3）：跳过炮塔武器的全部美术绘制。
       120 座塔时 drawWeapon 约占剩余开销的大头（每塔 ~35 次辉光 + ~20 次路径填充）。
       这里只留一个朝向指针 + 一层辉光，塔体本身仍由静态 sprite 完整呈现，
       所以辨识度不受影响 —— 省下的只是纯装饰。 */
    if (qTier >= 3) {
      ctx.save();
      ctx.rotate(tw.ang);
      /* 朝向指针 */
      ctx.fillStyle = U.rgba(col, 0.92);
      ctx.beginPath();
      ctx.moveTo(r * 0.62, 0);
      ctx.lineTo(r * 0.18, -r * 0.17);
      ctx.lineTo(r * 0.18, r * 0.17);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      /* 单层辉光标示核心 */
      glowAt(ctx, 0, 0, r * 0.42, col, 0.34);
      return;
    }
    /* 未知 kind 落到 _default 占位，不会静默跳过 */
    var fnDraw = WEAPON_DRAW[tw.kind] || WEAPON_DRAW._default;
    fnDraw(ctx, tw, col, r, t);
  }

  /* ---- 武器造型：bullet ---- */
  function wp_bullet(ctx, tw, col, r, t) {
/* 转管炮：粗炮身 + 三道散热箍 + 制退器 */
    metalBody(ctx, r * 0.16, -r * 0.28, r * 0.86, r * 0.56, r * 0.12);
    /* 顶部装甲棱线 */
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(r * 0.20, -r * 0.10); ctx.lineTo(r * 0.98, -r * 0.10);
    ctx.stroke();
    /* 散热箍（3 道） */
    for (var i = 0; i < 3; i++) {
      var cx = r * (0.34 + i * 0.24);
      ctx.fillStyle = '#384854';
      roundRect(ctx, cx, -r * 0.32, r * 0.075, r * 0.64, 1.5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1;
      ctx.stroke();
      /* 箍上高光 */
      ctx.fillStyle = 'rgba(200,235,255,.28)';
      ctx.fillRect(cx + 1, -r * 0.31, r * 0.075 - 2, 1.4);
    }
    /* 炮管 */
    metalTube(ctx, r * 0.90, -r * 0.17, r * 0.44, r * 0.34, '#5b6f81', '#33424f');
    /* 制退器开孔 */
    ctx.fillStyle = '#05090c';
    ctx.beginPath(); ctx.arc(r * 1.28, 0, r * 0.075, 0, U.TAU); ctx.fill();
    ctx.strokeStyle = U.rgba(col, .7); ctx.lineWidth = 1; ctx.stroke();
    /* 炮口能量环 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var puls = 0.55 + 0.45 * Math.abs(Math.sin(t * 3 + tw.pulse));
    glowAt(ctx, r * 1.28, 0, r * 0.24, col, 0.35 + puls * 0.4);
    ctx.restore();
    /* 铆钉 */
    rivetRow(ctx, r * 0.24, r * 0.92, r * 0.20, 4, 1.2);
  }

  /* ---- 武器造型：beam ---- */
  function wp_beam(ctx, tw, col, r, t) {
/* 磁轨炮：双轨 + 三组线圈 + 蓄能核心 */
    /* 导轨座 */
    metalBody(ctx, r * 0.10, -r * 0.40, r * 1.36, r * 0.80, r * 0.10, '#3a2a44', '#241a2e', '#120c18');
    /* 上下双轨 */
    for (var tr2 = 0; tr2 < 2; tr2++) {
      var ty2 = tr2 === 0 ? -r * 0.34 : r * 0.18;
      metalTube(ctx, r * 0.14, ty2, r * 1.24, r * 0.16, '#6a5578', '#3a2848');
      /* 轨道高压条纹 */
      ctx.strokeStyle = 'rgba(255,120,200,.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(r * 0.18, ty2 + r * 0.08);
      ctx.lineTo(r * 1.32, ty2 + r * 0.08);
      ctx.stroke();
    }
    /* 三组加速线圈 */
    for (var c2 = 0; c2 < 3; c2++) {
      var cx2 = r * (0.40 + c2 * 0.32);
      ctx.fillStyle = '#0d0812';
      roundRect(ctx, cx2, -r * 0.40, r * 0.13, r * 0.80, 2);
      ctx.fill();
      ctx.strokeStyle = U.rgba(col, 0.85); ctx.lineWidth = 1.3; ctx.stroke();
      /* 线圈内芯 */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glowAt(ctx, cx2 + r * 0.065, 0, r * 0.16, col, 0.5);
      ctx.restore();
    }
    /* 蓄能核心（炮尾） */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var cp = 0.4 + 0.6 * Math.abs(Math.sin(t * 2.2 + tw.pulse));
    glowAt(ctx, r * 0.86, 0, r * 0.40, col, 0.30 + cp * 0.45);
    ctx.restore();
    rivetRow(ctx, r * 0.22, r * 0.86, r * 0.44, 4, 1.3, 'rgba(220,200,255,.4)');
  }

  /* ---- 武器造型：slow ---- */
  function wp_slow(ctx, tw, col, r, t) {
/* 寒霜场：环形发生器 + 制冷鳍片 */
    /* 外环座 */
    ctx.strokeStyle = '#2c3a46'; ctx.lineWidth = r * 0.24;
    ctx.beginPath(); ctx.arc(r * 0.60, 0, r * 0.46, 0, U.TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(r * 0.60, 0, r * 0.58, 0, U.TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(190,230,255,.35)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(r * 0.60, 0, r * 0.34, 0, U.TAU); ctx.stroke();
    /* 制冷鳍片（8 片，随等级展开） */
    var fins = 6 + Math.min(6, Math.floor(tw.level / 2));
    ctx.strokeStyle = 'rgba(175,225,255,.55)';
    ctx.lineWidth = Math.max(1.2, r * 0.075);
    ctx.beginPath();
    for (var f = 0; f < fins; f++) {
      var fa = t * 0.7 + f * U.TAU / fins;
      var r0 = r * 0.42, r1 = r * (0.60 + 0.10 * Math.sin(t * 3 + f));
      ctx.moveTo(r * 0.60 + Math.cos(fa) * r0, Math.sin(fa) * r0);
      ctx.lineTo(r * 0.60 + Math.cos(fa) * r1, Math.sin(fa) * r1);
    }
    ctx.stroke();
    /* 中心冷凝核心 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var fp2 = 0.4 + 0.4 * Math.abs(Math.sin(t * 2.6 + tw.pulse));
    glowAt(ctx, r * 0.60, 0, r * 0.26, col, 0.4 + fp2 * 0.5);
    ctx.restore();
  }

  /* ---- 武器造型：tesla ---- */
  function wp_tesla(ctx, tw, col, r, t) {
/* 特斯拉线圈：陶瓷柱 + 三级环 + 放电器 */
    metalBody(ctx, r * 0.28, -r * 0.30, r * 0.58, r * 0.60, r * 0.10, '#33505e', '#1e323d', '#0e1a22');
    /* 三级陶瓷环 */
    for (var e2 = 0; e2 < 3; e2++) {
      var ex = r * (0.40 + e2 * 0.26);
      /* 环体 */
      ctx.strokeStyle = '#d8e8f2';
      ctx.lineWidth = Math.max(1.6, r * 0.085);
      ctx.beginPath();
      ctx.ellipse(ex, 0, r * 0.155, r * 0.32, 0, 0, U.TAU);
      ctx.stroke();
      /* 环内暗芯 */
      ctx.strokeStyle = 'rgba(20,40,55,.7)'; ctx.lineWidth = Math.max(0.9, r * 0.045);
      ctx.beginPath();
      ctx.ellipse(ex, 0, r * 0.10, r * 0.22, 0, 0, U.TAU);
      ctx.stroke();
      /* 环上高压流光 */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var sp2 = (t * 2.4 + e2 * 0.33) % 1;
      ctx.globalAlpha = 0.35 * (1 - sp2);
      glowAt(ctx, ex + Math.cos(sp2 * U.TAU) * r * 0.15,
        Math.sin(sp2 * U.TAU) * r * 0.30, r * 0.10, col, 1);
      ctx.restore();
    }
    /* 顶端放电器（三角） */
    ctx.fillStyle = '#31434f';
    ctx.beginPath();
    ctx.moveTo(r * 1.30, 0);
    ctx.lineTo(r * 1.04, -r * 0.17);
    ctx.lineTo(r * 1.04, r * 0.17);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.9); ctx.lineWidth = 1.2; ctx.stroke();
    /* 顶端电球 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var bp = 0.5 + 0.5 * Math.sin(t * 9 + tw.pulse);
    glowAt(ctx, r * 1.28, 0, r * 0.30, col, 0.45 + bp * 0.4);
    ctx.restore();
    rivetRow(ctx, r * 0.32, r * 0.80, r * 0.34, 3, 1.2, 'rgba(200,235,255,.42)');
  }

  /* ---- 武器造型：arc ---- */
  function wp_arc(ctx, tw, col, r, t) {
/* 离子风暴：喇叭喷口 + 加热丝 */
    /* 喷口体 */
    ctx.beginPath();
    ctx.moveTo(r * 0.14, -r * 0.26);
    ctx.lineTo(r * 1.24, -r * 0.52);
    ctx.lineTo(r * 1.24, r * 0.52);
    ctx.lineTo(r * 0.14, r * 0.26);
    ctx.closePath();
    var ag = gradL('wp_arc', r * 0.14, 0, r * 1.24, 0, [
      [0, '#4a3a1c'], [0.6, '#33291a'], [1, '#1e1810']]);
    ctx.fillStyle = ag;
    ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.92); ctx.lineWidth = 1.6; ctx.stroke();
    /* 喷口加强筋 */
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.4;
    for (var rb = 0; rb < 3; rb++) {
      var rp = 0.16 + rb * 0.30;
      ctx.beginPath();
      ctx.moveTo(r * rp, -r * 0.26);
      ctx.lineTo(r * rp, r * 0.26);
      ctx.stroke();
    }
    /* 内部加热丝（发光） */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var hw = 0; hw < 3; hw++) {
      var hy = (hw - 1) * r * 0.24;
      var hx2 = r * 1.24;
      var g5 = gradL('wp_heat' + hy, r * 0.30, hy, hx2, hy, [
        [0, 'rgba(255,240,190,0)'],
        [0.7, 'rgba(255,240,190,.75)'],
        [1, U.rgba(col, .9)]]);
      ctx.strokeStyle = g5;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(r * 0.30, hy);
      ctx.lineTo(hx2, hy);
      ctx.stroke();
    }
    ctx.restore();
    /* 喷口外焰（常驻微光） */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var fp3 = 0.35 + 0.3 * Math.abs(Math.sin(t * 6 + tw.pulse));
    glowAt(ctx, r * 1.34, 0, r * 0.42, col, fp3);
    ctx.restore();
    rivetRow(ctx, r * 0.20, r * 0.56, r * 0.22, 3, 1.2, 'rgba(255,235,190,.45)');
  }

  /* ---- 武器造型：missile ---- */
  function wp_missile(ctx, tw, col, r, t) {
/* VLS 垂直发射箱 */
    metalBody(ctx, r * 0.12, -r * 0.50, r * 1.06, r * 1.00, r * 0.14, '#1f3a30', '#16302a', '#0a1a14');
    /* 发射管阵列（3×2） */
    for (var m = 0; m < 3; m++) {
      for (var m2 = 0; m2 < 2; m2++) {
        var mx = r * (0.30 + m * 0.28), my = r * (-0.24 + m2 * 0.46);
        /* 管口 */
        ctx.fillStyle = '#08160f';
        roundRect(ctx, mx, my - r * 0.16, r * 0.20, r * 0.32, r * 0.05);
        ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.62); ctx.lineWidth = 1;
        ctx.stroke();
        /* 管内导弹尾焰 */
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        glowAt(ctx, mx + r * 0.10, my, r * 0.075, col, 0.32);
        ctx.restore();
      }
    }
    /* 装填指示灯 */
    var blink = (Math.sin(t * 4 + tw.pulse) > 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, r * 1.02, 0, r * 0.10, col, blink ? 0.9 : 0.25);
    ctx.restore();
    /* 箱体加强框 */
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.3;
    ctx.strokeRect(r * 0.16, -r * 0.44, r * 0.98, r * 0.88);
    rivetRow(ctx, r * 0.22, r * 0.62, r * 0.44, 3, 1.2, 'rgba(200,255,220,.42)');
  }

  /* ---- 武器造型：spike ---- */
  function wp_spike(ctx, tw, col, r, t) {
/* 地刺阵列：弹起式尖刺（攻击时伸长） */
    var spikeH = (tw.attackAnim || 0);
    /* 基座 */
    ctx.fillStyle = '#141b22';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.42, 0, U.TAU); ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.78); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = 'rgba(180,220,240,.22)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, U.TAU); ctx.stroke();
    /* 3 根尖刺 */
    for (var sp = 0; sp < 3; sp++) {
      var spa = -Math.PI / 2 + (sp - 1) * 0.62;
      var h = r * (0.24 + spikeH * 0.72);
      var bx2 = Math.cos(spa) * r * 0.26, by2 = Math.sin(spa) * r * 0.26;
      var tipX = bx2 + Math.cos(spa) * h, tipY = by2 + Math.sin(spa) * h;
      /* 刺体 */
      var pg = gradL('wp_spk' + sp + (spikeH * 4 | 0), bx2, by2, tipX, tipY, [
        [0, '#3d4a56'], [0.5, '#c9dae8'], [1, '#ffffff']]);
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.moveTo(bx2 - Math.cos(spa + 1.57) * r * 0.12, by2 - Math.sin(spa + 1.57) * r * 0.12);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(bx2 + Math.cos(spa + 1.57) * r * 0.12, by2 + Math.sin(spa + 1.57) * r * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1;
      ctx.stroke();
      /* 尖端电弧 */
      if (spikeH > 0.15) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = U.rgba(col, spikeH);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX + (Math.random() - 0.5) * r * 0.34, tipY - r * 0.28);
        ctx.stroke();
        ctx.restore();
      }
    }
    /* 基座电源环 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, 0, 0, r * 0.30, col, 0.28 + spikeH * 0.5);
    ctx.restore();
  }

  /* ---- 武器造型：lance ---- */
  function wp_lance(ctx, tw, col, r, t) {
/* 镭射光矛：聚焦镜组 */
    /* 镜筒 */
    metalBody(ctx, r * 0.12, -r * 0.34, r * 1.20, r * 0.68, r * 0.16, '#42202c', '#2c1420', '#150a10');
    /* 聚焦镜片（3 组） */
    for (var ln = 0; ln < 3; ln++) {
      var lx = r * (0.38 + ln * 0.30);
      /* 镜座 */
      ctx.fillStyle = '#0c0508';
      ctx.beginPath();
      ctx.ellipse(lx, 0, r * 0.10, r * 0.34, 0, 0, U.TAU);
      ctx.fill();
      ctx.strokeStyle = U.rgba(col, 0.85); ctx.lineWidth = 1.2; ctx.stroke();
      /* 镜面 */
      ctx.fillStyle = 'rgba(255,160,190,.42)';
      ctx.beginPath();
      ctx.ellipse(lx, 0, r * 0.065, r * 0.26, 0, 0, U.TAU);
      ctx.fill();
      /* 镜片反光 */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glowAt(ctx, lx, 0, r * 0.12, col, 0.4);
      ctx.restore();
    }
    /* 蓄能球 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var lp = 0.4 + 0.6 * Math.abs(Math.sin(t * 2.6 + tw.pulse));
    glowAt(ctx, r * 1.32, 0, r * 0.36, col, 0.35 + lp * 0.45);
    ctx.restore();
    /* 能量管线（沿筒身） */
    ctx.strokeStyle = 'rgba(255,140,170,.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r * 0.20, -r * 0.24);
    ctx.quadraticCurveTo(r * 0.80, -r * 0.34, r * 1.20, -r * 0.14);
    ctx.stroke();
    rivetRow(ctx, r * 0.20, r * 0.80, r * 0.30, 4, 1.2, 'rgba(255,200,220,.42)');
  }

  /* ---- 武器造型：swarm ---- */
  function wp_swarm(ctx, tw, col, r, t) {
/* 蜂群母舰：发射巢 */
    ctx.fillStyle = '#16220f';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.60, 0, U.TAU); ctx.fill();
    var sg4 = gradL('wp_swm', 0, -r * 0.6, 0, r * 0.6, [
      [0, '#2c3a20'], [1, '#0f1610']]);
    ctx.fillStyle = sg4;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.58, 0, U.TAU); ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.9); ctx.lineWidth = 1.6; ctx.stroke();
    /* 6 个发射巢格 */
    for (var sg2 = 0; sg2 < 6; sg2++) {
      var sa2 = sg2 * U.TAU / 6 + Math.PI / 6;
      var ex2 = Math.cos(sa2) * r * 0.34, ey2 = Math.sin(sa2) * r * 0.34;
      ctx.fillStyle = '#0d160a';
      ctx.beginPath(); ctx.arc(ex2, ey2, r * 0.115, 0, U.TAU); ctx.fill();
      ctx.strokeStyle = U.rgba(col, 0.65); ctx.lineWidth = 1; ctx.stroke();
    }
    /* 中央处理核心 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var cp2 = 0.3 + 0.3 * Math.abs(Math.sin(t * 3.4 + tw.pulse));
    glowAt(ctx, 0, 0, r * 0.24, col, 0.35 + cp2 * 0.5);
    ctx.restore();
    /* 外圈刻度 */
    ctx.strokeStyle = 'rgba(190,230,160,.28)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 4]);
    ctx.lineDashOffset = -t * 12;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.50, 0, U.TAU); ctx.stroke();
    ctx.setLineDash([]);
  }

  /* ---- 武器造型：gas ---- */
  function wp_gas(ctx, tw, col, r, t) {
/* 毒气塔：毒液罐 + 压力表 + 喷雾阀 */
    metalBody(ctx, r * 0.08, -r * 0.40, r * 0.92, r * 0.80, r * 0.16, '#3a4a24', '#25301a', '#121a0e');
    /* 罐体加强箍 */
    for (var hb = 0; hb < 2; hb++) {
      ctx.fillStyle = '#1c2614';
      roundRect(ctx, r * (0.16 + hb * 0.44), -r * 0.44, r * 0.07, r * 0.88, 1.5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; ctx.stroke();
    }
    /* 压力表 */
    ctx.fillStyle = '#0a0f08';
    ctx.beginPath(); ctx.arc(r * 0.54, -r * 0.12, r * 0.17, 0, U.TAU); ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.85); ctx.lineWidth = 1.3; ctx.stroke();
    /* 表针 */
    var pa = -Math.PI / 2 + (tw.attackAnim || 0) * 1.6;
    ctx.strokeStyle = '#e8ffd0'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(r * 0.54, -r * 0.12);
    ctx.lineTo(r * 0.54 + Math.cos(pa) * r * 0.13, -r * 0.12 + Math.sin(pa) * r * 0.13);
    ctx.stroke();
    /* 喷雾阀 */
    ctx.fillStyle = '#2a3a1c';
    roundRect(ctx, r * 0.34, r * 0.36, r * 0.40, r * 0.22, r * 0.06);
    ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.8); ctx.lineWidth = 1.2; ctx.stroke();
    /* 毒雾喷涌 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var gz = (tw.attackAnim || 0);
    if (gz > 0.02) {
      for (var gp = 0; gp < 4; gp++) {
        var gpa = -Math.PI / 2 + (gp - 1.5) * 0.34 + Math.sin(t * 3 + gp) * 0.08;
        var gd = r * (0.5 + gp * 0.22);
        glowAt(ctx, r * 0.54 + Math.cos(gpa) * gd, r * 0.44 + Math.sin(gpa) * gd,
          r * (0.12 + 0.05 * gp) * (0.5 + gz), col, 0.16 + gz * 0.3);
      }
    }
    ctx.restore();
    rivetRow(ctx, r * 0.20, r * 0.86, r * 0.32, 4, 1.2, 'rgba(220,245,190,.4)');
  }

  /* ---- 武器造型：gravity ---- */
  function wp_gravity(ctx, tw, col, r, t) {
/* 重力井：环形轨道 + 悬浮质量核心 */
    ctx.strokeStyle = '#2c2440'; ctx.lineWidth = r * 0.20;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.52, 0, U.TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.63, 0, U.TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(190,160,255,.32)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.41, 0, U.TAU); ctx.stroke();
    /* 三颗环绕粒子 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var or2 = 0; or2 < 3; or2++) {
      var oa = t * 1.8 + or2 * U.TAU / 3;
      glowAt(ctx, Math.cos(oa) * r * 0.52, Math.sin(oa) * r * 0.52, r * 0.10, col, 0.7);
    }
    ctx.restore();
    /* 悬浮核心 */
    var bob2 = Math.sin(t * 2.2 + tw.pulse) * r * 0.07;
    ctx.save();
    ctx.translate(0, bob2);
    ctx.rotate(t * 0.9);
    ctx.fillStyle = 'rgba(40,26,64,.92)';
    ctx.beginPath();
    for (var oc = 0; oc < 6; oc++) {
      var oca = oc * U.TAU / 6;
      var ocr = r * 0.30;
      if (oc === 0) ctx.moveTo(Math.cos(oca) * ocr, Math.sin(oca) * ocr);
      else ctx.lineTo(Math.cos(oca) * ocr, Math.sin(oca) * ocr);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.95); ctx.lineWidth = 1.7; ctx.stroke();
    ctx.strokeStyle = 'rgba(230,215,255,.4)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-r * 0.30, 0); ctx.lineTo(r * 0.30, 0);
    ctx.moveTo(0, -r * 0.30); ctx.lineTo(0, r * 0.30);
    ctx.stroke();
    ctx.restore();
    /* 核心辉光 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var gv2 = 0.35 + 0.35 * Math.abs(Math.sin(t * 2.4 + tw.pulse));
    glowAt(ctx, 0, bob2, r * 0.34, col, gv2);
    glowAt(ctx, 0, bob2, r * 0.14, '#efe6ff', gv2 * 0.8);
    ctx.restore();
  }

  /* ---- 武器造型：sniper ---- */
  function wp_sniper(ctx, tw, col, r, t) {
/* 狙击塔：长枪身 + 光学瞄具 + 制退器 */
    metalBody(ctx, r * 0.06, -r * 0.24, r * 1.34, r * 0.48, r * 0.10, '#4a3a28', '#2e2418', '#16110a');
    /* 顶部导轨 */
    ctx.fillStyle = '#241a10';
    roundRect(ctx, r * 0.30, -r * 0.30, r * 0.86, r * 0.10, 1.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1; ctx.stroke();
    /* 枪管 */
    metalTube(ctx, r * 1.20, -r * 0.13, r * 0.42, r * 0.26, '#6a5a48', '#3a2e20');
    /* 光学瞄具 */
    ctx.fillStyle = '#10161c';
    roundRect(ctx, r * 0.52, -r * 0.52, r * 0.44, r * 0.24, r * 0.06);
    ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.9); ctx.lineWidth = 1.3; ctx.stroke();
    /* 目镜反光 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, r * 0.96, -r * 0.40, r * 0.08, '#ffffff', 0.5);
    ctx.restore();
    /* 制退器开孔 */
    ctx.fillStyle = '#05090c';
    ctx.beginPath(); ctx.arc(r * 1.60, 0, r * 0.09, 0, U.TAU); ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.75); ctx.lineWidth = 1; ctx.stroke();
    /* 瞄准激光（有目标时） */
    if (tw.target) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = U.rgba(col, 0.20 + 0.12 * Math.abs(Math.sin(t * 5)));
      ctx.lineWidth = 0.9;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(r * 1.60, 0);
      ctx.lineTo(tw.target.x - tw.x, tw.target.y - tw.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    rivetRow(ctx, r * 0.14, r * 0.70, r * 0.20, 4, 1.2, 'rgba(255,220,180,.42)');
  }

  /* ---- 武器造型：mine ---- */
  function wp_mine(ctx, tw, col, r, t) {
/* 矿场：矿坑 + 传送带 + 金币堆 */
    metalBody(ctx, -r * 0.52, -r * 0.30, r * 1.04, r * 0.86, r * 0.14, '#5a4a24', '#3a2f18', '#1e1608');
    /* 矿坑口（暗） */
    ctx.fillStyle = '#0a0803';
    ctx.beginPath(); ctx.ellipse(0, r * 0.06, r * 0.34, r * 0.24, 0, 0, U.TAU); ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.8); ctx.lineWidth = 1.3; ctx.stroke();
    /* 金币堆（随 attackAnim 脉动） */
    var mnPulse = tw.attackAnim || 0;
    for (var cn = 0; cn < 4; cn++) {
      var ca = cn * 1.57 + t * 0.6;
      var cr = r * (0.10 + cn * 0.05);
      ctx.fillStyle = cn % 2 ? '#ffd23d' : '#ffe98a';
      ctx.beginPath();
      ctx.arc(Math.cos(ca) * cr, r * 0.02 + Math.sin(ca) * cr * 0.5, r * 0.075 * (0.8 + mnPulse * 0.4), 0, U.TAU);
      ctx.fill();
    }
    /* 顶部矿车轨道 */
    ctx.strokeStyle = '#6a5a34';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.42); ctx.lineTo(r * 0.5, -r * 0.42);
    ctx.stroke();
    /* 产出指示灯 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, r * 0.42, -r * 0.42, r * 0.10, col, 0.4 + mnPulse * 0.5);
    ctx.restore();
  }

  /* ---- 武器造型：relay ---- */
  function wp_relay(ctx, tw, col, r, t) {
/* 通讯中继站：天线塔 + 信号盘 */
    /* 塔身 */
    metalBody(ctx, -r * 0.14, -r * 0.1, r * 0.28, r * 0.62, r * 0.06, '#4a4020', '#2e2812', '#161208');
    /* 三脚底座 */
    ctx.strokeStyle = '#3a3420'; ctx.lineWidth = Math.max(2, r * 0.10); ctx.lineCap = 'round';
    for (var tr3 = 0; tr3 < 3; tr3++) {
      var ta3 = -Math.PI / 2 + tr3 * U.TAU / 3;
      ctx.beginPath();
      ctx.moveTo(0, r * 0.34);
      ctx.lineTo(Math.cos(ta3) * r * 0.5, r * 0.34 + Math.abs(Math.sin(ta3)) * r * 0.3);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    /* 信号盘（旋转） */
    var sig = tw.attackAnim || 0;
    ctx.save();
    ctx.translate(0, -r * 0.30);
    ctx.rotate(t * 0.8);
    ctx.strokeStyle = U.rgba(col, 0.9); ctx.lineWidth = 1.8;
    for (var dr = 0; dr < 3; dr++) {
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.16 + dr * 0.11), 0.6, 2.4);
      ctx.stroke();
    }
    ctx.restore();
    /* 顶端信号灯 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, 0, -r * 0.34, r * 0.13, col, 0.45 + sig * 0.5);
    ctx.restore();
    /* 扩散信号环 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var wv2 = (t * 0.7) % 1;
    ctx.strokeStyle = U.rgba(col, (1 - wv2) * 0.5);
    ctx.lineWidth = 2 * (1 - wv2) + 0.6;
    ctx.beginPath(); ctx.arc(0, -r * 0.30, r * (0.2 + wv2 * 0.9), 0, U.TAU); ctx.stroke();
    ctx.restore();
  }

  /* ---- 武器造型：hover ---- */
  function wp_hover(ctx, tw, col, r, t) {
/* 浮游炮台：悬浮核心 + 推进环 */
    var hbob = Math.sin(t * 2.4 + tw.pulse) * r * 0.08;
    /* 推进环（下） */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var thrust = tw.moving ? 1 : 0.35;
    var tg2 = ctx.createRadialGradient(0, r * 0.34, 0, 0, r * 0.34, r * 0.34 * thrust);
    tg2.addColorStop(0, U.rgba('#a8d8ff', 0.5 * thrust));
    tg2.addColorStop(1, U.rgba('#a8d8ff', 0));
    ctx.fillStyle = tg2;
    ctx.beginPath(); ctx.ellipse(0, r * 0.34, r * 0.26 * thrust, r * 0.12 * thrust, 0, 0, U.TAU); ctx.fill();
    ctx.restore();
    /* 悬浮体 */
    ctx.save();
    ctx.translate(0, hbob);
    metalBody(ctx, -r * 0.30, -r * 0.26, r * 0.60, r * 0.52, r * 0.20, '#4a5a68', '#2e3a44', '#161e26');
    /* 能量环 */
    ctx.strokeStyle = U.rgba(col, 0.85); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.40, r * 0.16, 0, 0, U.TAU); ctx.stroke();
    /* 核心 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, 0, 0, r * 0.20, col, 0.5 + 0.3 * Math.abs(Math.sin(t * 3 + tw.pulse)));
    ctx.restore();
    ctx.restore();
    /* 炮管（细长） */
    metalTube(ctx, r * 0.28, -r * 0.07, r * 0.50, r * 0.14, '#6a7a8a', '#3a4652');
  }

  /* ---- 武器造型：dronebay ---- */
  function wp_dronebay(ctx, tw, col, r, t) {
/* 蜂群母舰：扁平舰体 + 三格发射舱 + 旋转环，无炮管 */
    var cbob = Math.sin(t * 2.1 + tw.pulse) * r * 0.07;
    ctx.save();
    ctx.translate(0, cbob);

    /* 推进环（下） */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var cthr = tw.moving ? 1 : 0.4;
    var cth = ctx.createRadialGradient(0, r * 0.36, 0, 0, r * 0.36, r * 0.40 * cthr);
    cth.addColorStop(0, U.rgba(col, 0.42 * cthr));
    cth.addColorStop(1, U.rgba(col, 0));
    ctx.fillStyle = cth;
    ctx.beginPath(); ctx.ellipse(0, r * 0.36, r * 0.32 * cthr, r * 0.14 * cthr, 0, 0, U.TAU); ctx.fill();
    ctx.restore();

    /* 舰体（菱形装甲板） */
    ctx.fillStyle = '#243318';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.52);
    ctx.lineTo(r * 0.62, 0);
    ctx.lineTo(0, r * 0.52);
    ctx.lineTo(-r * 0.62, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.8); ctx.lineWidth = 1.6; ctx.stroke();
    /* 内层甲板 */
    ctx.fillStyle = '#1a2410';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.34);
    ctx.lineTo(r * 0.40, 0);
    ctx.lineTo(0, r * 0.34);
    ctx.lineTo(-r * 0.40, 0);
    ctx.closePath();
    ctx.fill();

    /* 三个发射舱口（各对应一格槽位） */
    var live = tw.droneAlive ? tw.droneAlive() : 0;
    for (var cb = 0; cb < 3; cb++) {
      var bx = (cb - 1) * r * 0.26;
      var hasOne = cb < live;
      ctx.fillStyle = hasOne ? U.rgba(col, 0.85) : 'rgba(20,28,14,.9)';
      ctx.beginPath();
      ctx.ellipse(bx, 0, r * 0.10, r * 0.17, 0, 0, U.TAU);
      ctx.fill();
      ctx.strokeStyle = U.rgba(hasOne ? '#ffffff' : col, hasOne ? 0.7 : 0.35);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    /* 旋转指挥环 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = U.rgba(col, 0.55);
    ctx.lineWidth = 1.6;
    var csp = t * 1.7 + tw.pulse;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.50, r * 0.20, 0, csp, csp + 2.0); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.50, r * 0.20, 0, csp + Math.PI, csp + Math.PI + 2.0); ctx.stroke();
    glowAt(ctx, 0, 0, r * 0.22, col, 0.4 + 0.25 * Math.sin(t * 3 + tw.pulse));
    ctx.restore();

    /* 顶部指挥灯（按在编数量变色：满编绿、缺编红闪） */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var full = live >= 5;
    glowAt(ctx, 0, -r * 0.46, r * 0.16,
      full ? col : '#ff4d6d',
      full ? 0.5 : 0.35 + 0.4 * Math.abs(Math.sin(t * 9)));
    ctx.restore();

    ctx.restore();
  }

  /* ---- 武器造型：dfm ---- */
  function wp_dfm(ctx, tw, col, r, t) {
/* 东风导弹：竖井式导弹发射井 + 露出弹头 + 雷达阵 */
    metalBody(ctx, -r * 0.40, r * 0.10, r * 0.80, r * 0.48, r * 0.10, '#3a2028', '#241318', '#120a0e');
    /* 发射井 */
    ctx.fillStyle = '#0d0810';
    roundRect(ctx, -r * 0.26, -r * 0.34, r * 0.52, r * 0.48, r * 0.06); ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.55); ctx.lineWidth = 1.2;
    ctx.stroke();
    /* 导弹升起动画：cd 越接近 0（越接近发射）弹头越露出 */
    var launch = tw.launchT != null ? tw.launchT : 0;   /* 1 -> 0 倒计时 */
    var rocketY = -r * 0.30 + launch * r * 0.52;
    if (launch > 0.01) {
      /* 尾焰：拉长的橙红锥形 + 白芯 */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var fl = launch * (0.7 + 0.3 * Math.sin(t * 42));
      var fg = ctx.createLinearGradient(0, rocketY + r * 0.34, 0, rocketY + r * 0.34 + r * 1.5 * fl);
      fg.addColorStop(0, 'rgba(255,240,190,.95)');
      fg.addColorStop(0.32, U.rgba(col, 0.8));
      fg.addColorStop(1, U.rgba('#ff8a2a', 0));
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(-r * 0.12, rocketY + r * 0.34);
      ctx.lineTo(r * 0.12, rocketY + r * 0.34);
      ctx.lineTo(0, rocketY + r * 0.34 + r * 1.6 * fl);
      ctx.closePath(); ctx.fill();
      glowAt(ctx, 0, rocketY + r * 0.40, r * 0.5 * fl, '#ffd23d', 0.7 * fl);
      ctx.restore();
    }
    /* 弹体 */
    ctx.fillStyle = '#d8dde4';
    roundRect(ctx, -r * 0.09, rocketY, r * 0.18, r * 0.34, r * 0.05); ctx.fill();
    /* 弹头锥 */
    ctx.fillStyle = '#eef2f6';
    ctx.beginPath();
    ctx.moveTo(-r * 0.09, rocketY);
    ctx.lineTo(0, rocketY - r * 0.14);
    ctx.lineTo(r * 0.09, rocketY);
    ctx.closePath(); ctx.fill();
    /* 弹头导引头（红） */
    ctx.fillStyle = U.rgba(col, 0.95);
    roundRect(ctx, -r * 0.09, rocketY + r * 0.02, r * 0.18, r * 0.09, r * 0.03); ctx.fill();
    /* 尾翼 */
    ctx.fillStyle = '#8a9099';
    ctx.beginPath();
    ctx.moveTo(-r * 0.09, rocketY + r * 0.30); ctx.lineTo(-r * 0.19, rocketY + r * 0.40);
    ctx.lineTo(-r * 0.09, rocketY + r * 0.40); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.09, rocketY + r * 0.30); ctx.lineTo(r * 0.19, rocketY + r * 0.40);
    ctx.lineTo(r * 0.09, rocketY + r * 0.40); ctx.closePath(); ctx.fill();
    /* 警戒灯 + 雷达扇面 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, r * 0.30, -r * 0.20, r * 0.12, col, 0.35 + 0.35 * Math.abs(Math.sin(t * 3.2 + tw.pulse)));
    var sweep = (t * 1.6 + tw.pulse) % (U.TAU);
    ctx.strokeStyle = U.rgba(col, 0.32); ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(-r * 0.30, r * 0.26);
    ctx.lineTo(-r * 0.30 + Math.cos(sweep - 1.2) * r * 0.34, r * 0.26 + Math.sin(sweep - 1.2) * r * 0.34);
    ctx.stroke();
    ctx.restore();
  }

  /* ---- 武器造型：gustav ---- */
  function wp_gustav(ctx, tw, col, r, t) {
/* 古斯塔夫炮：巨型双层炮管 + 液压驻锄 + 配重块 */
    metalBody(ctx, -r * 0.44, r * 0.14, r * 0.88, r * 0.44, r * 0.12, '#4a4034', '#2e281f', '#171310');
    /* 驻锄 */
    ctx.strokeStyle = '#6a5c46'; ctx.lineWidth = r * 0.10; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-r * 0.40, r * 0.30); ctx.lineTo(-r * 0.16, r * 0.06); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r * 0.40, r * 0.30); ctx.lineTo(r * 0.16, r * 0.06); ctx.stroke();
    /* 炮管：外套管 + 内芯 */
    metalTube(ctx, r * 0.16, -r * 0.11, r * 0.92, r * 0.19, '#8a7a5c', '#4a4034');
    metalTube(ctx, r * 0.34, -r * 0.055, r * 0.62, r * 0.10, '#c8b48a', '#6a5c46');
    /* 炮口制退器 */
    ctx.fillStyle = '#3a3226';
    roundRect(ctx, r * 1.00, -r * 0.16, r * 0.14, r * 0.32, r * 0.04); ctx.fill();
    /* 蓄能指示 */
    var charge = tw.cd > 0 ? U.clamp(1 - tw.cd / Math.max(0.001, (tw.def.base.delay || 1.2)), 0, 1) : 0;
    if (charge > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glowAt(ctx, r * 0.52, 0, r * 0.14 * charge, col, 0.5 * charge);
      ctx.restore();
    }
  }

  /* ---- 武器造型：torpedo ---- */
  function wp_torpedo(ctx, tw, col, r, t) {
/* 巡飞弹巢：倾斜弹箱 + 露出的弹翼 */
    metalBody(ctx, -r * 0.36, -r * 0.24, r * 0.72, r * 0.48, r * 0.14, '#20404f', '#12262f', '#0a161c');
    for (var tp2 = 0; tp2 < 3; tp2++) {
      var ty2 = -r * 0.18 + tp2 * r * 0.16;
      ctx.fillStyle = '#0a161c';
      roundRect(ctx, -r * 0.28, ty2, r * 0.56, r * 0.11, r * 0.04); ctx.fill();
      ctx.fillStyle = U.rgba(col, 0.75);
      roundRect(ctx, r * 0.06, ty2 + r * 0.02, r * 0.20, r * 0.07, r * 0.03); ctx.fill();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, r * 0.20, 0, r * 0.13, col, 0.35 + 0.3 * Math.abs(Math.sin(t * 4 + tw.pulse)));
    ctx.restore();
  }

  /* ---- 武器造型：storm ---- */
  function wp_storm(ctx, tw, col, r, t) {
/* 聚能电弧风暴：三根电弧柱 + 顶部球 */
    /* 基座 */
    metalBody(ctx, -r * 0.34, r * 0.18, r * 0.68, r * 0.40, r * 0.10, '#2a4a5e', '#1a3040', '#0e1a24');
    /* 三根电弧柱 */
    for (var pc = 0; pc < 3; pc++) {
      var px3 = (pc - 1) * r * 0.26;
      ctx.fillStyle = '#101c26';
      roundRect(ctx, px3 - r * 0.055, -r * 0.42, r * 0.11, r * 0.60, r * 0.03);
      ctx.fill();
      ctx.strokeStyle = U.rgba(col, 0.7); ctx.lineWidth = 1; ctx.stroke();
      /* 爬升电弧 */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var arcH = 0.3 + 0.7 * Math.abs(Math.sin(t * 6 + pc * 1.3 + tw.pulse));
      glowAt(ctx, px3, -r * 0.40, r * 0.09 * arcH, col, 0.5 * arcH);
      ctx.restore();
    }
    /* 顶端电球 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var bp3 = 0.5 + 0.5 * Math.sin(t * 9 + tw.pulse);
    glowAt(ctx, 0, -r * 0.46, r * 0.26, col, 0.4 + bp3 * 0.45);
    glowAt(ctx, 0, -r * 0.46, r * 0.10, '#ffffff', 0.5 + bp3 * 0.4);
    ctx.restore();
    rivetRow(ctx, -r * 0.28, r * 0.28, r * 0.46, 4, 1.2, 'rgba(200,235,255,.42)');
  }

  /* ---- 武器造型：orbital ---- */
  function wp_orbital(ctx, tw, col, r, t) {
/* 轨道轰炸平台：卫星盘 + 炮口阵列 */
    /* 盘体 */
    ctx.fillStyle = '#2a1a26';
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.66, r * 0.34, 0, 0, U.TAU); ctx.fill();
    var og = ctx.createLinearGradient(0, -r * 0.34, 0, r * 0.34);
    og.addColorStop(0, '#4a2a3e');
    og.addColorStop(1, '#1e1220');
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.60, r * 0.30, 0, 0, U.TAU); ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.9); ctx.lineWidth = 1.7; ctx.stroke();
    /* 太阳能板（两侧） */
    ctx.fillStyle = '#1a3048';
    roundRect(ctx, -r * 0.92, -r * 0.12, r * 0.30, r * 0.24, r * 0.04);
    ctx.fill();
    ctx.strokeStyle = 'rgba(140,200,255,.5)'; ctx.lineWidth = 1; ctx.stroke();
    roundRect(ctx, r * 0.62, -r * 0.12, r * 0.30, r * 0.24, r * 0.04);
    ctx.fill();
    ctx.stroke();
    /* 板栅格 */
    ctx.strokeStyle = 'rgba(140,200,255,.28)'; ctx.lineWidth = 0.8;
    for (var pv = 0; pv < 3; pv++) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.92 + pv * r * 0.10, -r * 0.12); ctx.lineTo(-r * 0.92 + pv * r * 0.10, r * 0.12);
      ctx.moveTo(r * 0.62 + pv * r * 0.10, -r * 0.12); ctx.lineTo(r * 0.62 + pv * r * 0.10, r * 0.12);
      ctx.stroke();
    }
    /* 中央炮口（朝上张开的发射井） */
    ctx.fillStyle = '#0a0508';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, U.TAU); ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.9); ctx.lineWidth = 1.5; ctx.stroke();
    /* 装填指示灯 */
    var load2 = tw.cd > 0 ? 1 - Math.min(1, tw.cd / (1 / Math.max(0.05, (tw.stats().rate || 0.12)))) : 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, 0, 0, r * 0.16 * (0.5 + load2 * 0.8), col, 0.3 + load2 * 0.55);
    ctx.restore();
    /* 旋转扫描线 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.rotate(t * 0.6);
    ctx.strokeStyle = U.rgba(col, 0.35);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.arc(0, 0, r * 0.74, 0, U.TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* ---- 武器造型：scatter ---- */
  function wp_scatter(ctx, tw, col, r, t) {
/* 熔渣散射炮：多头短炮 + 隔热盾 */
    /* 炮座 */
    metalBody(ctx, -r * 0.34, -r * 0.24, r * 0.70, r * 0.48, r * 0.12, '#4a3420', '#2e2012', '#161008');
    /* 三根短炮管（扇形张开预置） */
    for (var sb = -1; sb <= 1; sb++) {
      ctx.save();
      ctx.rotate(sb * 0.22);
      metalTube(ctx, r * 0.30, -r * 0.075, r * 0.62, r * 0.15, '#6a5a44', '#3a2e20');
      /* 炮口隔热盾 */
      ctx.fillStyle = '#241a10';
      roundRect(ctx, r * 0.84, -r * 0.13, r * 0.12, r * 0.26, r * 0.03);
      ctx.fill();
      ctx.strokeStyle = U.rgba(col, 0.7); ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    /* 中央弹药箱 */
    ctx.fillStyle = '#1a1208';
    roundRect(ctx, -r * 0.10, -r * 0.20, r * 0.24, r * 0.40, r * 0.05);
    ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.75); ctx.lineWidth = 1.2; ctx.stroke();
    rivetRow(ctx, -r * 0.26, r * 0.20, r * 0.20, 4, 1.2, 'rgba(255,220,180,.42)');
  }

  /* ---- 武器造型：beacon ---- */
  function wp_beacon(ctx, tw, col, r, t) {
/* 增幅信标：三脚支架 + 悬浮棱晶 */
    /* 三脚（金属管） */
    for (var bg2 = 0; bg2 < 3; bg2++) {
      var ba2 = -Math.PI / 2 + bg2 * U.TAU / 3;
      var ex3 = Math.cos(ba2) * r * 0.84, ey3 = Math.sin(ba2) * r * 0.84 + r * 0.22;
      /* 支腿 */
      metalTube(ctx, Math.min(0, ex3) - r * 0.05, Math.min(0, ey3) - r * 0.05,
        Math.abs(ex3) + r * 0.10, Math.abs(ey3) + r * 0.10, r * 0.05, '#4a5a68', '#2a3641');
      /* 简化：直接画线更稳 */
      ctx.strokeStyle = '#2c3a46';
      ctx.lineWidth = Math.max(2.4, r * 0.14);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(ex3, ey3); ctx.stroke();
      ctx.strokeStyle = 'rgba(180,220,250,.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(ex3 - 1, ey3); ctx.stroke();
      /* 脚垫 */
      ctx.fillStyle = '#1a242c';
      ctx.beginPath(); ctx.arc(ex3, ey3, r * 0.075, 0, U.TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(150,195,230,.4)'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.lineCap = 'butt';
    /* 悬浮棱晶 */
    var bob = Math.sin(t * 2 + tw.pulse) * r * 0.09;
    ctx.save();
    ctx.translate(0, bob - r * 0.12);
    ctx.rotate(t * 0.5);
    /* 棱晶体 */
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.58); ctx.lineTo(r * 0.37, 0);
    ctx.lineTo(0, r * 0.58); ctx.lineTo(-r * 0.37, 0);
    ctx.closePath();
    var pg2 = gradL('wp_bcn', -r * 0.37, -r * 0.58, r * 0.37, r * 0.58, [
      [0, 'rgba(90,72,20,.95)'], [0.5, 'rgba(60,48,12,.95)'], [1, 'rgba(28,22,6,.95)']]);
    ctx.fillStyle = pg2;
    ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.95); ctx.lineWidth = 1.8; ctx.stroke();
    /* 内部刻面线 */
    ctx.strokeStyle = 'rgba(255,230,150,.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.58); ctx.lineTo(0, r * 0.58);
    ctx.moveTo(-r * 0.37, 0); ctx.lineTo(r * 0.37, 0);
    ctx.stroke();
    ctx.restore();
    /* 棱晶辉光 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var bp2 = 0.4 + 0.5 * Math.abs(Math.sin(t * 2.2 + tw.pulse));
    glowAt(ctx, 0, bob - r * 0.12, r * 0.80, col, 0.28 + bp2 * 0.42);
    /* 内部亮点 */
    glowAt(ctx, 0, bob - r * 0.12, r * 0.22, '#fff6d8', 0.5 + bp2 * 0.4);
    ctx.restore();
  }

  /* ---- 武器造型：repair ---- */
  function wp_repair(ctx, tw, col, r, t) {
/* 修复厂：厂房 + 旋转吊臂 + 焊枪光点 */
    /* 厂房主体 */
    metalBody(ctx, -r * 0.56, -r * 0.44, r * 1.12, r * 0.88, r * 0.12, '#1f3a2a', '#163028', '#0a1a12');
    /* 屋顶排气 */
    ctx.fillStyle = '#2a3a30';
    roundRect(ctx, -r * 0.30, -r * 0.60, r * 0.60, r * 0.20, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; ctx.stroke();
    /* 卷帘门 */
    ctx.fillStyle = '#0d1a12';
    roundRect(ctx, -r * 0.26, -r * 0.06, r * 0.52, r * 0.40, 2);
    ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.6); ctx.lineWidth = 1.1; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (var sl = 0; sl < 3; sl++) {
      var sy = -r * 0.02 + sl * r * 0.13;
      ctx.moveTo(-r * 0.24, sy); ctx.lineTo(r * 0.24, sy);
    }
    ctx.stroke();
    /* 顶部旋转吊臂 */
    ctx.save();
    ctx.translate(0, -r * 0.52);
    ctx.rotate(t * 0.6 + tw.pulse);
    ctx.strokeStyle = '#3d4a44';
    ctx.lineWidth = Math.max(2, r * 0.09);
    ctx.beginPath(); ctx.moveTo(-r * 0.52, 0); ctx.lineTo(r * 0.52, 0); ctx.stroke();
    ctx.strokeStyle = 'rgba(180,230,200,.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-r * 0.50, -1.4); ctx.lineTo(r * 0.50, -1.4); ctx.stroke();
    /* 吊臂末端焊枪 */
    ctx.fillStyle = '#1a2620';
    ctx.fillRect(r * 0.42, -r * 0.08, r * 0.14, r * 0.16);
    /* 焊枪火花 */
    if (Math.random() < 0.25) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glowAt(ctx, r * 0.56, 0, r * 0.14, '#fff6d8', 0.9);
      ctx.restore();
    }
    /* 中心轴 */
    ctx.fillStyle = '#2c3a34';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.11, 0, U.TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(150,200,180,.45)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    /* 状态指示灯：作业中高亮 */
    var rpOn = tw.attackAnim > 0.1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowAt(ctx, -r * 0.40, r * 0.30, r * 0.09, col, rpOn ? 0.95 : 0.25);
    ctx.restore();
    /* 厂房铆钉 */
    rivetRow(ctx, -r * 0.44, r * 0.44, r * 0.36, 4, 1.2, 'rgba(200,255,220,.42)');
  }

  /* ---- 武器造型：_default ---- */
  function wp__default(ctx, tw, col, r, t) {
/* 未知武器 kind 的可见占位（菱形指针）。
       不能静默跳过：那会让「塔建出来了但武器不显示」这种缺陷
       只能靠玩家肉眼发现，且没有任何画面线索指向原因。
       占位菱形至少让问题立刻可见，同时保持塔的整体辨识度。 */
    ctx.save();
    ctx.rotate(tw.ang);
    ctx.fillStyle = U.rgba(col, 0.75);
    ctx.beginPath();
    ctx.moveTo(r * 0.70, 0);
    ctx.lineTo(0, -r * 0.22);
    ctx.lineTo(-r * 0.30, 0);
    ctx.lineTo(0, r * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }


  function roundRect(ctx, x, y, wd, ht, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + wd - r, y);
    ctx.quadraticCurveTo(x + wd, y, x + wd, y + r);
    ctx.lineTo(x + wd, y + ht - r);
    ctx.quadraticCurveTo(x + wd, y + ht, x + wd - r, y + ht);
    ctx.lineTo(x + r, y + ht);
    ctx.quadraticCurveTo(x, y + ht, x, y + ht - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ============================================================
     敌人：敌方机甲单位
     统一画风：深钢装甲 + 阵营色点缀 + 面板线 + 铆钉 + 发光目镜
     ============================================================ */
  function drawEnemy(ctx, e, t) {
    var alpha = e.alive ? 1 : U.clamp(e.deadT / 0.28, 0, 1);
    if (alpha <= 0) return;
    var r = e.w * 0.5;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(e.x, e.y);

    /* 死亡消散：膨胀 + 淡出 */
    if (!e.alive) {
      var k = 1 - e.deadT / 0.28;
      ctx.scale(1 + k * 0.55, 1 + k * 0.55);
      ctx.globalAlpha = alpha * 0.6;
    }

    /* 隐形单位：半透明 + 边缘抖动 */
    if (e.ghost) {
      ctx.globalAlpha = alpha * (0.50 + 0.26 * Math.sin(t * 4.2 + e.bob));
    }

    /* 地面投影 */
    ctx.fillStyle = 'rgba(0,0,0,.48)';
    ctx.beginPath(); ctx.ellipse(0, r * 0.52, r * 0.9, r * 0.36, 0, 0, U.TAU); ctx.fill();

    /* 减速冰霜 */
    if (e.slowT > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var ig = gradR('en_ice_' + e.type, 0, 0, r * 0.2, 0, 0, r * 1.35, [
        [0, 'rgba(122,212,255,.32)'],
        [1, 'rgba(122,212,255,0)']
      ]);
      ctx.fillStyle = ig;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.35, 0, U.TAU); ctx.fill();
      ctx.restore();
      /* 冰晶外壳 */
      ctx.strokeStyle = 'rgba(160,230,255,.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (var ic = 0; ic < 6; ic++) {
        var ia = ic * U.TAU / 6 + e.bob * 0.2;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ia) * r * 1.1, Math.sin(ia) * r * 1.1);
      }
      ctx.stroke();
    }

    /* 护盾泡（视觉与逻辑一致：shield>0 才显示） */
    if (e.maxShield > 0 && e.shield > 0) {
      var shP = e.shield / e.maxShield;
      var bub = 0.5 + 0.5 * Math.sin(t * 2.6 + e.bob);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var bgr = gradR('en_sh_' + e.type + (bub * 6 | 0), 0, 0, r * 0.82, 0, 0, r * 1.17, [
        [0, 'rgba(74,143,240,0)'],
        [0.80, 'rgba(74,143,240,' + (0.12 + bub * 0.08) + ')'],
        [1, 'rgba(170,215,255,' + (0.26 + shP * 0.26) + ')']
      ]);
      ctx.fillStyle = bgr;
      ctx.beginPath(); ctx.arc(0, 0, r * (1.14 + bub * 0.05), 0, U.TAU); ctx.fill();
      /* 六边网格纹 */
      ctx.strokeStyle = 'rgba(200,232,255,.14)'; ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (var sg3 = 0; sg3 < 6; sg3++) {
        var sa3 = sg3 * U.TAU / 6;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(sa3) * r * 1.1, Math.sin(sa3) * r * 1.1);
      }
      ctx.stroke();
      /* 破损裂纹 */
      if (shP < 0.4) {
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.3 + 0.2 * Math.sin(t * 9)) + ')';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (var ck = 0; ck < 3; ck++) {
          var ca = ck * 2.1 + e.bob;
          ctx.moveTo(Math.cos(ca) * r * 0.5, Math.sin(ca) * r * 0.5);
          ctx.lineTo(Math.cos(ca + 0.5) * r * 1.1, Math.sin(ca + 0.5) * r * 1.1);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    /* 流血状态 */
    if (e.dotT > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(182,244,255,.28)';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.0, t * 3, t * 3 + 2.2); ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    /* 朝向：机体沿行进方向 */
    ctx.rotate(e.ang);
    drawMech(ctx, e, r, t);
    ctx.restore();

    /* 受击白闪 */
    var hit = e.hitT > 0 ? U.clamp(e.hitT / 0.12, 0, 1) : 0;
    if (hit > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = hit * 0.75;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.92, 0, U.TAU); ctx.fill();
      ctx.restore();
    }

    /* 阵营色外辉光 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * (e.shape === 'boss' ? 0.42 : 0.20);
    var eg = gradR('en_eg_' + e.type, 0, 0, r * 0.45, 0, 0, r * 1.5, [
      [0, U.rgba(e.color, 0.55)],
      [1, U.rgba(e.color, 0)]
    ]);
    ctx.fillStyle = eg;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.5, 0, U.TAU); ctx.fill();
    ctx.restore();

    /* BOSS：旋转警戒环 */
    if (e.shape === 'boss') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.rotate(t * 0.7);
      ctx.strokeStyle = U.rgba(e.color, 0.55);
      ctx.lineWidth = 1.8;
      ctx.setLineDash([10, 10]);
      ctx.beginPath(); ctx.arc(0, 0, r * 1.36, 0, U.TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.rotate(-t * 1.3);
      ctx.strokeStyle = U.rgba('#ffd23d', 0.42);
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.18, 0, U.TAU); ctx.stroke();
      ctx.restore();
    }

    /* 血条 + 护盾条：装甲分段槽 */
    var hpPct = e.hp / e.maxHp;
    var shPct = e.maxShield > 0 ? (e.shield / e.maxShield) : 0;
    if (hpPct < 1 || shPct > 0) {
      var bw = r * 2.0, bh = e.shape === 'boss' ? 6 : 3.4;
      var by = -r - (e.shape === 'boss' ? 12 : 7);
      ctx.fillStyle = 'rgba(0,0,0,.82)';
      ctx.fillRect(-bw / 2 - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = 'rgba(34,46,58,.95)';
      ctx.fillRect(-bw / 2, by, bw, bh);
      var hc = hpPct > 0.55 ? '#7dff5a' : (hpPct > 0.25 ? '#ffd23d' : '#ff3b47');
      var segs = e.shape === 'boss' ? 14 : 7;
      var filled = hpPct * segs;
      for (var sg = 0; sg < segs; sg++) {
        var sw = bw / segs - 1.2;
        var sx = -bw / 2 + sg * (bw / segs);
        if (sg < filled) {
          ctx.fillStyle = hc;
          ctx.shadowColor = hc; ctx.shadowBlur = 5;
        } else ctx.fillStyle = 'rgba(70,92,112,.35)';
        ctx.fillRect(sx, by, sw, bh);
        ctx.shadowBlur = 0;
      }
      ctx.strokeStyle = 'rgba(150,195,230,.35)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(-bw / 2 - 1, by - 1, bw + 2, bh + 2);

      /* 护盾条叠在血条上方 */
      if (shPct > 0) {
        var sy = by - 3.6;
        ctx.fillStyle = 'rgba(0,0,0,.72)';
        ctx.fillRect(-bw / 2 - 1, sy - 1, bw + 2, 3.2);
        ctx.fillStyle = '#4a8ff0';
        ctx.shadowColor = '#8fd8ff'; ctx.shadowBlur = 5;
        ctx.fillRect(-bw / 2, sy, bw * shPct, 3.2);
        ctx.shadowBlur = 0;
      }
    }

    /* 护甲指示：叠层钢板符号 */
    if (e.armor > 0) {
      ctx.strokeStyle = 'rgba(200,180,255,.6)';
      ctx.lineWidth = 1.2;
      for (var a2 = 0; a2 < 2; a2++) {
        ctx.beginPath();
        ctx.arc(0, 0, r * (1.02 + a2 * 0.1), -0.85, 0.85);
        ctx.stroke();
      }
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ---------- 机体绘制工具 ---------- */
  function steel(ctx, r, light) {
    var g = gradL('steel' + r + '_' + (light ? 1 : 0), -r, -r, r, r, [
      [0, light ? '#4a5763' : '#3a4550'],
      [0.4, light ? '#333e49' : '#242d36'],
      [1, light ? '#1d252d' : '#141a20']
    ]);
    if (light) {
      g.addColorStop(0, '#4a5763');
      g.addColorStop(0.4, '#333e49');
      g.addColorStop(1, '#1d252d');
    } else {
      g.addColorStop(0, '#39434e');
      g.addColorStop(0.42, '#262f38');
      g.addColorStop(1, '#151c23');
    }
    return g;
  }

  /* 面板分割线 */
  function panelLines(ctx, r, n, phase) {
    ctx.strokeStyle = 'rgba(0,0,0,.52)';
    ctx.lineWidth = Math.max(0.8, r * 0.07);
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var a = phase + i * Math.PI / n;
      ctx.moveTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42);
      ctx.lineTo(Math.cos(a) * r * 0.94, Math.sin(a) * r * 0.94);
    }
    ctx.stroke();
  }

  /* 铆钉 */
  function rivets(ctx, r, n, rr, rad, col) {
    ctx.fillStyle = col || 'rgba(190,215,240,.4)';
    for (var i = 0; i < n; i++) {
      var a = i * U.TAU / n + 0.4;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rad, Math.sin(a) * rad, Math.max(0.7, r * 0.07), 0, U.TAU);
      ctx.fill();
    }
  }

  /* 发光目镜 / 传感器 */
  function visor(ctx, x, y, r, col, t, speed) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var puls = 0.65 + 0.35 * Math.sin(t * speed);
    var g = gradR('visor_' + col + '_' + (r | 0), 0, 0, 0, 0, 0, r, [
      [0, '#ffffff'],
      [0.35, col],
      [1, U.rgba(col, 0)]
    ]);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, U.TAU); ctx.fill();
    ctx.restore();
    ctx.restore();
    void puls;
  }

  /* ---------- 各兵种机体 ---------- */
  function drawMech(ctx, e, r, t) {
    var col = e.color;
    switch (e.shape) {
      case 'hex': {
        /* 步兵：双足侦察机 */
        var stride = Math.sin(e.bob) * r * 0.26;
        /* 腿 */
        ctx.strokeStyle = '#222b34'; ctx.lineWidth = Math.max(1.6, r * 0.20);
        ctx.beginPath();
        ctx.moveTo(-r * 0.1, r * 0.16); ctx.lineTo(-r * 0.1 + stride * 0.6, r * 0.86);
        ctx.moveTo(r * 0.24, r * 0.16); ctx.lineTo(r * 0.24 - stride * 0.6, r * 0.86);
        ctx.stroke();
        /* 躯干：切角装甲箱 */
        ctx.beginPath();
        ctx.moveTo(r * 0.92, -r * 0.12);
        ctx.lineTo(r * 0.30, -r * 0.68);
        ctx.lineTo(-r * 0.56, -r * 0.56);
        ctx.lineTo(-r * 0.78, r * 0.06);
        ctx.lineTo(-r * 0.30, r * 0.52);
        ctx.lineTo(r * 0.40, r * 0.46);
        ctx.closePath();
        ctx.fillStyle = steel(ctx, r, false); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.92); ctx.lineWidth = Math.max(1.3, r * 0.13); ctx.stroke();
        panelLines(ctx, r, 3, 0.3);
        rivets(ctx, r, 4, r * 0.62, r * 0.60, 'rgba(190,215,240,.35)');
        /* 肩部小炮 */
        ctx.fillStyle = '#1b242c';
        ctx.fillRect(-r * 0.10, -r * 0.86, r * 0.62, r * 0.24);
        ctx.strokeStyle = U.rgba(col, 0.7); ctx.lineWidth = 1; ctx.strokeRect(-r * 0.10, -r * 0.86, r * 0.62, r * 0.24);
        visor(ctx, r * 0.60, -r * 0.10, r * 0.28, col, t, 6);
        break;
      }

      case 'tri': {
        /* 疾行者：轻型楔形截击机 */
        /* 尾翼 */
        ctx.fillStyle = '#232c35';
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, 0);
        ctx.lineTo(-r * 1.0, -r * 0.52);
        ctx.lineTo(-r * 0.86, 0);
        ctx.lineTo(-r * 1.0, r * 0.52);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.6); ctx.lineWidth = 1; ctx.stroke();
        /* 楔形机身 */
        ctx.beginPath();
        ctx.moveTo(r * 1.05, 0);
        ctx.lineTo(r * 0.12, -r * 0.62);
        ctx.lineTo(-r * 0.62, -r * 0.34);
        ctx.lineTo(-r * 0.62, r * 0.34);
        ctx.lineTo(r * 0.12, r * 0.62);
        ctx.closePath();
        ctx.fillStyle = steel(ctx, r, true); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.95); ctx.lineWidth = Math.max(1.2, r * 0.14); ctx.stroke();
        /* 速度线 */
        ctx.strokeStyle = U.rgba(col, 0.4); ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-r * 0.4, -r * 0.18); ctx.lineTo(r * 0.35, -r * 0.26);
        ctx.moveTo(-r * 0.4, r * 0.18); ctx.lineTo(r * 0.35, r * 0.26);
        ctx.stroke();
        visor(ctx, r * 0.66, 0, r * 0.24, col, t, 11);
        break;
      }

      case 'dot': {
        /* 蜂群：球形无人机 */
        ctx.fillStyle = '#20282f';
        ctx.beginPath(); ctx.arc(0, 0, r, 0, U.TAU); ctx.fill();
        var sg = gradR('en_sg_' + e.type, -r * 0.3, -r * 0.3, 0, 0, 0, r, [
          [0, U.rgba(col, 0.55)],
          [0.7, U.rgba(col, 0.12)],
          [1, 'rgba(20,28,35,0)']
        ]);
        ctx.fillStyle = sg;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, U.TAU); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.9); ctx.lineWidth = Math.max(1.1, r * 0.22); ctx.stroke();
        /* 三片旋翼 */
        ctx.strokeStyle = 'rgba(160,200,235,.5)';
        ctx.lineWidth = Math.max(0.9, r * 0.14);
        for (var p = 0; p < 3; p++) {
          var pa = t * 7 + p * U.TAU / 3;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(pa) * r * 1.34, Math.sin(pa) * r * 1.34);
          ctx.stroke();
        }
        visor(ctx, 0, 0, r * 0.5, col, t, 14);
        break;
      }

      case 'sq': {
        /* 重装兵：四足突击车 */
        var st2 = Math.sin(e.bob) * r * 0.18;
        /* 四条粗腿 */
        ctx.strokeStyle = '#1a222a'; ctx.lineWidth = Math.max(2, r * 0.24);
        var lp = [[0.5, 0.5, 1], [0.5, -0.5, -1], [-0.5, 0.5, 1], [-0.5, -0.5, -1]];
        for (var l = 0; l < 4; l++) {
          var lx = lp[l][0] * r * 0.72, ly = lp[l][1] * r * 0.62;
          ctx.beginPath();
          ctx.moveTo(lx * 0.6, ly * 0.6);
          ctx.lineTo(lx + st2 * lp[l][2], ly + r * 0.44);
          ctx.stroke();
        }
        /* 主装甲体 */
        roundRect(ctx, -r * 0.94, -r * 0.72, r * 1.9, r * 1.44, r * 0.26);
        ctx.fillStyle = steel(ctx, r, false); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.95); ctx.lineWidth = Math.max(1.5, r * 0.15); ctx.stroke();
        /* 附加装甲板 */
        ctx.fillStyle = '#1e262e';
        roundRect(ctx, -r * 0.72, -r * 0.90, r * 0.86, r * 0.30, r * 0.10);
        ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.55); ctx.lineWidth = 1; ctx.stroke();
        panelLines(ctx, r, 4, 0.4);
        rivets(ctx, r, 6, r * 0.72, r * 0.70, 'rgba(190,215,240,.38)');
        /* 主炮 */
        ctx.fillStyle = '#141b22';
        roundRect(ctx, r * 0.40, -r * 0.16, r * 0.80, r * 0.32, r * 0.08);
        ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.8); ctx.lineWidth = 1.2; ctx.stroke();
        visor(ctx, r * 0.52, 0, r * 0.26, col, t, 4.5);
        break;
      }

      case 'dia': {
        /* 幻影：悬浮隐形机 */
        ctx.save();
        /* 悬浮环 */
        ctx.strokeStyle = U.rgba(col, 0.5);
        ctx.lineWidth = Math.max(1.2, r * 0.14);
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.18, r * 0.42, 0, 0, U.TAU); ctx.stroke();
        ctx.strokeStyle = U.rgba(col, 0.25);
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.34, r * 0.54, 0, 0, U.TAU); ctx.stroke();
        ctx.restore();
        /* 菱形主体 */
        ctx.beginPath();
        ctx.moveTo(r * 1.14, 0);
        ctx.lineTo(0, -r * 0.62);
        ctx.lineTo(-r * 1.0, 0);
        ctx.lineTo(0, r * 0.62);
        ctx.closePath();
        ctx.fillStyle = steel(ctx, r, true); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.95); ctx.lineWidth = Math.max(1.3, r * 0.14); ctx.stroke();
        /* 内部分割 */
        ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = Math.max(0.8, r * 0.08);
        ctx.beginPath();
        ctx.moveTo(-r * 0.7, 0); ctx.lineTo(r * 0.7, 0);
        ctx.stroke();
        visor(ctx, r * 0.42, 0, r * 0.34, col, t, 9);
        break;
      }

      case 'wing': {
        /* 工蜂无人机：三角翼 + 双旋翼 */
        var flap = Math.sin(t * 26 + e.bob) * 0.5;
        ctx.strokeStyle = 'rgba(160,205,240,.4)';
        ctx.lineWidth = Math.max(1, r * 0.12);
        ctx.beginPath();
        ctx.moveTo(-r * 0.3, -r * 0.9 - flap * r * 0.2);
        ctx.lineTo(-r * 0.3, r * 0.9 + flap * r * 0.2);
        ctx.stroke();
        /* 机身 */
        ctx.beginPath();
        ctx.moveTo(r * 1.06, 0);
        ctx.lineTo(r * 0.10, -r * 0.50);
        ctx.lineTo(-r * 0.78, -r * 0.26);
        ctx.lineTo(-r * 0.78, r * 0.26);
        ctx.lineTo(r * 0.10, r * 0.50);
        ctx.closePath();
        ctx.fillStyle = steel(ctx, r, true); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.95); ctx.lineWidth = Math.max(1.2, r * 0.14); ctx.stroke();
        /* 旋翼叶 */
        ctx.strokeStyle = U.rgba(col, 0.55); ctx.lineWidth = Math.max(1, r * 0.16);
        for (var w2 = 0; w2 < 2; w2++) {
          var wy = (w2 === 0 ? -1 : 1) * r * 0.62;
          ctx.beginPath();
          ctx.moveTo(-r * 0.2, wy - flap * r * 0.24);
          ctx.lineTo(r * 0.5, wy - flap * r * 0.24);
          ctx.stroke();
        }
        visor(ctx, r * 0.58, 0, r * 0.24, col, t, 13);
        break;
      }

      case 'breach': {
        /* 破门突袭兵：楔形破门锤 + 双腿冲刺骨架 */
        var bph = Math.sin(t * 11 + e.bob) * 2.2;
        ctx.save();
        ctx.translate(0, bph * 0.3);
        /* 冲刺腿 */
        ctx.strokeStyle = '#3a1a22'; ctx.lineWidth = r * 0.16; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-r * 0.28, r * 0.10); ctx.lineTo(-r * 0.52 + bph * 0.4, r * 0.62);
        ctx.moveTo(r * 0.28, r * 0.10); ctx.lineTo(r * 0.52 - bph * 0.4, r * 0.62);
        ctx.stroke();
        /* 机体 */
        metalBody(ctx, -r * 0.40, -r * 0.34, r * 0.80, r * 0.62, r * 0.16, '#5a1e2a', '#3a121c', '#1a080c');
        /* 楔形锤头（前倾） */
        ctx.save();
        ctx.translate(r * 0.40, 0); ctx.rotate(0.22);
        ctx.fillStyle = '#c8ccd4';
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.26); ctx.lineTo(r * 0.56, 0);
        ctx.lineTo(0, r * 0.26); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.8); ctx.lineWidth = 1.6; ctx.stroke();
        ctx.restore();
        /* 核心 */
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        glowAt(ctx, -r * 0.10, 0, r * 0.22, col, 0.4 + 0.3 * Math.abs(Math.sin(t * 7 + e.bob)));
        ctx.restore();
        ctx.restore();
        break;
      }

      case 'sapper': {
        /* 工兵爆破者：背负炸药罐 + 燃烧引信 */
        ctx.strokeStyle = '#2e3a1a'; ctx.lineWidth = r * 0.13; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-r * 0.22, r * 0.16); ctx.lineTo(-r * 0.40, r * 0.66);
        ctx.moveTo(r * 0.22, r * 0.16); ctx.lineTo(r * 0.40, r * 0.66);
        ctx.stroke();
        /* 炸药罐（3 个） */
        for (var sb = 0; sb < 3; sb++) {
          ctx.fillStyle = '#3d4a22';
          roundRect(ctx, -r * 0.34 + sb * r * 0.26, -r * 0.62, r * 0.20, r * 0.44, r * 0.08);
          ctx.fill();
          ctx.strokeStyle = 'rgba(220,240,180,.30)'; ctx.lineWidth = 1; ctx.stroke();
        }
        metalBody(ctx, -r * 0.34, -r * 0.24, r * 0.68, r * 0.46, r * 0.14, '#4a5222', '#2e3418', '#14180a');
        /* 引信火花 */
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        glowAt(ctx, 0, -r * 0.70, r * 0.18, '#ffcf3c', 0.5 + 0.4 * Math.abs(Math.sin(t * 14 + e.bob)));
        ctx.restore();
        break;
      }

      case 'droner': {
        /* 渗透者：半透明相位躯体 + 残影拖尾 */
        ctx.save();
        ctx.globalAlpha = 0.78;
        /* 拖尾残影 */
        for (var dr = 3; dr >= 1; dr--) {
          ctx.globalAlpha = 0.13 * dr;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.ellipse(-dr * 5, -dr * 2, r * (0.62 - dr * 0.06), r * (0.42 - dr * 0.04), e.rot * 0.3, 0, U.TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 0.82;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.62); ctx.lineTo(r * 0.50, 0);
        ctx.lineTo(0, r * 0.62); ctx.lineTo(-r * 0.50, 0);
        ctx.closePath();
        ctx.fillStyle = 'rgba(60,40,90,.85)'; ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.9); ctx.lineWidth = 1.8; ctx.stroke();
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        glowAt(ctx, 0, 0, r * 0.26, col, 0.45 + 0.3 * Math.sin(t * 6 + e.bob));
        ctx.restore();
        ctx.restore();
        break;
      }

      case 'lance': {
        /* 突击炮车：履带 + 炮塔 */
        /* 履带 */
        var lt = (e.dist * 0.28) % 12;
        ctx.fillStyle = '#151b21';
        roundRect(ctx, -r * 0.94, -r * 0.78, r * 1.88, r * 0.42, r * 0.14);
        ctx.fill();
        roundRect(ctx, -r * 0.94, r * 0.36, r * 1.88, r * 0.42, r * 0.14);
        ctx.fill();
        ctx.strokeStyle = 'rgba(140,180,215,.35)'; ctx.lineWidth = Math.max(1, r * 0.08);
        ctx.beginPath();
        for (var ti = 0; ti < 6; ti++) {
          var txx = -r * 0.86 + ((lt + ti * 3) % 12) * 0.9;
          ctx.moveTo(txx, -r * 0.76); ctx.lineTo(txx, -r * 0.38);
          ctx.moveTo(txx, r * 0.38); ctx.lineTo(txx, r * 0.76);
        }
        ctx.stroke();
        /* 车体 */
        roundRect(ctx, -r * 0.86, -r * 0.44, r * 1.72, r * 0.88, r * 0.16);
        ctx.fillStyle = steel(ctx, r, false); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.95); ctx.lineWidth = Math.max(1.4, r * 0.15); ctx.stroke();
        /* 炮塔 + 炮管 */
        ctx.fillStyle = '#1d252d';
        roundRect(ctx, -r * 0.42, -r * 0.30, r * 0.80, r * 0.60, r * 0.14);
        ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.7); ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#161d24';
        roundRect(ctx, r * 0.20, -r * 0.11, r * 0.92, r * 0.22, r * 0.06);
        ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.8); ctx.lineWidth = 1.1; ctx.stroke();
        visor(ctx, -r * 0.16, 0, r * 0.22, col, t, 6.5);
        break;
      }

      case 'ward': {
        /* 护盾卫：能量护盾发生器（护盾泡已在 drawEnemy 统一绘制） */
        /* 本体 */
        roundRect(ctx, -r * 0.66, -r * 0.72, r * 1.32, r * 1.44, r * 0.24);
        ctx.fillStyle = steel(ctx, r, true); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.9); ctx.lineWidth = Math.max(1.4, r * 0.16); ctx.stroke();
        panelLines(ctx, r, 4, 0.3);
        rivets(ctx, r, 4, r * 0.52, r * 0.50, 'rgba(190,215,240,.42)');
        /* 发射器 */
        ctx.fillStyle = '#1a222a';
        ctx.beginPath();
        ctx.moveTo(r * 0.40, -r * 0.22);
        ctx.lineTo(r * 0.86, -r * 0.14);
        ctx.lineTo(r * 0.86, r * 0.14);
        ctx.lineTo(r * 0.40, r * 0.22);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.75); ctx.lineWidth = 1.1; ctx.stroke();
        visor(ctx, r * 0.05, 0, r * 0.30, col, t, 4);
        break;
      }

      case 'mender': {
        /* 维修单元：十字 + 机械臂 */
        /* 机械臂 */
        ctx.strokeStyle = '#2a343d'; ctx.lineWidth = Math.max(1.6, r * 0.18);
        for (var ar = 0; ar < 2; ar++) {
          var aa = ar * Math.PI;
          var aa2 = aa + Math.sin(t * 2.6 + e.bob + ar) * 0.35;
          ctx.beginPath();
          ctx.moveTo(Math.cos(aa) * r * 0.3, Math.sin(aa) * r * 0.3);
          ctx.lineTo(Math.cos(aa2) * r * 0.9, Math.sin(aa2) * r * 0.9);
          ctx.stroke();
        }
        /* 主体 */
        roundRect(ctx, -r * 0.68, -r * 0.68, r * 1.36, r * 1.36, r * 0.28);
        ctx.fillStyle = steel(ctx, r, false); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.95); ctx.lineWidth = Math.max(1.4, r * 0.15); ctx.stroke();
        /* 医疗十字 */
        ctx.fillStyle = U.rgba(col, 0.9);
        ctx.shadowColor = col; ctx.shadowBlur = 8;
        ctx.fillRect(-r * 0.13, -r * 0.48, r * 0.26, r * 0.96);
        ctx.fillRect(-r * 0.48, -r * 0.13, r * 0.96, r * 0.26);
        ctx.shadowBlur = 0;
        rivets(ctx, r, 4, r * 0.54, r * 0.52, 'rgba(190,215,240,.4)');
        visor(ctx, 0, 0, r * 0.30, '#ffffff', t, 7);
        break;
      }

      case 'jam': {
        /* 干扰者：发射塔 + 电离环 */
        ctx.strokeStyle = 'rgba(176,106,224,.35)';
        ctx.lineWidth = Math.max(1, r * 0.10);
        for (var jr2 = 0; jr2 < 2; jr2++) {
          var jrr = r * (0.85 + jr2 * 0.24);
          var ja = t * (1.6 + jr2 * 0.9);
          ctx.beginPath();
          ctx.ellipse(0, 0, jrr, jrr * 0.42, 0, ja, ja + 2.4);
          ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(0, 0, jrr, jrr * 0.42, 0, ja + Math.PI, ja + Math.PI + 2.4);
          ctx.stroke();
        }
        /* 塔身 */
        ctx.fillStyle = '#241a2e';
        roundRect(ctx, -r * 0.40, -r * 0.66, r * 0.80, r * 1.32, r * 0.16);
        ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.95); ctx.lineWidth = Math.max(1.3, r * 0.15); ctx.stroke();
        /* 天线 */
        ctx.strokeStyle = U.rgba(col, 0.85); ctx.lineWidth = Math.max(1.2, r * 0.12);
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.66); ctx.lineTo(0, -r * 1.04);
        ctx.stroke();
        visor(ctx, 0, -r * 1.04, r * 0.26, col, t, 10);
        /* 侧翼 */
        ctx.fillStyle = '#1c1424';
        ctx.fillRect(-r * 0.72, -r * 0.18, r * 0.34, r * 0.36);
        ctx.fillRect(r * 0.38, -r * 0.18, r * 0.34, r * 0.36);
        visor(ctx, 0, r * 0.18, r * 0.26, '#ffffff', t, 8);
        break;
      }

      case 'jugg': {
        /* 重装泰坦：双履带 + 巨型装甲塔 */
        var jt = (e.dist * 0.22) % 14;
        /* 履带组 */
        ctx.fillStyle = '#12181e';
        for (var tr2 = 0; tr2 < 2; tr2++) {
          var ty2 = (tr2 === 0 ? -1 : 1) * r * 0.62;
          roundRect(ctx, -r * 0.96, ty2 - r * 0.20, r * 1.92, r * 0.40, r * 0.12);
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(150,190,225,.34)'; ctx.lineWidth = Math.max(1, r * 0.07);
        ctx.beginPath();
        for (var tj = 0; tj < 8; tj++) {
          var tjx = -r * 0.88 + ((jt + tj * 3.6) % 14) * 1.05;
          ctx.moveTo(tjx, -r * 0.80); ctx.lineTo(tjx, -r * 0.46);
          ctx.moveTo(tjx, r * 0.46); ctx.lineTo(tjx, r * 0.80);
        }
        ctx.stroke();
        /* 底盘 */
        roundRect(ctx, -r * 0.92, -r * 0.56, r * 1.84, r * 1.12, r * 0.18);
        ctx.fillStyle = steel(ctx, r, false); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.85); ctx.lineWidth = Math.max(1.5, r * 0.11); ctx.stroke();
        /* 炮塔 */
        ctx.beginPath();
        ctx.moveTo(r * 0.80, -r * 0.36);
        ctx.lineTo(r * 0.52, -r * 0.52);
        ctx.lineTo(-r * 0.52, -r * 0.52);
        ctx.lineTo(-r * 0.72, -r * 0.22);
        ctx.lineTo(-r * 0.72, r * 0.30);
        ctx.lineTo(r * 0.72, r * 0.30);
        ctx.lineTo(r * 0.80, -r * 0.36);
        ctx.closePath();
        ctx.fillStyle = steel(ctx, r, true); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.95); ctx.lineWidth = Math.max(1.6, r * 0.13); ctx.stroke();
        panelLines(ctx, r, 5, 0.2);
        rivets(ctx, r, 6, r * 0.56, r * 0.54, 'rgba(200,225,245,.4)');
        /* 双联炮 */
        for (var gz = 0; gz < 2; gz++) {
          var gy = (gz === 0 ? -1 : 1) * r * 0.17;
          ctx.fillStyle = '#161d24';
          roundRect(ctx, r * 0.5, gy - r * 0.07, r * 0.62, r * 0.14, r * 0.04);
          ctx.fill();
          ctx.strokeStyle = U.rgba(col, 0.7); ctx.lineWidth = 0.9; ctx.stroke();
        }
        visor(ctx, r * 0.24, r * 0.02, r * 0.22, '#ff6a3d', t, 5);
        break;
      }

      case 'saber': {
        /* 破袭者：双足突击机甲 + 右臂热能爪 */
        var stride = Math.sin(e.bob) * r * 0.22;
        /* 腿 */
        ctx.strokeStyle = '#1e262e'; ctx.lineWidth = Math.max(1.8, r * 0.19);
        ctx.beginPath();
        ctx.moveTo(-r * 0.10, r * 0.20); ctx.lineTo(-r * 0.10 + stride * 0.7, r * 0.90);
        ctx.moveTo(r * 0.26, r * 0.20); ctx.lineTo(r * 0.26 - stride * 0.7, r * 0.90);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(170,215,245,.28)'; ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(-r * 0.10, r * 0.20); ctx.lineTo(-r * 0.10 + stride * 0.7, r * 0.90);
        ctx.moveTo(r * 0.26, r * 0.20); ctx.lineTo(r * 0.26 - stride * 0.7, r * 0.90);
        ctx.stroke();
        /* 躯干 */
        roundRect(ctx, -r * 0.52, -r * 0.46, r * 1.14, r * 0.78, r * 0.16);
        var sg5 = gradL('en_sg5_' + e.type, -r * 0.5, -r * 0.46, r * 0.6, r * 0.32, [
          [0, '#4d5a66'], [0.45, '#2f3944'], [1, '#161d24']]);
        ctx.fillStyle = sg5;
        ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.92); ctx.lineWidth = Math.max(1.3, r * 0.14); ctx.stroke();
        panelLines(ctx, r, 3, 0.35);
        rivets(ctx, r, 4, r * 0.42, r * 0.40, 'rgba(200,230,255,.40)');
        /* 左臂护盾 */
        ctx.fillStyle = '#232c34';
        roundRect(ctx, -r * 0.86, -r * 0.20, r * 0.34, r * 0.40, r * 0.08);
        ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.6); ctx.lineWidth = 1; ctx.stroke();
        /* 右臂热能爪（攻击时前刺） */
        var wind = (e.atkWind || 0);
        ctx.save();
        ctx.translate(r * 0.44, r * 0.02);
        ctx.rotate(wind > 0 ? -0.5 * wind : 0);
        ctx.fillStyle = '#3a2519';
        roundRect(ctx, 0, -r * 0.14, r * 0.56, r * 0.28, r * 0.06);
        ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.85); ctx.lineWidth = 1.1; ctx.stroke();
        /* 爪刃 */
        ctx.fillStyle = '#ffd0a8';
        ctx.beginPath();
        ctx.moveTo(r * 0.50, -r * 0.14);
        ctx.lineTo(r * 0.86, 0);
        ctx.lineTo(r * 0.50, r * 0.14);
        ctx.closePath();
        ctx.fill();
        /* 爪刃高热光 */
        if (wind > 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = U.rgba(col, wind * 0.9);
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(r * 0.52, 0); ctx.lineTo(r * 0.90, (Math.random() - 0.5) * r * 0.2);
          ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
        /* 头部目镜 */
        ctx.fillStyle = '#131a20';
        roundRect(ctx, r * 0.24, -r * 0.40, r * 0.42, r * 0.24, r * 0.05);
        ctx.fill();
        visor(ctx, r * 0.44, -r * 0.28, r * 0.20, col, t, 8);
        break;
      }

      case 'ripper': {
        /* 裂装机兵：四足重型 + 双联锯轮 */
        var stp = Math.sin(e.bob) * r * 0.14;
        /* 四足 */
        ctx.strokeStyle = '#171e25'; ctx.lineWidth = Math.max(2, r * 0.20);
        var legs = [[0.42, 0.42, 1], [0.42, -0.42, -1], [-0.42, 0.42, 1], [-0.42, -0.42, -1]];
        for (var lg = 0; lg < 4; lg++) {
          var lx = legs[lg][0] * r, ly = legs[lg][1] * r;
          ctx.beginPath();
          ctx.moveTo(lx * 0.55, ly * 0.55);
          ctx.lineTo(lx + stp * legs[lg][2], ly + r * 0.46);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(160,200,235,.22)'; ctx.lineWidth = 1;
        for (var lg2 = 0; lg2 < 4; lg2++) {
          var lx2 = legs[lg2][0] * r, ly2 = legs[lg2][1] * r;
          ctx.beginPath();
          ctx.moveTo(lx2 * 0.55, ly2 * 0.55);
          ctx.lineTo(lx2 + stp * legs[lg2][2], ly2 + r * 0.46);
          ctx.stroke();
        }
        /* 车体 */
        roundRect(ctx, -r * 0.80, -r * 0.56, r * 1.60, r * 1.12, r * 0.20);
        var rg5 = gradL('en_rg5_' + e.type, -r * 0.8, -r * 0.56, r * 0.8, r * 0.56, [
          [0, '#4a2630'], [0.45, '#2e1a20'], [1, '#150c10']]);
        ctx.fillStyle = rg5;
        ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.92); ctx.lineWidth = Math.max(1.4, r * 0.13); ctx.stroke();
        panelLines(ctx, r, 4, 0.25);
        rivets(ctx, r, 6, r * 0.62, r * 0.60, 'rgba(220,200,210,.40)');
        /* 前置双联锯轮 */
        for (var bz = 0; bz < 2; bz++) {
          var bzy = (bz === 0 ? -1 : 1) * r * 0.26;
          ctx.save();
          ctx.translate(r * 0.78, bzy);
          ctx.rotate(t * 9 + e.bob);
          /* 锯轮 */
          ctx.fillStyle = '#5a6672';
          ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, U.TAU); ctx.fill();
          ctx.strokeStyle = U.rgba(col, 0.9); ctx.lineWidth = 1.4; ctx.stroke();
          /* 锯齿 */
          ctx.strokeStyle = '#d8e0e8'; ctx.lineWidth = Math.max(1, r * 0.07);
          ctx.beginPath();
          for (var th = 0; th < 8; th++) {
            var ta = th * U.TAU / 8;
            ctx.moveTo(Math.cos(ta) * r * 0.20, Math.sin(ta) * r * 0.20);
            ctx.lineTo(Math.cos(ta) * r * 0.32, Math.sin(ta) * r * 0.32);
          }
          ctx.stroke();
          /* 锯轮高热 */
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          var bsp = NB.FX.glowSprite(col, r * 0.30);
          var bsw = r * 0.60 * (0.7 + 0.3 * Math.abs(Math.sin(t * 8 + bz)));
          ctx.globalAlpha = 0.35;
          ctx.drawImage(bsp, -bsw / 2, -bsw / 2, bsw, bsw);
          ctx.restore();
          ctx.restore();
        }
        /* 驾驶舱 */
        ctx.fillStyle = '#0e1218';
        roundRect(ctx, -r * 0.24, -r * 0.26, r * 0.50, r * 0.52, r * 0.10);
        ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.7); ctx.lineWidth = 1.1; ctx.stroke();
        visor(ctx, r * 0.02, 0, r * 0.22, '#ff6a3d', t, 5);
        break;
      }

      case 'boss': {
        /* 霸主：巨型泰坦 */
        var bs = Math.sin(e.bob * 0.5) * r * 0.20;
        /* 巨腿 */
        ctx.strokeStyle = '#141b22'; ctx.lineWidth = Math.max(4, r * 0.20);
        ctx.beginPath();
        ctx.moveTo(-r * 0.34, r * 0.20); ctx.lineTo(-r * 0.40 + bs, r * 0.98);
        ctx.moveTo(r * 0.36, r * 0.20); ctx.lineTo(r * 0.40 - bs, r * 0.98);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(160,200,235,.28)'; ctx.lineWidth = Math.max(1.4, r * 0.07);
        ctx.beginPath();
        ctx.moveTo(-r * 0.34, r * 0.20); ctx.lineTo(-r * 0.40 + bs, r * 0.98);
        ctx.moveTo(r * 0.36, r * 0.20); ctx.lineTo(r * 0.40 - bs, r * 0.98);
        ctx.stroke();
        /* 肩部武器舱 */
        ctx.fillStyle = '#1a222a';
        roundRect(ctx, -r * 1.02, -r * 0.86, r * 0.52, r * 0.62, r * 0.12);
        ctx.fill();
        roundRect(ctx, r * 0.50, -r * 0.86, r * 0.52, r * 0.62, r * 0.12);
        ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.7); ctx.lineWidth = 1.4;
        ctx.strokeRect(-r * 1.02, -r * 0.86, r * 0.52, r * 0.62);
        ctx.strokeRect(r * 0.50, -r * 0.86, r * 0.52, r * 0.62);
        /* 主躯干 */
        ctx.beginPath();
        ctx.moveTo(r * 0.92, -r * 0.28);
        ctx.lineTo(r * 0.60, -r * 0.72);
        ctx.lineTo(-r * 0.60, -r * 0.72);
        ctx.lineTo(-r * 0.92, -r * 0.28);
        ctx.lineTo(-r * 0.74, r * 0.52);
        ctx.lineTo(r * 0.74, r * 0.52);
        ctx.closePath();
        ctx.fillStyle = steel(ctx, r, true); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 1); ctx.lineWidth = Math.max(2, r * 0.10);
        ctx.stroke();
        panelLines(ctx, r, 6, 0.2);
        rivets(ctx, r, 8, r * 0.66, r * 0.68, 'rgba(200,225,248,.42)');
        /* 胸口反应炉 */
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        var bg2 = gradR('en_bg2_' + e.type, 0, r * 0.08, 0, 0, r * 0.08, r * 0.52, [
          [0, '#ffffff'],
          [0.32, col],
          [1, U.rgba(col, 0)]
        ]);
        ctx.fillStyle = bg2;
        ctx.beginPath(); ctx.arc(0, r * 0.08, r * 0.52, 0, U.TAU); ctx.fill();
        ctx.restore();
        /* 头部目镜 */
        ctx.fillStyle = '#0e141a';
        roundRect(ctx, r * 0.52, -r * 0.46, r * 0.44, r * 0.24, r * 0.06);
        ctx.fill();
        visor(ctx, r * 0.74, -r * 0.34, r * 0.30, '#ff3b47', t, 3);
        /* 肩炮炮口 */
        visor(ctx, -r * 0.76, -r * 0.55, r * 0.20, '#ffd23d', t, 5);
        visor(ctx, r * 0.76, -r * 0.55, r * 0.20, '#ffd23d', t, 5);
        break;
      }
      default: {
        /* 未知敌人造型的可见占位：菱形 + 目镜。
           新敌人如果忘了在 ENEMY_ORDER / 配置里补 shape，
           这里至少会画出一个带阵营色的可见单位，
           而不是「敌人明明在掉血、屏幕上却什么都没有」。 */
        ctx.fillStyle = '#20282f';
        ctx.beginPath();
        ctx.moveTo(0, -r); ctx.lineTo(r * 0.82, 0);
        ctx.lineTo(0, r); ctx.lineTo(-r * 0.82, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.9);
        ctx.lineWidth = Math.max(1.2, r * 0.16);
        ctx.stroke();
        visor(ctx, r * 0.22, 0, r * 0.30, col, t, 9);
        break;
      }
    }
  }

  /* ============================================================
     射程圈 / 建造预览
     ============================================================ */
  /* 全图射程判定：轨道轰炸平台的 range 大于地图对角线，
     这种塔不能画射程圆（会溢出屏幕、把整个战场染成一片），
     改为高亮整张战场的虚线边框。 */
  var MAP_DIAG = Math.sqrt(W * W + H * H);
  function isFullMapRange(r) { return r >= MAP_DIAG; }

  function drawRange(ctx, G, x, y, r, color, fillA) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (isFullMapRange(r)) {
      ctx.strokeStyle = U.rgba(color, fillA * 2.1);
      ctx.lineWidth = 1.6;
      ctx.setLineDash([9, 9]);
      ctx.lineDashOffset = -G.time * 26;
      ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }
    var g = gradR('rng_' + color + (fillA * 40 | 0), 0, 0, r * 0.55, 0, 0, r, [
      [0, U.rgba(color, 0)],
      [0.82, U.rgba(color, fillA * 0.55)],
      [1, U.rgba(color, 0)]
    ]);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, U.TAU); ctx.fill();
    ctx.restore();

    ctx.strokeStyle = U.rgba(color, fillA * 2.1);
    ctx.lineWidth = 1.4;
    ctx.setLineDash([7, 7]);
    ctx.lineDashOffset = -G.time * 26;
    ctx.beginPath(); ctx.arc(x, y, r, 0, U.TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* 射程边界刻度：每 45° 一个短刻线，强化"精确范围"读数 */
  /* ============================================================
     跑道可移动性标注 + 移动落点预览 + 丝滑交互动效
     ============================================================ */

  /* 预渲染：格线纹理（可移动 / 不可移动 两种） */
  var laneTex = { movable: null, blocked: null, air: null };
  function buildLaneTex(kind) {
    if (laneTex[kind]) return laneTex[kind];
    var S = Math.max(8, Math.round(C.CELL));
    var c = document.createElement('canvas');
    c.width = S; c.height = S;
    var g = c.getContext('2d');
    if (kind === 'movable') {
      /* 可移动（空中可落点）：青色斜向细纹 + 四角折角 */
      g.strokeStyle = 'rgba(120,220,255,.30)';
      g.lineWidth = 1.4;
      for (var i = -S; i < S * 2; i += 7) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke();
      }
      g.strokeStyle = 'rgba(168,216,255,.60)';
      g.lineWidth = 2;
      var m = 3.5, L = S * 0.26;
      var corners = [[m, m, 1, 1], [S - m, m, -1, 1], [m, S - m, 1, -1], [S - m, S - m, -1, -1]];
      for (var k = 0; k < 4; k++) {
        var q = corners[k];
        g.beginPath();
        g.moveTo(q[0] + q[2] * L, q[1]); g.lineTo(q[0], q[1]); g.lineTo(q[0], q[1] + q[3] * L);
        g.stroke();
      }
    } else if (kind === 'blocked') {
      /* 不可移动（地面不可占用）：红色交叉警示 */
      g.strokeStyle = 'rgba(255,110,120,.34)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(S * 0.30, S * 0.30); g.lineTo(S * 0.70, S * 0.70);
      g.moveTo(S * 0.70, S * 0.30); g.lineTo(S * 0.30, S * 0.70);
      g.stroke();
    } else {
      /* 跑道格：警告斜纹，表示「此处只有空中单位能过」 */
      g.strokeStyle = 'rgba(255,200,90,.22)';
      g.lineWidth = 2;
      for (var j = -S; j < S * 2; j += 10) {
        g.beginPath(); g.moveTo(j, S); g.lineTo(j + S, 0); g.stroke();
      }
    }
    laneTex[kind] = c;
    return c;
  }

  /* 选中可移动单位时：全图标注每个格子的可移动性 */
  function drawLaneMobility(ctx, G, tw, t) {
    var map = G.map;
    if (!map) return;
    var mv = buildLaneTex('movable');
    var bl = buildLaneTex('blocked');
    var lr = buildLaneTex('air');
    /* 只在悬停/移动意图时全图标注，避免常驻开销与视觉噪音 */
    var showAll = G.moveMode || (U.mouse.inside && U.mouse.cx >= 0);
    var ox = G.moveMode ? tw.gx : U.mouse.cx;
    var oy = G.moveMode ? tw.gy : U.mouse.cy;
    ctx.save();
    ctx.globalAlpha = G.moveMode ? 0.55 : 0.30;
    for (var gy = 0; gy < P.GH; gy++) {
      for (var gx = 0; gx < P.GW; gx++) {
        var bk = P.blockedAt(map, gx, gy);
        if (bk === 4) continue;                 /* 中继塔位不参与 */
        /* 只在鼠标附近一圈标注，避免整屏闪烁 */
        var near = Math.abs(gx - ox) <= 7 && Math.abs(gy - oy) <= 7;
        if (!near) continue;
        var x = gx * C.CELL, y = gy * C.CELL;
        var isLane = bk === 1;
        var canGo = tw.canMoveTo ? tw.canMoveTo(gx, gy) : false;
        var tex = canGo ? mv : bl;
        if (isLane && canGo) tex = lr;
        ctx.drawImage(tex, x, y, C.CELL, C.CELL);
      }
    }
    ctx.restore();
    void t;
  }

  /* 移动落点预览：落点框 + 十字准星 + 距离线 + 合法性反馈 */
  function drawMovePreview(ctx, G, tw, t) {
    var gx = U.mouse.cx, gy = U.mouse.cy;
    if (!P.inBounds(gx, gy)) return;
    var c = P.cellCenter(gx, gy);
    var ok = tw.canMoveTo ? tw.canMoveTo(gx, gy) : false;
    var pulse = 0.5 + 0.5 * Math.sin(t * 6.5);
    var col = ok ? '#a8e4ff' : '#ff6b7d';

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    /* 落点框：外框呼吸 + 内框实线 */
    ctx.strokeStyle = U.rgba(col, 0.55 + 0.4 * pulse);
    ctx.lineWidth = 2.6;
    ctx.strokeRect(c.x - C.CELL * 0.44, c.y - C.CELL * 0.44, C.CELL * 0.88, C.CELL * 0.88);
    ctx.strokeStyle = U.rgba(col, 0.9);
    ctx.lineWidth = 1.2;
    ctx.strokeRect(c.x - C.CELL * 0.30, c.y - C.CELL * 0.30, C.CELL * 0.60, C.CELL * 0.60);

    /* 十字准星 */
    ctx.strokeStyle = U.rgba(col, 0.75);
    ctx.lineWidth = 1.6;
    var q = C.CELL * 0.34, gap = C.CELL * 0.13;
    ctx.beginPath();
    ctx.moveTo(c.x - q, c.y); ctx.lineTo(c.x - gap, c.y);
    ctx.moveTo(c.x + gap, c.y); ctx.lineTo(c.x + q, c.y);
    ctx.moveTo(c.x, c.y - q); ctx.lineTo(c.x, c.y - gap);
    ctx.moveTo(c.x, c.y + gap); ctx.lineTo(c.x, c.y + q);
    ctx.stroke();

    /* 四角括号（科技感定位标记） */
    ctx.strokeStyle = U.rgba('#ffffff', 0.85);
    ctx.lineWidth = 2.4;
    var bl = C.CELL * 0.46, bs = C.CELL * 0.20;
    var cor = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (var i = 0; i < 4; i++) {
      var sx = cor[i][0], sy = cor[i][1];
      ctx.beginPath();
      ctx.moveTo(c.x + sx * bl, c.y + sy * (bl - bs));
      ctx.lineTo(c.x + sx * bl, c.y + sy * bl);
      ctx.lineTo(c.x + sx * (bl - bs), c.y + sy * bl);
      ctx.stroke();
    }

    /* 中心脉冲点 */
    glowAt(ctx, c.x, c.y, C.CELL * (0.30 + 0.10 * pulse), col, ok ? 0.45 : 0.28);

    /* 从塔到落点的引导线（虚线流动） */
    var dx = c.x - tw.x, dy = c.y - tw.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > C.CELL) {
      ctx.strokeStyle = U.rgba(col, 0.30);
      ctx.lineWidth = 1.4;
      ctx.setLineDash([6, 7]);
      ctx.lineDashOffset = -(t * 40) % 13;
      ctx.beginPath(); ctx.moveTo(tw.x, tw.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    /* 距离提示文字 */
    if (dist > C.CELL) {
      var mx = (tw.x + c.x) / 2, my = (tw.y + c.y) / 2;
      var txt = (dist / C.CELL).toFixed(1) + ' 格' + (ok ? '' : ' · 不可落点');
      ctx.save();
      ctx.font = '700 11px Consolas,monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = 'rgba(0,0,0,.85)';
      ctx.strokeText(txt, mx, my);
      ctx.fillStyle = U.rgba(col, 0.98);
      ctx.fillText(txt, mx, my);
      ctx.restore();
    }
  }

  /* 悬停反馈：柔和光环 + 上浮微光 */
  function drawHoverAura(ctx, tw, t) {
    var col = tw.def.color;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var a = 0.16 + 0.10 * Math.sin(t * 5.2);
    glowAt(ctx, tw.x, tw.y, C.CELL * 0.78, col, a);
    ctx.strokeStyle = U.rgba('#ffffff', a * 0.5);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(tw.x, tw.y, C.CELL * 0.60 + Math.sin(t * 3) * 1.4, 0, U.TAU);
    ctx.stroke();
    ctx.restore();
  }

  /* 移动中的尾迹：沿路径画渐隐光点 */
  function drawMoveTrail(ctx, tw, t) {
    if (!tw.flying || !tw.moving) return;
    var col = tw.def.color;
    var dx = tw.moveTX - tw.x, dy = tw.moveTY - tw.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / d, uy = dy / d;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var steps = 6;
    for (var i = 1; i <= steps; i++) {
      var f = i / (steps + 1);
      var px = tw.x + ux * d * f * 0.55;
      var py = tw.y + uy * d * f * 0.55 + Math.sin(t * 8 - i) * 1.6;
      glowAt(ctx, px, py, C.CELL * 0.16 * (1 - f * 0.5), col, 0.22 * (1 - f));
    }
    /* 落点呼吸环 */
    ctx.strokeStyle = U.rgba(col, 0.45 + 0.3 * Math.sin(t * 7));
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(tw.moveTX, tw.moveTY, C.CELL * 0.34, 0, U.TAU); ctx.stroke();
    ctx.restore();
  }

  /* 全图射程：用地图边框扫描光带表示「射程无限」，不画实心巨圈 */
  function drawGlobalRange(ctx, G, tw, t) {
    var col = tw.def.color;
    var pad = 3;
    var x0 = -pad, y0 = -pad, x1 = W + pad, y1 = H + pad;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = U.rgba(col, 0.16 + 0.10 * Math.sin(t * 2.6));
    ctx.lineWidth = 3;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    /* 四角强调括号 */
    var L = Math.min(W, H) * 0.10;
    ctx.strokeStyle = U.rgba(col, 0.55);
    ctx.lineWidth = 3.4;
    var cor = [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]];
    for (var i = 0; i < 4; i++) {
      var q = cor[i];
      ctx.beginPath();
      ctx.moveTo(q[0] + q[2] * L, q[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(q[0], q[1] + q[3] * L);
      ctx.stroke();
    }
    /* 沿边框流动的扫描光点 */
    var per = 2 * (x1 - x0 + y1 - y0);
    for (var k = 0; k < 4; k++) {
      var ph = ((t * 0.22 + k * 0.25) % 1) * per;
      var px, py;
      if (ph < x1 - x0) { px = x0 + ph; py = y0; }
      else if (ph < (x1 - x0) + (y1 - y0)) { px = x1; py = y0 + (ph - (x1 - x0)); }
      else if (ph < 2 * (x1 - x0) + (y1 - y0)) { px = x1 - (ph - (x1 - x0) - (y1 - y0)); py = y1; }
      else { px = x0; py = y1 - (ph - 2 * (x1 - x0) - (y1 - y0)); }
      glowAt(ctx, px, py, 26, col, 0.6);
    }
    ctx.restore();
    /* 全图覆盖文字 */
    ctx.save();
    ctx.font = '700 11px Consolas,monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.lineWidth = 3.4; ctx.strokeStyle = 'rgba(0,0,0,.85)';
    var tx = tw.x + 18, ty = tw.y - 8;
    ctx.strokeText('全图射程', tx, ty);
    ctx.fillStyle = U.rgba(col, 0.95);
    ctx.fillText('全图射程', tx, ty);
    ctx.restore();
  }

  function drawRangeTicks(ctx, tw, t) {
    var s = tw.stats();
    var r = s.range;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = U.rgba(tw.def.color, 0.55);
    ctx.lineWidth = 1.6;
    var txt;
    if (isFullMapRange(r)) {
      /* 全图射程：刻度改成战场四角标记，数值标签写「全图」 */
      ctx.beginPath();
      var cl = Math.min(W, H) * 0.06;
      var corners = [[0, 0], [W, 0], [W, H], [0, H]];
      for (var ci = 0; ci < 4; ci++) {
        var cx0 = corners[ci][0], cy0 = corners[ci][1];
        var sx0 = cx0 < W / 2 ? 1 : -1, sy0 = cy0 < H / 2 ? 1 : -1;
        ctx.moveTo(cx0, cy0); ctx.lineTo(cx0 + sx0 * cl, cy0);
        ctx.moveTo(cx0, cy0); ctx.lineTo(cx0, cy0 + sy0 * cl);
      }
      ctx.stroke();
      txt = '全图';
      var flx = tw.x, fly = tw.y - C.CELL * 0.9;
      ctx.font = '700 11px Consolas,monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.strokeText(txt, flx, fly);
      ctx.fillStyle = U.rgba(tw.def.color, 0.95);
      ctx.fillText(txt, flx, fly);
      ctx.restore();
      void t;
      return;
    }
    ctx.beginPath();
    for (var i = 0; i < 8; i++) {
      var a = i * U.TAU / 8 - tw.ang;
      var c = Math.cos(a), si = Math.sin(a);
      ctx.moveTo(tw.x + c * r, tw.y + si * r);
      ctx.lineTo(tw.x + c * (r + 5), tw.y + si * (r + 5));
    }
    ctx.stroke();
    /* 射程数值标签 */
    var lx = tw.x + Math.cos(-tw.ang - Math.PI / 2) * (r + 15);
    var ly = tw.y + Math.sin(-tw.ang - Math.PI / 2) * (r + 15);
    ctx.font = '700 10px Consolas,monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    txt = (r / C.CELL).toFixed(1) + ' 格';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.strokeText(txt, lx, ly);
    ctx.fillStyle = U.rgba(tw.def.color, 0.95);
    ctx.fillText(txt, lx, ly);
    ctx.restore();
    void t;
  }

  function drawBuildGhost(ctx, G) {
    var gx = U.mouse.cx, gy = U.mouse.cy;
    if (!P.inBounds(gx, gy)) return;
    var d = C.TOWERS[G.buildType];
    var st = P.blockedAt(G.map, gx, gy);
    var occupied = G.towerAt(gx, gy);
    var ok = st === 0 && !occupied && G.gold >= C.TOWER_COST[G.buildType];
    var col = ok ? d.color : '#ff3b47';
    var c = P.cellCenter(gx, gy);
    var r = C.CELL * 0.44;

    ctx.save();
    ctx.globalAlpha = 0.66;
    ctx.translate(c.x, c.y);
    /* 装甲底座幽灵 */
    octPath(ctx, r, -Math.PI / 8);
    var g2 = gradL('ghost_base', -r, -r, r, r, [
      [0, 'rgba(60,76,92,.85)'],
      [1, 'rgba(18,26,34,.85)']
    ]);
    ctx.fillStyle = g2;
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    /* 中心图标 */
    ctx.font = (C.CELL * 0.36).toFixed(0) + 'px Consolas,monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = 8;
    ctx.fillText(d.icon, 0, 1);
    ctx.restore();

    /* 射程 */
    var s = {
      dmg: d.base.dmg, rate: d.base.rate,
      range: d.base.range * C.CELL, pierce: d.base.pierce
    };
    drawRange(ctx, G, c.x, c.y, s.range, col, ok ? 0.18 : 0.12);

    /* 格子标记：机械定位框 */
    ctx.save();
    ctx.strokeStyle = U.rgba(col, 0.85);
    ctx.lineWidth = 1.8;
    var m = 7, L = 9;
    ctx.beginPath();
    ctx.moveTo(c.x - C.CELL / 2, c.y - C.CELL / 2 + m); ctx.lineTo(c.x - C.CELL / 2, c.y - C.CELL / 2); ctx.lineTo(c.x - C.CELL / 2 + m, c.y - C.CELL / 2);
    ctx.moveTo(c.x + C.CELL / 2 - m, c.y - C.CELL / 2); ctx.lineTo(c.x + C.CELL / 2, c.y - C.CELL / 2); ctx.lineTo(c.x + C.CELL / 2, c.y - C.CELL / 2 + m);
    ctx.moveTo(c.x - C.CELL / 2, c.y + C.CELL / 2 - m); ctx.lineTo(c.x - C.CELL / 2, c.y + C.CELL / 2); ctx.lineTo(c.x - C.CELL / 2 + m, c.y + C.CELL / 2);
    ctx.moveTo(c.x + C.CELL / 2 - m, c.y + C.CELL / 2); ctx.lineTo(c.x + C.CELL / 2, c.y + C.CELL / 2); ctx.lineTo(c.x + C.CELL / 2, c.y + C.CELL / 2 - m);
    ctx.stroke();
    if (!ok) {
      ctx.strokeStyle = '#ff3b47';
      ctx.lineWidth = 2.4;
      var q = C.CELL * 0.26;
      ctx.beginPath();
      ctx.moveTo(c.x - q, c.y - q); ctx.lineTo(c.x + q, c.y + q);
      ctx.moveTo(c.x + q, c.y - q); ctx.lineTo(c.x - q, c.y + q);
      ctx.stroke();
    }
    ctx.restore();
    void L;
  }

  /* 建造完成动画环 */
  function drawBuildAnim(ctx, G, t) {
    for (var i = 0; i < G.towers.length; i++) {
      var tw = G.towers[i];
      if (tw.buildT <= 0) continue;
      var p = 1 - tw.buildT / 0.42;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = U.rgba(tw.def.color, (1 - p) * 0.8);
      ctx.lineWidth = 2.4 * (1 - p);
      ctx.beginPath();
      ctx.arc(tw.x, tw.y, C.CELL * (0.4 + p * 0.9), 0, U.TAU);
      ctx.stroke();
      ctx.restore();
    }
    void t;
  }

  /* ============================================================
     画布尺寸计算
     ============================================================ */
  /* 画布最小可用尺寸：低于此值说明容器被压扁（窄窗口 / 布局抖动），
     此时保持地图宽高比并溢出裁剪，绝不让画布退化成细长条。 */
  var MIN_FIT_W = 480, MIN_FIT_H = 320;

  /* 世界变换：把 36x24 的地图「cover」到视口 —— 取较大的缩放并居中裁切，
     这样任何比例的窗口都能被战场铺满，不留黑边。
     背景仍按世界坐标绘制，所以裁切区域里看到的是延展的甲板，不是空白。 */
  var worldScale = 1, worldOX = 0, worldOY = 0;

  function applyWorld(ctx, vw, vh) {
    if (!worldScale) return;
    ctx.setTransform(worldScale, 0, 0, worldScale, worldOX, worldOY);
  }

  R.fit = function (wrap, canvas) {
    var availW = wrap.clientWidth, availH = wrap.clientHeight;
    /* 容器尚未布局（宽高为 0）时不要覆盖画布尺寸，
       否则会在 resize 早期写入 0 宽高，随后被拉伸成变形长条 */
    if (availW < 2 || availH < 2) return null;

    /* --- 画布就是容器大小：战场铺满，不留任何黑边 --- */
    var cssW = Math.floor(availW), cssH = Math.floor(availH);
    if (cssW < MIN_FIT_W) cssW = MIN_FIT_W;
    if (cssH < MIN_FIT_H) cssH = MIN_FIT_H;

    /* --- cover 缩放：scale = max(vw/W, vh/H) --- */
    var sc = Math.max(cssW / W, cssH / H);
    worldScale = sc;
    worldOX = (cssW - W * sc) * 0.5;      /* 居中裁切 */
    worldOY = (cssH - H * sc) * 0.5;

    var ctx = U.fitCanvas(canvas, cssW, cssH, quality === 'low' ? 1 : 2);
    return { ctx: ctx, w: cssW, h: cssH, scale: sc, ox: worldOX, oy: worldOY };
  };

  R.worldInfo = function () {
    return { scale: worldScale, ox: worldOX, oy: worldOY, gridW: W, gridH: H };
  };

  /* 画布当前 CSS 尺寸（诊断用） */
  R.fitInfo = function () {
    var c = document.getElementById('stage');
    if (!c) return null;
    return {
      w: c.width, h: c.height,
      cssW: parseFloat(c.style.width) || 0,
      cssH: parseFloat(c.style.height) || 0,
      ar: c.width && c.height ? +(c.width / c.height).toFixed(3) : 0
    };
  };

  R.WIDTH = W; R.HEIGHT = H;

})(window);
