/* ============================================================
   path.js — 地图 / 路径 / 多出生点 / 场景装饰
   网格 36 x 24，格子 44px，画布 1584 x 1056
   每套布局 2~3 条敌人路径（多出生点），共用同一基地；
   备用出生点需建造「通讯中继站」激活（blocked=4 为塔位）
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U, C = NB.CFG;
  var P = NB.Path = {};

  var GW = C.GRID_W, GH = C.GRID_H, CELL = C.CELL;
  P.GW = GW; P.GH = GH; P.CELL = CELL;
  P.WIDTH = GW * CELL;
  P.HEIGHT = GH * CELL;

  /* ---------- 确定性随机 ---------- */
  function Rng(seed) {
    this.s = (seed >>> 0) || 1;
  }
  Rng.prototype.next = function () {
    this.s ^= this.s << 13; this.s >>>= 0;
    this.s ^= this.s >> 17;
    this.s ^= this.s << 5; this.s >>>= 0;
    return this.s / 4294967296;
  };
  Rng.prototype.int = function (a, b) { return a + Math.floor(this.next() * (b - a + 1)); };
  Rng.prototype.pick = function (arr) { return arr[this.int(0, arr.length - 1)]; };
  P.Rng = Rng;

  /* ============================================================
     布局定义
     ways:   2~3 条折线路径，首点在界外（入口），末点为基地
     relays: [{gx,gy,path}] 中继站塔位，path = 解锁哪条备用路径（1 起）
     ============================================================ */
  var LAYOUTS = {
    /* A：经典 S 形 + 右侧备用入口 */
    A: {
      ways: [
        [[-1, 12], [8, 12], [8, 4], [16, 4], [16, 20], [24, 20], [24, 7], [30, 7], [30, 12], [33, 12]],
        [[36, 3], [29, 3], [29, 17], [33, 17], [33, 12]]
      ],
      relays: [{ gx: 34, gy: 2, path: 1 }]
    },
    /* B：双环回廊 + 顶部备用入口 */
    B: {
      ways: [
        [[-1, 4], [7, 4], [7, 11], [13, 11], [13, 2], [20, 2], [20, 14], [26, 14], [26, 7], [31, 7], [31, 20], [33, 20]],
        [[18, -1], [18, 8], [24, 8], [24, 18], [33, 18], [33, 20]]
      ],
      relays: [{ gx: 19, gy: 1, path: 1 }]
    },
    /* C：长斜线 Z 形 + 底部备用入口 */
    C: {
      ways: [
        [[-1, 20], [9, 20], [9, 8], [4, 8], [4, 15], [19, 15], [19, 3], [28, 3], [28, 13], [33, 13], [33, 5]],
        [[22, 24], [22, 17], [28, 17], [28, 9], [33, 9], [33, 5]]
      ],
      relays: [{ gx: 20, gy: 22, path: 1 }]
    },
    /* D：三段错位 + 右侧备用入口 */
    D: {
      ways: [
        [[-1, 6], [6, 6], [6, 14], [12, 14], [12, 5], [19, 5], [19, 17], [25, 17], [25, 8], [29, 8], [29, 22], [33, 22]],
        [[36, 10], [30, 10], [30, 19], [33, 19], [33, 22]]
      ],
      relays: [{ gx: 34, gy: 8, path: 1 }]
    },
    /* E：垂直回形 + 底部备用入口 */
    E: {
      ways: [
        [[19, -1], [19, 5], [8, 5], [8, 14], [25, 14], [25, 4], [31, 4], [31, 18], [22, 18], [22, 11], [12, 11], [12, 22], [18, 22]],
        [[30, 24], [30, 16], [24, 16], [24, 21], [18, 21], [18, 22]]
      ],
      relays: [{ gx: 32, gy: 22, path: 1 }]
    },
    /* F：长蛇形 + 右侧备用入口 */
    F: {
      ways: [
        [[-1, 3], [6, 3], [6, 10], [12, 10], [12, 3], [19, 3], [19, 12], [25, 12], [25, 4], [31, 4], [31, 16], [22, 16], [22, 22], [27, 22]],
        [[36, 7], [33, 7], [33, 19], [30, 19], [30, 22], [27, 22]]
      ],
      relays: [{ gx: 34, gy: 5, path: 1 }]
    },
    /* G：紧凑迷宫 + 顶部备用入口 */
    G: {
      ways: [
        [[-1, 14], [7, 14], [7, 5], [12, 5], [12, 21], [17, 21], [17, 8], [23, 8], [23, 17], [29, 17], [29, 3], [33, 3]],
        [[10, -1], [10, 10], [16, 10], [16, 2], [24, 2], [24, 10], [33, 10], [33, 3]]
      ],
      relays: [{ gx: 8, gy: 1, path: 1 }]
    },
    /* H：右侧来兵 + 左侧备用入口 */
    H: {
      ways: [
        [[36, 12], [27, 12], [27, 4], [19, 4], [19, 20], [11, 20], [11, 5], [7, 5], [7, 12], [3, 12]],
        [[-1, 2], [5, 2], [5, 8], [3, 8], [3, 12]]
      ],
      relays: [{ gx: 1, gy: 0, path: 1 }]
    },
    /* I：四段横穿 + 底部备用入口 */
    I: {
      ways: [
        [[-1, 11], [5, 11], [5, 3], [11, 3], [11, 16], [18, 16], [18, 6], [25, 6], [25, 20], [30, 20], [30, 9], [22, 9], [22, 13], [17, 13], [17, 22]],
        [[27, 24], [27, 15], [21, 15], [21, 20], [17, 20], [17, 22]]
      ],
      relays: [{ gx: 29, gy: 22, path: 1 }]
    },
    /* J：外环绕行 + 右侧备用入口 */
    J: {
      ways: [
        [[-1, 21], [5, 21], [5, 2], [32, 2], [32, 21], [26, 21], [26, 9], [19, 9], [19, 15], [33, 15], [33, 12]],
        [[36, 5], [30, 5], [30, 18], [34, 18], [34, 10], [33, 10], [33, 12]]
      ],
      relays: [{ gx: 34, gy: 3, path: 1 }]
    },
    /* K：镜像长蛇 + 顶部备用入口 */
    K: {
      ways: [
        [[36, 21], [29, 21], [29, 8], [24, 8], [24, 20], [17, 20], [17, 5], [10, 5], [10, 14], [6, 14], [6, 22], [4, 22]],
        [[14, -1], [14, 7], [20, 7], [20, 17], [12, 17], [12, 22], [4, 22]]
      ],
      relays: [{ gx: 16, gy: 1, path: 1 }]
    },
    /* L：终极螺旋（最长路径）+ 右侧备用入口 */
    L: {
      ways: [
        [[-1, 3], [5, 3], [5, 12], [11, 12], [11, 3], [18, 3], [18, 16], [9, 16], [9, 22], [26, 22], [26, 9], [32, 9], [32, 17], [20, 17], [20, 22]],
        [[36, 12], [31, 12], [31, 19], [25, 19], [25, 23], [20, 23], [20, 22]]
      ],
      relays: [{ gx: 33, gy: 10, path: 1 }]
    }
  };
  P.LAYOUT_KEYS = Object.keys(LAYOUTS);

  /* 变换：0=原样 1=水平镜像 2=垂直翻转 3=双翻转 */
  var TRANSFORMS = [
    { name: '', mx: false, my: false },
    { name: '·镜像', mx: true, my: false },
    { name: '·翻转', mx: false, my: true },
    { name: '·双翻', mx: true, my: true }
  ];

  function transformLayout(L, tr) {
    function tp(p) {
      var x = p[0], y = p[1];
      if (tr.mx) x = (GW - 1) - x;
      if (tr.my) y = (GH - 1) - y;
      return [x, y];
    }
    /* 注意：不能整体 reverse。镜像后首点 = 镜像入口（仍在界外，只是换到另一侧），
       末点 = 镜像基地，「从入口走向基地」的方向天然成立。
       早期版本加过 reverse，反而把 base 取成界外入口点，
       造成镜像/双翻变体敌人从基地出生往界外走（v5 遗留 bug，此版修正）。 */
    var ways = L.ways.map(function (way) {
      return way.map(tp);
    });
    var relays = (L.relays || []).map(function (r) {
      var p = tp([r.gx, r.gy]);
      return { gx: p[0], gy: p[1], path: r.path };
    });
    /* 基地格 = 主路径（ways[0]）变换后的末点，不单独变换 */
    var endPt = ways[0][ways[0].length - 1];
    return { ways: ways, relays: relays, base: [endPt[0], endPt[1]] };
  }

  /* ============================================================
     地图构建
     ============================================================ */
  var cache = {};

  /**
   * P.get(key, variant)  variant: 0..3 变换变体；不传则用变体 0
   * map.paths[i] = { nodes, segs, total, spawn }  第 i 条敌人路径
   * map.relaySlots[i] = { gx, gy, path, cx, cy }  中继站塔位
   */
  P.get = function (key, variant) {
    var v = variant | 0;
    var ck = key + '#' + v;
    if (cache[ck]) return cache[ck];

    var L = LAYOUTS[key] || LAYOUTS.A;
    var tr = TRANSFORMS[v % 4];
    var t = transformLayout(L, tr);

    var CELLH = CELL / 2;
    var paths = [];
    for (var wi = 0; wi < t.ways.length; wi++) {
      var raw = t.ways[wi].map(function (p) {
        return { x: p[0] * CELL + CELLH, y: p[1] * CELL + CELLH, gx: p[0], gy: p[1] };
      });
      /* 去掉零长段 */
      var nodes = [raw[0]];
      for (var i = 1; i < raw.length; i++) {
        var a = nodes[nodes.length - 1], b = raw[i];
        if (Math.abs(a.x - b.x) > 0.001 || Math.abs(a.y - b.y) > 0.001) nodes.push(b);
      }
      /* 防御：首点必须在界外（入口）。若因布局数据问题落在界内，则反转方向 */
      var f0 = nodes[0];
      var firstOutside = f0.x < 0 || f0.x >= P.WIDTH || f0.y < 0 || f0.y >= P.HEIGHT;
      if (!firstOutside) nodes.reverse();
      /* 基地格 = 主路径末点（t.base 由 transformLayout 保证） */
      var baseGX = t.base[0], baseGY = t.base[1];

      /* 线段 + 累积长度 */
      var segs = [], total = 0;
      for (var j = 0; j < nodes.length - 1; j++) {
        var p1 = nodes[j], p2 = nodes[j + 1];
        var dx = p2.x - p1.x, dy = p2.y - p1.y;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) continue;
        segs.push({ ax: p1.x, ay: p1.y, bx: p2.x, by: p2.y, len: len, acc: total, ang: Math.atan2(dy, dx) });
        total += len;
      }
      paths.push({
        nodes: nodes, segs: segs, total: total,
        spawn: { x: nodes[0].x, y: nodes[0].y, gx: nodes[0].gx, gy: nodes[0].gy }
      });
    }

    /* 占用网格：0=可建 1=路径 2=基地 3=基地邻接 4=中继站塔位 */
    var blocked = [];
    for (var b = 0; b < GW * GH; b++) blocked.push(0);
    var pi, si, k;
    for (pi = 0; pi < paths.length; pi++) {
      var ps = paths[pi].segs;
      for (si = 0; si < ps.length; si++) {
        var sg = ps[si];
        var steps = Math.max(2, Math.ceil(sg.len / (CELL * 0.34)));
        for (k = 0; k <= steps; k++) {
          var tt = k / steps;
          var gx = Math.floor((sg.ax + (sg.bx - sg.ax) * tt) / CELL);
          var gy = Math.floor((sg.ay + (sg.by - sg.ay) * tt) / CELL);
          if (gx >= 0 && gy >= 0 && gx < GW && gy < GH) blocked[gy * GW + gx] = 1;
        }
      }
    }
    /* 基地格 + 四邻禁建（防御性夹取，保证永不出界） */
    var bx = U.clamp(baseGX, 0, GW - 1);
    var by = U.clamp(baseGY, 0, GH - 1);
    if (bx >= 0 && by >= 0 && bx < GW && by < GH) {
      blocked[by * GW + bx] = 2;
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var d = 0; d < dirs.length; d++) {
        var nx = bx + dirs[d][0], ny = by + dirs[d][1];
        if (nx >= 0 && ny >= 0 && nx < GW && ny < GH) blocked[ny * GW + nx] = 3;
      }
    }
    /* 中继站塔位：夹取到界内，避开路径/基地/邻接 */
    var relaySlots = [];
    for (var ri = 0; ri < t.relays.length; ri++) {
      var rs = t.relays[ri];
      var rx = U.clamp(rs.gx, 0, GW - 1), ry = U.clamp(rs.gy, 0, GH - 1);
      /* 若被路径/基地占用，向入口反方向找最近的空格 */
      if (blocked[ry * GW + rx] !== 0) {
        var found = false;
        for (var rad = 1; rad <= 4 && !found; rad++) {
          for (var ox = -rad; ox <= rad && !found; ox++) {
            for (var oy = -rad; oy <= rad && !found; oy++) {
              var tx = rx + ox, ty = ry + oy;
              if (!P.inBounds(tx, ty)) continue;
              if (blocked[ty * GW + tx] === 0) { rx = tx; ry = ty; found = true; }
            }
          }
        }
      }
      if (blocked[ry * GW + rx] === 0) {
        blocked[ry * GW + rx] = 4;
        relaySlots.push({
          gx: rx, gy: ry, path: rs.path,
          cx: rx * CELL + CELL / 2, cy: ry * CELL + CELL / 2
        });
      }
    }

    /* 基地实际坐标取该格中心 */
    var baseC = { x: bx * CELL + CELL / 2, y: by * CELL + CELL / 2, gx: bx, gy: by };

    var map = {
      key: key,
      variant: v,
      variantName: tr.name,
      paths: paths,
      /* 兼容旧字段（主路径） */
      nodes: paths[0].nodes,
      segs: paths[0].segs,
      total: paths[0].total,
      blocked: blocked,
      base: baseC,
      spawn: paths[0].spawn,
      baseDir: paths[0].segs.length ? paths[0].segs[paths[0].segs.length - 1].ang : 0,
      relaySlots: relaySlots,
      seed: (key.charCodeAt(0) * 7919 + v * 104729 + 13) | 0,
      decor: null
    };

    buildDecor(map);
    cache[ck] = map;
    return map;
  };

  /* 按路径取位置（pathIdx 缺省 0） */
  P.posAt = function (map, dist, pi) {
    pi = pi || 0;
    var segs = (map.paths && map.paths[pi]) ? map.paths[pi].segs : map.segs;
    var total = (map.paths && map.paths[pi]) ? map.paths[pi].total : map.total;
    if (!segs.length) return { x: map.base.x, y: map.base.y, ang: 0 };
    if (dist <= 0) return { x: segs[0].ax, y: segs[0].ay, ang: segs[0].ang };
    if (dist >= total) {
      var l = segs[segs.length - 1];
      return { x: l.bx, y: l.by, ang: l.ang };
    }
    var lo = 0, hi = segs.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (segs[mid].acc + segs[mid].len <= dist) lo = mid + 1; else hi = mid;
    }
    var s = segs[lo];
    var t = (dist - s.acc) / s.len;
    return { x: s.ax + (s.bx - s.ax) * t, y: s.ay + (s.by - s.ay) * t, ang: s.ang };
  };

  P.pathTotal = function (map, pi) {
    pi = pi || 0;
    return (map.paths && map.paths[pi]) ? map.paths[pi].total : map.total;
  };
  P.spawnCount = function (map) { return map.paths ? map.paths.length : 1; };

  /* 网格辅助 */
  P.gx = function (x) { return Math.floor(x / CELL); };
  P.gy = function (y) { return Math.floor(y / CELL); };
  P.inBounds = function (gx, gy) { return gx >= 0 && gy >= 0 && gx < GW && gy < GH; };
  P.blockedAt = function (map, gx, gy) {
    if (!P.inBounds(gx, gy)) return 1;
    return map.blocked[gy * GW + gx];
  };
  /* 可建：普通格；中继站塔位（4）只能建 relay */
  P.canBuild = function (map, gx, gy) { return P.blockedAt(map, gx, gy) === 0; };
  P.canBuildRelay = function (map, gx, gy) { return P.blockedAt(map, gx, gy) === 4; };
  P.relaySlotAt = function (map, gx, gy) {
    for (var i = 0; i < map.relaySlots.length; i++) {
      if (map.relaySlots[i].gx === gx && map.relaySlots[i].gy === gy) return map.relaySlots[i];
    }
    return null;
  };
  P.cellCenter = function (gx, gy) { return { x: gx * CELL + CELL / 2, y: gy * CELL + CELL / 2 }; };

  /* 总变体数 */
  P.variantCount = function () { return 4; };

  /* 可建造格数 */
  P.freeCells = function (map) {
    var n = 0;
    for (var i = 0; i < map.blocked.length; i++) if (map.blocked[i] === 0) n++;
    return n;
  };

  /* ============================================================
     场景装饰：随机厂区设施，纯装饰不影响建造
     ============================================================ */
  var DECOR_KINDS = ['tank', 'crate', 'vent', 'cooler', 'breaker', 'pipe'];
  function buildDecor(map) {
    var rng = new Rng(map.seed);
    var free = [];
    for (var gy = 1; gy < GH - 1; gy++) {
      for (var gx = 1; gx < GW - 1; gx++) {
        if (map.blocked[gy * GW + gx] === 0) free.push([gx, gy]);
      }
    }
    rng.shuffle = null;
    /* Fisher-Yates */
    for (var i = free.length - 1; i > 0; i--) {
      var j = rng.int(0, i);
      var tmp = free[i]; free[i] = free[j]; free[j] = tmp;
    }
    var n = Math.min(free.length, Math.round(free.length * 0.26));
    var decor = [];
    for (var d = 0; d < n; d++) {
      var c = free[d];
      decor.push({
        gx: c[0], gy: c[1],
        x: c[0] * CELL + CELL / 2, y: c[1] * CELL + CELL / 2,
        kind: DECOR_KINDS[d % DECOR_KINDS.length],
        variant: d % 4,          /* 装饰外形变体（drawDecorCrate 等依赖，勿删） */
        rot: rng.next() * Math.PI * 2,
        phase: rng.next() * 10,   /* 动画相位（render 用 o.phase） */
        s: 0.85 + rng.next() * 0.4 /* 缩放（render 用 o.s） */
      });
    }
    map.decor = decor;
  }

  /* ============================================================
     校验：全部布局 × 全部变体
     ============================================================ */
  P.audit = function () {
    var out = [];
    var keys = P.LAYOUT_KEYS;
    for (var ki = 0; ki < keys.length; ki++) {
      for (var v = 0; v < 4; v++) {
        var key = keys[ki];
        var m = P.get(key, v);
        var free = P.freeCells(m);
        var ok = true, why = '';
        /* 每条路径都要够长、首点在界外、末点是基地 */
        for (var pi = 0; pi < m.paths.length; pi++) {
          var pt = m.paths[pi];
          if (pt.total < 700) { ok = false; why = 'path' + pi + '短'; }
          var s0 = pt.spawn, last = pt.nodes[pt.nodes.length - 1];
          var inb = P.inBounds(s0.gx, s0.gy);
          var outside = s0.x < 0 || s0.x >= P.WIDTH || s0.y < 0 || s0.y >= P.HEIGHT;
          if (!outside && inb) { ok = false; why = 'path' + pi + '入口在界内'; }
          if (!(last.gx === m.base.gx && last.gy === m.base.gy)) { ok = false; why = 'path' + pi + '末点非基地'; }
        }
        /* 基地在界内 */
        if (!P.inBounds(m.base.gx, m.base.gy)) { ok = false; why = 'baseOOB'; }
        /* 建造空间 */
        if (free < 400) { ok = false; why = 'free少'; }
        /* 装饰 */
        if (!m.decor || m.decor.length < 40) { ok = false; why = 'decor少'; }
        /* 中继站塔位：界内、类型 4、指向有效路径 */
        if (!m.relaySlots.length) { ok = false; why = '无中继塔位'; }
        for (var ri = 0; ri < m.relaySlots.length; ri++) {
          var rs = m.relaySlots[ri];
          if (!P.inBounds(rs.gx, rs.gy)) { ok = false; why = 'relayOOB'; }
          if (P.blockedAt(m, rs.gx, rs.gy) !== 4) { ok = false; why = 'relay格类型错'; }
          if (rs.path < 1 || rs.path >= m.paths.length) { ok = false; why = 'relay指向无效路径'; }
        }
        /* 路径长度单调性抽样 */
        var mono = true;
        for (var pi2 = 0; pi2 < m.paths.length; pi2++) {
          var tot = P.pathTotal(m, pi2);
          for (var dd = 0; dd <= tot; dd += 13) {
            var pp = P.posAt(m, dd, pi2);
            if (!isFinite(pp.x) || !isFinite(pp.y)) { mono = false; break; }
          }
        }
        if (!mono) { ok = false; why = 'posAt异常'; }
        out.push({
          key: key, v: v, ok: ok, why: why,
          free: free, decor: m.decor.length,
          total: Math.round(m.paths[0].total),
          paths: m.paths.length,
          relays: m.relaySlots.length
        });
      }
    }
    return out;
  };

})(window);
