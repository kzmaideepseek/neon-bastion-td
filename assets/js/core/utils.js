/* ============================================================
   utils.js — 基础工具
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U = {};

  U.TAU = Math.PI * 2;
  U.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.rand = function (a, b) { return a + Math.random() * (b - a); };
  U.randInt = function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); };
  U.pick = function (arr) { return arr[(Math.random() * arr.length) | 0]; };
  U.chance = function (p) { return Math.random() < p; };

  /* 角度差归一到 [-PI, PI] */
  U.angDiff = function (a, b) {
    var d = (b - a) % U.TAU;
    if (d > Math.PI) d -= U.TAU;
    if (d < -Math.PI) d += U.TAU;
    return d;
  };
  U.angLerp = function (a, b, t) { return a + U.angDiff(a, b) * t; };

  U.dist2 = function (ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
  U.dist = function (ax, ay, bx, by) { return Math.sqrt(U.dist2(ax, ay, bx, by)); };

  /* 点到线段最近点，返回 {x,y,t,d} */
  U.closestOnSeg = function (px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var len2 = dx * dx + dy * dy;
    var t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
    t = U.clamp(t, 0, 1);
    var cx = x1 + dx * t, cy = y1 + dy * t;
    return { x: cx, y: cy, t: t, d: U.dist(px, py, cx, cy) };
  };

  /* 数字格式化 */
  U.fmt = function (n) {
    n = Math.floor(n);
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + 'M';
    if (n >= 10000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'K';
    return String(n);
  };
  U.fmtFull = function (n) {
    n = Math.floor(n);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
  U.pct = function (a, b) { return b <= 0 ? 0 : U.clamp(a / b, 0, 1); };

  /* DOM */
  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  U.el = function (tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  U.esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  U.on = function (node, ev, fn, opt) { node.addEventListener(ev, fn, opt); return function () { node.removeEventListener(ev, fn, opt); }; };

  /* 颜色 -> rgba 字符串 */
  /* ============================================================
     渲染安全补丁：非法颜色不得中断渲染循环
     addColorStop 遇到非法颜色会抛 SyntaxError，
     在 rAF 循环里会直接掐断整帧绘制。这里做全局兜底。
     ============================================================ */
  (function patchGradient() {
    var proto = w.CanvasGradient && w.CanvasGradient.prototype;
    if (!proto || proto.__nbPatched) return;
    var orig = proto.addColorStop;
    proto.addColorStop = function (offset, color) {
      try {
        if (typeof offset !== 'number' || !isFinite(offset)) return;
        if (offset < 0) offset = 0;
        if (offset > 1) offset = 1;
        if (typeof color !== 'string' || color.charAt(0) === '#') {
          /* 允许 #hex；其余必须是 rgba()/rgb()/hsl() 形式 */
          if (typeof color !== 'string' || !/^(rgba?|hsla?)\(/.test(color.trim())) return;
        }
        orig.call(this, offset, color);
      } catch (e) {
        /* 静默降级：跳过这一个色标，保证剩余绘制继续 */
      }
    };
    proto.__nbPatched = true;
  })();

  /* 颜色 -> rgba 字符串。
     alpha 必须夹取到 [0,1] 且为有限数：历史上曾因浮点误差传入 1.012，
     导致 CanvasGradient.addColorStop 抛 SyntaxError（渲染中断）。 */
  U.rgba = function (hex, a) {
    if (typeof hex !== 'string' || hex.charAt(0) !== '#') hex = '#ffffff';
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) n = 0xffffff;
    var al = (typeof a === 'number' && isFinite(a)) ? a : 1;
    al = al < 0 ? 0 : (al > 1 ? 1 : al);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + al + ')';
  };
  U.mix = function (c1, c2, t) {
    var p = function (h) { h = h.replace('#', ''); var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    var a = p(c1), b = p(c2);
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' + Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')';
  };

  /* 时间 */
  U.now = function () { return performance.now(); };
  U.fmtTime = function (sec) {
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  };

  /* 简单事件总线 */
  U.bus = (function () {
    var map = {};
    return {
      on: function (k, fn) { (map[k] || (map[k] = [])).push(fn); },
      off: function (k, fn) {
        var a = map[k]; if (!a) return;
        var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
      },
      emit: function (k, p) {
        var a = map[k]; if (!a) return;
        for (var i = 0; i < a.length; i++) {
          try { a[i](p); } catch (e) { console.error('[bus:' + k + ']', e); }
        }
      }
    };
  })();

  /* 键鼠：世界坐标（canvas 逻辑坐标） */
  U.mouse = { x: 0, y: 0, cx: 0, cy: 0, down: false, inside: false, sx: 0, sy: 0, moved: false };

  /* 设备像素比适配：设置 canvas 实际尺寸，返回逻辑尺寸 */
  U.fitCanvas = function (canvas, cssW, cssH, maxDpr) {
    var dpr = Math.min(w.devicePixelRatio || 1, maxDpr || 2);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  };

})(window);
