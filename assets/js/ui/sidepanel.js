/* ============================================================
   sidepanel.js — 炮塔详情 / 升级 / 出售 面板
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U, C = NB.CFG, Save = NB.Save;
  var UI = NB.UI;

  var el = null, cur = null;

  UI.sidePanelBind = function () {
    el = U.$('#side-panel');
  };
  /* 建造模式保持：放置后不自动取消，可连续建造；右键 / Esc / 点空地取消 */

  UI.sidePanelHide = function () {
    if (!el) return;
    el.classList.add('hidden');
    el.innerHTML = '';
    cur = null;
  };

  UI.sidePanelShow = function (tw) {
    if (!el) return;
    if (!tw) { UI.sidePanelHide(); return; }
    cur = tw;
    el.classList.remove('hidden');
    render(tw);
  };

  var TARGET_MODES = [
    { k: 'first', n: '最前' },
    { k: 'last', n: '最后' },
    { k: 'strong', n: '最强' },
    { k: 'close', n: '最近' }
  ];

  function render(tw) {
    var moveMode = !!(NB.Game.moveMode && NB.Game.selected === tw);
    var st = NB.Game.state;
    if (!st) return;
    var d = tw.def;
    var s = tw.stats();
    var maxed = tw.level >= d.maxLevel;
    var up = tw.upCost();
    var canUp = !maxed && st.gold >= up;
    var sell = tw.sellValue();
    var mode = tw.targetMode || 'first';

    var dmgLv2 = tw.totalDmgAt(tw.level + 1);
    var rateLv2 = tw.totalRateAt(tw.level + 1);
    var rangeLv2 = tw.totalRangeAt(tw.level + 1);
    /* 全图射程塔（轨道轰炸）：射程那一行直接写「全图」，
       写 46.00 格对玩家没有任何信息量，还会让人以为能继续涨。 */
    var mapDiag = Math.sqrt(C.GRID_W * C.GRID_W + C.GRID_H * C.GRID_H);
    var fullMap = (s.range / C.CELL) >= mapDiag - 0.5;

    var html =
      '<div class="sp-head">' +
      '<div class="sp-icon" style="color:' + d.color + ';border-color:' + U.rgba(d.color, .55) + '">' + d.icon + '</div>' +
      '<div><div class="sp-name">' + U.esc(d.name) + '</div>' +
      '<div class="sp-lv">LV ' + tw.level + ' / ' + d.maxLevel + '</div></div>' +
      '</div>' +
      '<div class="sp-body">' +
      '<div class="sp-stats">' +
      statRow('伤害', fmtDmg(s.dmg), maxed ? null : fmtDmg(dmgLv2)) +
      statRow('射速', s.rate.toFixed(2) + '/s', maxed ? null : rateLv2.toFixed(2) + '/s') +
      statRow('射程', fullMap ? '全图' : (s.range / C.CELL).toFixed(2), maxed || fullMap ? null : rangeLv2.toFixed(2)) +
      (s.armorPen ? statRow('破甲', Math.round(s.armorPen * 100) + '%', null) : '') +
      (s.slow ? statRow('减速', Math.round(s.slow * 100) + '%', null) : '') +
      (s.pull ? statRow('拖回力', '-' + s.pull.toFixed(0) + ' px/s', null) : '') +
      (s.dot ? statRow('流血', (s.dot * 10).toFixed(1) + '/s', null) : '') +
      (s.chain ? statRow('连锁目标', s.chain + ' 个', null) : '') +
      (s.cone ? statRow('扇形张角', Math.round(s.cone * 57.3) + '°', null) : '') +
      (s.blast ? statRow('爆炸半径', (s.blast / C.CELL).toFixed(2), null) : '') +
      (s.units ? statRow('无人机数', s.units + ' 架', null) : '') +
      (tw.kind === 'dronebay'
        ? statRow('在编无人机', (tw.droneAlive ? tw.droneAlive() : 0) + ' / 5 架' +
          (tw.respawnT > 0 ? '（补充中…）' : '（满编）'), null) +
        statRow('单架威力', fmtDmg(s.dmg) + '（母舰本体不发弹）', null)
        : '') +
      (s.healRate ? statRow('修复速率', '+' + s.healRate.toFixed(0) + '/s', null) : '') +
      (s.income ? statRow('资金产出', '+' + s.income.toFixed(0) + '/s', null) : '') +
      (s.boost ? statRow('增伤光环', '+' + Math.round(s.boost * 100) + '%', null) +
                  statRow('增速光环', '+' + Math.round(s.boostRate * 100) + '%', null) : '') +
      (tw._bonus ? statRow('当前增幅', '+' + Math.round(tw._bonus.dmg * 100) + '% 伤害', null) : '') +
      '</div>' +
      '<div class="sp-target">' +
      '<div class="sp-target-lb">目标优先级</div>' +
      '<div class="sp-tgts">' +
      TARGET_MODES.map(function (m) {
        return '<div class="sp-tg' + (m.k === mode ? ' on' : '') + '" data-tg="' + m.k + '">' + m.n + '</div>';
      }).join('') +
      '</div></div>' +
      '<div class="sp-kills">累计击杀 ' + tw.kills + ' · 伤害 ' + U.fmt(tw.damageDone) +
      ' · 装甲 ' + Math.ceil(tw.hp) + '/' + Math.round(tw.maxHp) +
      (tw.jamT > 0 ? ' · <span style="color:#b06ae0">被干扰 ' + tw.jamT.toFixed(1) + 's</span>' : '') +
      (tw._bonus ? ' · <span style="color:#ffc93c">信标增幅中</span>' : '') +
      '</div>' +
      '<div class="sp-acts">' +
      (maxed
        ? '<button class="btn btn-sm" disabled>已达最高等级</button>'
        : '<button class="btn sp-up' + (canUp ? ' btn-primary' : '') + '" data-act="up"' + (canUp ? '' : ' disabled') + '>' +
        '<span>升级至 LV ' + (tw.level + 1) + '</span><span class="pc">⬢ ' + up + '</span></button>' +
        (tw.level < d.maxLevel - 1
          ? '<button class="btn btn-sm" data-act="upmax"' + (st.gold >= up ? '' : ' disabled') + '>连升到可行等级</button>'
          : '')) +
      (tw.flying
        ? '<button class="sp-move" data-act="move"' + (tw.buildT > 0 ? ' disabled' : '') + '>' +
        (moveMode ? '■ 退出转移模式（Esc）' : '▲ 进入转移模式 · 点空格飞过去') + '</button>'
        : '') +
      '<button class="btn btn-sm btn-danger" data-act="sell">拆除 ⬢ ' + sell + '（' + Math.round(C.sellRate() * 100) + '%）</button>' +
      '</div>' +
      '<div class="sp-note">' +
      (tw.flying ? 'U 升级 · 左键点空格转移 · X 拆除' : 'U 升级 · X 拆除 · 右键快速查看') +
      '</div>' +
      '</div>';

    el.innerHTML = html;

    /* 事件 */
    var upBtn = U.$('[data-act=up]', el);
    if (upBtn) upBtn.addEventListener('click', function () { NB.Game.upgradeTower(cur); });
    var mxBtn = U.$('[data-act=upmax]', el);
    if (mxBtn) mxBtn.addEventListener('click', function () { NB.Game.upgradeMax(cur); });
    var sellBtn = U.$('[data-act=sell]', el);
    if (sellBtn) sellBtn.addEventListener('click', function () { NB.Game.sellTower(cur); });
    var mvBtn = U.$('[data-act=move]', el);
    if (mvBtn) mvBtn.addEventListener('click', function () {
      NB.Game.toggleMoveMode();
      render(cur);
    });
    U.$$('[data-tg]', el).forEach(function (t) {
      t.addEventListener('click', function () {
        cur.targetMode = t.getAttribute('data-tg');
        NB.Audio.play('uiClick');
        render(cur);
      });
    });
  }

  function statRow(k, v, up) {
    return '<div class="sp-stat"><span class="k">' + k + '</span><span class="v">' + v +
      (up != null && up !== v ? '<span class="up">→ ' + up + '</span>' : '') + '</span></div>';
  }

  function fmtDmg(n) {
    if (n >= 1000) return (n / 1000).toFixed(2) + 'k';
    if (n >= 100) return Math.round(n).toString();
    return n.toFixed(1);
  }

})(window);
