/* ============================================================
   setup.js — 作战配置页（地图选择 + 难度选择）
   两种模式：
   · 闯关模式：进入某一战区前的配置（4 个地图变体 + 难度）
   · 无尽模式：地图完全自选（12 种布局 × 4 变体）+ 难度自选，
     启动时可「新的征程」或「读取存档」
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U, C = NB.CFG, Save = NB.Save;
  var UI = NB.UI;

  var S = UI.Setup = {};
  var st = {
    mode: 'campaign',      /* campaign | endless */
    level: null,
    layout: 'A',           /* 无尽模式选中的布局 */
    variant: 0,
    difficulty: 'normal',
    active: false
  };

  /* 当前配置（供 Game.start 读取） */
  S.get = function () {
    return {
      mode: st.mode,
      levelId: st.level ? st.level.id : 1,
      layout: st.layout,
      variant: st.variant,
      difficulty: st.difficulty
    };
  };

  S.bind = function () {
    var btn = U.$('#btnStartBattle');
    if (btn) {
      btn.addEventListener('click', function () {
        NB.Audio.play('uiClick');
        S.launch();
      });
    }
    var load = U.$('#btnLoadSave');
    if (load) {
      load.addEventListener('click', function () {
        NB.Audio.play('uiClick');
        NB.UI.saveManager();
      });
    }
  };

  /* ============================================================
     打开配置页
     ============================================================ */
  S.open = function (levelId) {
    st.mode = 'campaign';
    var lv = C.LEVELS.filter(function (l) { return l.id === levelId; })[0] || C.LEVELS[0];
    st.level = lv;
    st.active = true;
    /* 默认难度取上次选择 */
    st.difficulty = Save.get().lastDifficulty || 'normal';
    /* 默认变体：随机一个，避免每次同一张 */
    st.variant = U.randInt(0, NB.Path.variantCount() - 1);

    var title = U.$('#setupTitle');
    if (title) title.textContent = '作战配置';
    var tag = U.$('#setupLevel');
    if (tag) tag.textContent = '战区 ' + (lv.id < 10 ? '0' : '') + lv.id + ' · ' + lv.name;
    var loadBtn = U.$('#btnLoadSave');
    if (loadBtn) loadBtn.classList.add('hidden');

    renderMaps();
    renderDiffs();
    renderPreview();

    NB.Router.go('setup');
    NB.Audio.playMusic('menu');
  };

  /* 无尽模式配置页 */
  S.openEndless = function () {
    st.mode = 'endless';
    st.level = null;
    st.active = true;
    st.difficulty = Save.get().lastDifficulty || 'normal';
    st.layout = 'A';
    st.variant = U.randInt(0, NB.Path.variantCount() - 1);

    var title = U.$('#setupTitle');
    if (title) title.textContent = '无尽模式 · 作战配置';
    var tag = U.$('#setupLevel');
    if (tag) tag.textContent = '无尽模式';
    var loadBtn = U.$('#btnLoadSave');
    if (loadBtn) loadBtn.classList.remove('hidden');

    renderMaps();
    renderDiffs();
    renderPreview();

    NB.Router.go('setup');
    NB.Audio.playMusic('menu');
  };

  S.isActive = function () { return st.active; };

  /* ============================================================
     地图选择
     · 闯关：4 个变体缩略图
     · 无尽：12 种布局缩略图 + 变体切换行
     ============================================================ */
  function renderMaps() {
    var grid = U.$('#mapGrid');
    var vrow = U.$('#variantRow');
    if (!grid) return;

    if (st.mode === 'endless') {
      /* --- 12 种布局 --- */
      var html = '';
      for (var i = 0; i < NB.Path.LAYOUT_KEYS.length; i++) {
        var key = NB.Path.LAYOUT_KEYS[i];
        var on = key === st.layout ? ' on' : '';
        html += '<div class="map-cell' + on + '" data-layout="' + key +
          '" title="布局 ' + key + ' · ' + U.esc(layoutDesc(key)) + '">' +
          '<canvas data-map="' + key + '" width="90" height="90"></canvas>' +
          '<span class="mc-tag">' + key + '</span></div>';
      }
      grid.innerHTML = html;

      U.$$('canvas[data-map]', grid).forEach(function (cv) {
        drawLayoutThumb(cv, cv.getAttribute('data-map'), st.variant);
      });
      U.$$('[data-layout]', grid).forEach(function (n) {
        n.addEventListener('click', function () {
          st.layout = n.getAttribute('data-layout');
          U.$$('.map-cell', grid).forEach(function (x) { x.classList.remove('on'); });
          n.classList.add('on');
          NB.Audio.play('uiClick');
          renderPreview();
        });
      });

      /* --- 变体行 --- */
      if (vrow) {
        var vh = '';
        for (var v = 0; v < NB.Path.variantCount(); v++) {
          vh += '<button class="vbtn' + (v === st.variant ? ' on' : '') +
            '" data-variant="' + v + '">' + variantName(v) + '</button>';
        }
        vrow.innerHTML = vh;
        vrow.classList.remove('hidden');
        U.$$('[data-variant]', vrow).forEach(function (n) {
          n.addEventListener('click', function () {
            st.variant = parseInt(n.getAttribute('data-variant'), 10);
            U.$$('.vbtn', vrow).forEach(function (x) { x.classList.remove('on'); });
            n.classList.add('on');
            NB.Audio.play('uiClick');
            /* 刷新缩略图朝向 */
            U.$$('canvas[data-map]', grid).forEach(function (cv) {
              drawLayoutThumb(cv, cv.getAttribute('data-map'), st.variant);
            });
            renderPreview();
          });
        });
      }
      return;
    }

    /* --- 闯关：4 个变体 --- */
    if (vrow) vrow.classList.add('hidden');
    var lv = st.level;
    var n2 = NB.Path.variantCount();
    var html2 = '';
    for (var v2 = 0; v2 < n2; v2++) {
      html2 += '<div class="map-cell' + (v2 === st.variant ? ' on' : '') +
        '" data-variant="' + v2 + '" title="' + U.esc(lv.name + ' · ' + variantName(v2)) + '">' +
        '<canvas data-map="' + v2 + '" width="90" height="90"></canvas>' +
        '<span class="mc-tag">' + variantName(v2) + '</span></div>';
    }
    grid.innerHTML = html2;

    U.$$('canvas[data-map]', grid).forEach(function (cv) {
      drawMapThumb(cv, lv, parseInt(cv.getAttribute('data-map'), 10));
    });
    U.$$('[data-variant]', grid).forEach(function (n) {
      n.addEventListener('click', function () {
        st.variant = parseInt(n.getAttribute('data-variant'), 10);
        U.$$('.map-cell', grid).forEach(function (x) { x.classList.remove('on'); });
        n.classList.add('on');
        NB.Audio.play('uiClick');
        renderPreview();
      });
    });
  }

  function variantName(v) {
    return ['标准', '镜像', '翻转', '双翻'][v % 4] || '标准';
  }

  function layoutDesc(key) {
    var names = {
      A: '边境开阔带', B: '峡谷隘口', C: '霓虹都市', D: '废弃矿场',
      E: '反应堆外围', F: '冰封渡口', G: '轨道电梯', H: '量子实验室',
      I: '深空要塞', J: '虫巢母舰', K: '湮灭之环', L: '母星核心'
    };
    return names[key] || key;
  }

  /* 缩略图：路径 + 基地 + 建造格（闯关，按关卡布局） */
  function drawMapThumb(cv, lv, v) {
    drawLayoutThumb(cv, lv.layout, v);
  }

  /* 缩略图：按布局名 + 变体绘制 */
  function drawLayoutThumb(cv, layoutKey, v) {
    var map = NB.Path.get(layoutKey, v);
    var ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    var sx = W / NB.Path.WIDTH, sy = H / NB.Path.HEIGHT;
    var s = Math.min(sx, sy);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.scale(s, s);

    var GW = NB.Path.GW, GH = NB.Path.GH, CELL = NB.Path.CELL;
    for (var gy = 0; gy < GH; gy++) {
      for (var gx = 0; gx < GW; gx++) {
        if (map.blocked[gy * GW + gx] === 0) {
          ctx.fillStyle = 'rgba(80,140,185,.16)';
          ctx.fillRect(gx * CELL + 2, gy * CELL + 2, CELL - 4, CELL - 4);
        }
      }
    }
    /* 所有敌人路径：主路径亮青，备用路径暗金 */
    for (var pi = 0; pi < map.paths.length; pi++) {
      var nd = map.paths[pi].nodes;
      ctx.beginPath();
      ctx.moveTo(nd[0].x, nd[0].y);
      for (var i = 1; i < nd.length; i++) ctx.lineTo(nd[i].x, nd[i].y);
      ctx.strokeStyle = pi === 0 ? 'rgba(79,227,255,.85)' : 'rgba(255,210,61,.45)';
      ctx.lineWidth = CELL * 0.42;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.lineWidth = CELL * 0.14;
      ctx.stroke();
      /* 入口 */
      ctx.fillStyle = pi === 0 ? '#ff2e42' : '#ff9a4a';
      ctx.beginPath(); ctx.arc(nd[0].x, nd[0].y, CELL * 0.30, 0, U.TAU); ctx.fill();
    }
    /* 中继站塔位 */
    for (var rl = 0; rl < map.relaySlots.length; rl++) {
      var rs = map.relaySlots[rl];
      ctx.strokeStyle = '#ffd23d';
      ctx.lineWidth = CELL * 0.10;
      ctx.strokeRect(rs.cx - CELL * 0.34, rs.cy - CELL * 0.34, CELL * 0.68, CELL * 0.68);
      ctx.fillStyle = '#ffd23d';
      ctx.beginPath(); ctx.arc(rs.cx, rs.cy, CELL * 0.13, 0, U.TAU); ctx.fill();
    }
    /* 基地 */
    var b = map.base;
    ctx.fillStyle = '#4fe3ff';
    ctx.shadowColor = '#4fe3ff'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(b.x, b.y, CELL * 0.42, 0, U.TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  /* ============================================================
     难度选择（两种模式通用，选择会被记住）
     ============================================================ */
  function renderDiffs() {
    var box = U.$('#diffList');
    if (!box) return;
    var html = '';
    for (var i = 0; i < C.DIFFICULTY_ORDER.length; i++) {
      var k = C.DIFFICULTY_ORDER[i];
      var d = C.DIFFICULTIES[k];
      var hpPct = Math.round((d.hpMul - 1) * 100);
      var spPct = Math.round((d.spMul - 1) * 100);
      var gdPct = Math.round((d.goldMul - 1) * 100);
      var atkPct = Math.round(d.attackerRate * 100);
      var hpCls = hpPct > 0 ? 'up' : (hpPct < 0 ? 'dn' : '');
      var spCls = spPct > 0 ? 'up' : (spPct < 0 ? 'dn' : '');
      var gdCls = gdPct > 0 ? 'dn' : (gdPct < 0 ? 'up' : '');

      html += '<div class="diff-card' + (k === st.difficulty ? ' on' : '') +
        '" data-diff="' + k + '" style="--dc:' + d.color + '">' +
        '<div class="dc-row"><span class="dc-name">' + d.name + '</span>' +
        '<span class="dc-tag">' + d.tag + '</span></div>' +
        '<div class="dc-desc">' + U.esc(d.desc) + '</div>' +
        '<div class="dc-stats">' +
        '<span>血量 <b class="' + hpCls + '">' + (hpPct >= 0 ? '+' : '') + hpPct + '%</b></span>' +
        '<span>速度 <b class="' + spCls + '">' + (spPct >= 0 ? '+' : '') + spPct + '%</b></span>' +
        '<span>资金 <b class="' + gdCls + '">' + (gdPct >= 0 ? '+' : '') + gdPct + '%</b></span>' +
        '<span>攻击型 <b>' + atkPct + '%</b></span>' +
        (d.livesBonus !== 0
          ? '<span>耐久 <b class="' + (d.livesBonus > 0 ? 'dn' : 'up') + '">' +
            (d.livesBonus > 0 ? '+' : '') + d.livesBonus + '</b></span>'
          : '') +
        '</div></div>';
    }
    box.innerHTML = html;

    U.$$('[data-diff]', box).forEach(function (n) {
      n.addEventListener('click', function () {
        st.difficulty = n.getAttribute('data-diff');
        U.$$('.diff-card', box).forEach(function (x) { x.classList.remove('on'); });
        n.classList.add('on');
        NB.Audio.play('uiClick');
        Save.get().lastDifficulty = st.difficulty;
        Save.save();
        renderPreview();
      });
    });
  }

  /* ============================================================
     底部预览
     ============================================================ */
  function renderPreview() {
    var box = U.$('#setupPreview');
    if (!box) return;
    var d = C.DIFFICULTIES[st.difficulty];
    var layoutKey = st.mode === 'endless' ? st.layout : st.level.layout;
    var map = NB.Path.get(layoutKey, st.variant);
    var best = Save.endlessBest();

    var rows;
    if (st.mode === 'endless') {
      rows = [
        row('模式', '无尽模式 · 波次无限'),
        row('地图', layoutDesc(layoutKey) + '（' + layoutKey + '）· ' + variantName(st.variant)),
        row('可建格', NB.Path.freeCells(map) + ' 个'),
        row('敌人血量', '随波数成长（难度 ×' + d.hpMul + '）'),
        row('敌人速度', '随波数成长（难度 ×' + d.spMul + '）'),
        row('基地耐久', Math.max(1, Math.min(99, C.ENDLESS.lives + d.livesBonus)) + ' / ' +
          Math.max(1, Math.min(99, C.ENDLESS.lives + d.livesBonus))),
        row('起始资金', '⬢ ' + Math.round(C.ENDLESS.startGold * d.goldMul)),
        row('历史最佳', '第 ' + (best.wave || 0) + ' 波')
      ];
    } else {
      var lv = st.level;
      var lives = Math.max(1, Math.min(99, lv.lives + d.livesBonus));
      rows = [
        row('战区', lv.name + '（难度 ' + lv.diff + '）'),
        row('地图', variantName(st.variant) + ' · ' + NB.Path.freeCells(map) + ' 个可建格'),
        row('波次', lv.waves + ' 波' + (lv.boss ? ' · 含 BOSS' : '')),
        row('敌人血量', '×' + lv.hpMul * d.hpMul, 'sp-v'),
        row('敌人速度', '×' + (lv.spMul * d.spMul).toFixed(2)),
        row('基地耐久', lives + ' / ' + lives),
        row('起始资金', '⬢ ' + Math.round(lv.startGold * d.goldMul))
      ];
    }

    var warn = '';
    if (d.attackerRate > 0) {
      warn = '<div class="sp-row" style="margin-top:6px"><span class="sp-warn">⚠ 约 ' +
        Math.round(d.attackerRate * 100) + '% 的敌人会脱离路径、低伤害攻击你的炮塔</span></div>';
    }

    box.innerHTML = '<div class="sp-row">' + rows.join('') + '</div>' + warn;
  }

  function row(k, v, cls) {
    return '<span><span class="sp-k">' + k + '</span> <span class="' + (cls || 'sp-v') + '">' +
      U.esc(String(v)) + '</span></span>';
  }

  /* ============================================================
     启动
     ============================================================ */
  S.launch = function () {
    var cfg = S.get();
    st.active = false;
    if (st.mode === 'endless') {
      /* 新开局：先命名建档，再进入 */
      NB.UI.saveNamePrompt('新的征程 · 存档命名', '无尽存档 ' + (Save.endlessSlotCount() + 1),
        function (name) {
          var id = Save.endlessCreate(name, {
            layout: st.layout, variant: st.variant, difficulty: st.difficulty,
            waveNo: 0, kills: 0
          });
          NB.Game.start(0, {
            endless: true, layout: st.layout, variant: st.variant,
            difficulty: st.difficulty, newSlot: id
          });
          NB.Router.go('game');
          /* 立即写入初始快照，保证空槽可读 */
          NB.Game.saveEndless(id);
          NB.UI.toast('无尽模式启动 · 第 1 波', 'cy', 2200);
        });
      return;
    }
    NB.Game.start(cfg.levelId, {
      variant: cfg.variant,
      difficulty: cfg.difficulty
    });
    NB.Router.go('game');
  };

})(window);
