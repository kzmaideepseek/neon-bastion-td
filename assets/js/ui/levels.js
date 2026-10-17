/* ============================================================
   levels.js — 战区选择（左侧列表 + 右侧详情）
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U, C = NB.CFG, Save = NB.Save;
  var UI = NB.UI;

  var list = null, detail = null;
  var selId = 1;

  UI.levelsBind = function () {
    list = U.$('#lvGrid');
    detail = U.$('#lvDetail');
  };

  UI.levelsRender = function () {
    if (!list || !detail) return;
    var maxUnlocked = Save.maxLevelUnlocked();
    var stars = Save.totalStars();

    var sumEl = U.$('#lvStarsSum');
    if (sumEl) {
      sumEl.textContent = '★ ' + stars + ' / ' + Save.maxStars();
      sumEl.title = '每关最多 3 星：通关 1 星 · 基地耐久≥70% 1 星 · 限时通关 1 星。12 关共 36 星。';
    }

    /* 默认选中：第一个未通关的已解锁关 */
    if (!C.LEVELS.some(function (l) { return l.id === selId; })) selId = 1;
    var rec0 = Save.level(selId);
    if (selId > maxUnlocked || (rec0 && rec0.clear)) {
      var pick = null;
      for (var i = 0; i < C.LEVELS.length; i++) {
        var lv2 = C.LEVELS[i];
        if (lv2.id <= maxUnlocked && !Save.level(lv2.id).clear) { pick = lv2.id; break; }
      }
      if (pick) selId = pick;
    }

    /* ---- 左侧列表 ---- */
    var html = '';
    for (var i2 = 0; i2 < C.LEVELS.length; i2++) {
      var lv = C.LEVELS[i2];
      var rec = Save.level(lv.id);
      var locked = lv.id > maxUnlocked;
      var cls = 'lv-row';
      if (locked) cls += ' locked';
      if (rec.clear) cls += ' clear';
      if (lv.id === selId) cls += ' sel';

      var st = '';
      for (var s = 0; s < 3; s++) st += (s < (rec.stars || 0)) ? '★' : '☆';

      html += '<div class="' + cls + '" data-lv="' + lv.id + '">' +
        '<span class="lr-no">' + (lv.id < 10 ? '0' : '') + lv.id + '</span>' +
        '<span class="lr-name">' + U.esc(lv.name) + '</span>' +
        (lv.boss ? '<span class="lr-boss">BOSS</span>' : '') +
        (locked ? '<span class="lr-lock">🔒</span>' : '<span class="lr-stars">' + st + '</span>') +
        '</div>';
    }
    list.innerHTML = html;

    U.$$('[data-lv]', list).forEach(function (n) {
      n.addEventListener('click', function () {
        var id = parseInt(n.getAttribute('data-lv'), 10);
        if (id > maxUnlocked) {
          NB.Audio.play('uiDenied');
          UI.toast('该战区尚未解锁', 'rd', 1600);
          return;
        }
        selId = id;
        NB.Audio.play('uiClick');
        UI.levelsRender();
      });
    });

    renderDetail();
  };

  /* ---- 右侧详情 ---- */
  function renderDetail() {
    var lv = C.LEVELS.filter(function (l) { return l.id === selId; })[0] || C.LEVELS[0];
    var rec = Save.level(lv.id);
    var maxUnlocked = Save.maxLevelUnlocked();
    var locked = lv.id > maxUnlocked;

    var diff = '';
    for (var d = 0; d < 12; d++) {
      diff += '<span class="lv-diff' + (d < lv.diff ? ' on' : '') + '"></span>';
    }

    var starsHtml = '';
    for (var s = 0; s < 3; s++) {
      starsHtml += (s < (rec.stars || 0)) ? '<b>★</b>' : '<span>★</span>';
    }

    var html =
      '<div class="ld-head">' +
      '<div class="ld-no">' + (lv.id < 10 ? '0' : '') + lv.id + '</div>' +
      '<div class="ld-title">' +
      '<div class="ld-name">' + U.esc(lv.name) + (lv.boss ? ' <span class="lr-boss">BOSS</span>' : '') + '</div>' +
      '<div class="ld-stars">' + starsHtml + '</div>' +
      '</div></div>' +

      '<div class="ld-desc">' + U.esc(locked ? '通过上一战区后解锁' : lv.desc) + '</div>' +

      '<div class="ld-meta">' +
      meta('地图难度', '<span class="lv-diffs">' + diff + '</span>') +
      meta('波次', lv.waves + ' 波') +
      meta('敌人血量', '×' + lv.hpMul) +
      meta('敌人速度', '×' + lv.spMul) +
      meta('起始资金', '⬢ ' + lv.startGold) +
      meta('基地耐久', '◈ ' + lv.lives) +
      (rec.best ? meta('最佳记录', U.fmtTime(rec.best)) : '') +
      meta('挑战次数', (rec.plays || 0) + ' 次') +
      '</div>' +

      '<div class="ld-rules">' +
      '<div class="ld-rules-t">★ 评星规则（每关最多 3 星，12 关共 36 星）</div>' +
      '<div class="ld-rules-b">' +
      '<span><b>★</b> 完成战区</span>' +
      '<span><b>★★</b> 基地耐久剩余 ≥ 70%</span>' +
      '<span><b>★★★</b> 限时内通关</span>' +
      '</div></div>' +

      (locked
        ? '<button class="btn btn-lg" disabled>🔒 尚未解锁</button>'
        : '<button class="btn btn-primary btn-lg" data-ld-start>开始防御 ▶</button>');

    detail.innerHTML = html;

    var btn = detail.querySelector('[data-ld-start]');
    if (btn) {
      btn.addEventListener('click', function () {
        NB.Audio.play('uiClick');
        NB.UI.Setup.open(lv.id);
      });
    }
  }

  function meta(k, v) {
    return '<div class="ld-meta-row"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
  }

})(window);
