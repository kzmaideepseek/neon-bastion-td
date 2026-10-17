/* ============================================================
   shop.js — 军械商城（炮塔授权 + 天赋）
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U, C = NB.CFG, Save = NB.Save;
  var UI = NB.UI;

  var body = null, coresEl = null;
  var tab = 'towers';

  UI.shopBind = function () {
    body = U.$('#shopBody');
    coresEl = U.$('#shopCores');
    U.$$('#scr-shop .tab').forEach(function (t) {
      t.addEventListener('click', function () {
        U.$$('#scr-shop .tab').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        tab = t.getAttribute('data-tab');
        NB.Audio.play('uiClick');
        render();
      });
    });
  };

  UI.shopRender = function () {
    if (!body) return;
    if (coresEl) coresEl.textContent = '◈ ' + U.fmtFull(Save.get().cores);
    render();
  };

  function render() {
    if (tab === 'towers') renderTowers();
    else renderTalents();
  }

  /* ---------------- 炮塔授权 ---------------- */
  function renderTowers() {
    var cores = Save.get().cores;
    var html = '<div class="shop-grid">';
    for (var i = 0; i < C.TOWER_ORDER.length; i++) {
      var id = C.TOWER_ORDER[i];
      var d = C.TOWERS[id];
      var owned = Save.hasTower(id);
      var afford = cores >= d.unlockCost;

      var tag = owned ? '<span class="sc-tag t3">已授权</span>'
        : (d.free ? '<span class="sc-tag t1">初始装备</span>'
          : '<span class="sc-tag t2">需授权</span>');

      html +=
        '<div class="shop-card' + (owned ? ' owned' : '') + '">' +
        '<div class="sc-icon" style="color:' + d.color + '">' + d.icon + '</div>' +
        '<div class="sc-main">' +
        '<div class="sc-name">' + U.esc(d.name) + ' ' + tag + '</div>' +
        '<div class="sc-desc">' + U.esc(d.desc) + '</div>' +
        '<div class="sc-stats">' +
        '<span>伤害 <b>' + d.base.dmg + '</b></span>' +
        '<span>射速 <b>' + d.base.rate.toFixed(2) + '/s</b></span>' +
        '<span>射程 <b>' + d.base.range.toFixed(1) + '</b></span>' +
        '<span>造价 <b>' + C.TOWER_COST[id] + '⬢</b></span>' +
        '<span>上限 <b>LV' + d.maxLevel + '</b></span>' +
        '</div>' +
        '<div class="sc-foot">' +
        (owned
          ? '<span class="sc-price" style="color:#8fe6b4">已解锁</span>'
          : '<span class="sc-price' + (afford ? '' : ' no') + '">◈ ' + d.unlockCost + '</span>') +
        (owned
          ? ''
          : '<button class="btn btn-sm' + (afford ? ' btn-primary' : '') + '" data-buy="' + id + '"' + (afford ? '' : ' disabled') + '>' +
          (afford ? '授权解锁' : '晶币不足') + '</button>') +
        '</div></div></div>';
    }
    html += '</div>';
    body.innerHTML = html;

    U.$$('[data-buy]', body).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-buy');
        var d = C.TOWERS[id];
        if (Save.get().cores < d.unlockCost) { NB.Audio.play('uiDenied'); return; }
        Save.addCores(-d.unlockCost);
        Save.get().unlocked.push(id);
        Save.save(true);
        NB.Audio.play('buy');
        UI.toast('已授权：' + d.name, 'gd', 2200);
        UI.shopRender();
      });
    });
  }

  /* ---------------- 天赋 ---------------- */
  function renderTalents() {
    var cores = Save.get().cores;
    var html = '<div class="shop-grid">';
    for (var i = 0; i < C.TALENT_ORDER.length; i++) {
      var k = C.TALENT_ORDER[i];
      var t = C.TALENTS[k];
      var lv = Save.talent(k);
      var maxed = lv >= t.max;
      var cost = maxed ? 0 : Math.round(t.costBase * Math.pow(t.costMul, lv));
      var afford = !maxed && cores >= cost;

      var lvDots = '';
      for (var j = 0; j < t.max; j++) {
        lvDots += '<i class="' + (j < lv ? 'on' : '') + '"></i>';
      }

      html +=
        '<div class="shop-card' + (maxed ? ' maxed' : (lv > 0 ? ' owned' : '')) + '">' +
        '<div class="sc-icon" style="color:' + (maxed ? '#ffc93c' : '#4fe3ff') + '">' + t.icon + '</div>' +
        '<div class="sc-main">' +
        '<div class="sc-name">' + U.esc(t.name) +
        (maxed ? '<span class="sc-tag t3">满级</span>' : '<span class="sc-tag t1">LV ' + lv + '/' + t.max + '</span>') +
        '</div>' +
        '<div class="sc-desc">' + U.esc(t.desc) + '</div>' +
        '<div class="sc-perk">效果：' + U.esc(t.perk) + '</div>' +
        '<div class="sc-stats" style="margin-top:8px"><span class="sc-lv">' + lvDots + '</span></div>' +
        '<div class="sc-foot">' +
        (maxed
          ? '<span class="sc-price" style="color:#8fe6b4">已完成</span>'
          : '<span class="sc-price' + (afford ? '' : ' no') + '">◈ ' + cost + '</span>') +
        (maxed ? '' :
          '<button class="btn btn-sm' + (afford ? ' btn-primary' : '') + '" data-talent="' + k + '"' + (afford ? '' : ' disabled') + '>' +
          (afford ? '强化' : '晶币不足') + '</button>') +
        '</div></div></div>';
    }
    html += '</div>';
    body.innerHTML = html;

    U.$$('[data-talent]', body).forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-talent');
        var t = C.TALENTS[k];
        var lv = Save.talent(k);
        if (lv >= t.max) { NB.Audio.play('uiDenied'); return; }
        var cost = Math.round(t.costBase * Math.pow(t.costMul, lv));
        if (Save.get().cores < cost) { NB.Audio.play('uiDenied'); return; }
        Save.addCores(-cost);
        Save.get().talents[k] = lv + 1;
        Save.save(true);
        NB.Audio.play('upgrade');
        UI.toast(t.name + ' 提升至 LV ' + (lv + 1), 'gd', 1800);
        UI.shopRender();
      });
    });
  }

})(window);
