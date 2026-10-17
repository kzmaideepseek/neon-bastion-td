/* ============================================================
   buildbar.js — 左侧建造栏（竖向滚动）
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U, C = NB.CFG, Save = NB.Save;
  var UI = NB.UI;

  var el = null;

  UI.buildBarBind = function () {
    el = U.$('#buildbar');
    UI.keepBuild = true;
  };

  UI.buildBarRender = function () {
    if (!el) return;
    var st = NB.Game.state;
    if (!st) return;
    var endless = !!st.endless;
    var html = '';
    /* 铲子：置顶，PVZ 式移除（不返还资金） */
    var shSel = NB.Game.shovelMode ? ' sel' : '';
    html +=
      '<div class="bb-item bb-shovel' + shSel + '" data-tower="__shovel" ' +
      'title="铲子：点击战场上的炮塔直接移除（不返还资金）">' +
      '<span class="bb-key">Q</span>' +
      '<span class="bb-ico" style="color:#c8d8e8">⛏</span>' +
      '<span class="bb-body">' +
      '<span class="bb-nm">铲子</span>' +
      '<span class="bb-pr">移除 · 无返还</span>' +
      '</span></div>';
    /* 双开夹具：让一个格子可以建第二座炮塔 */
    var stSel = NB.Game.stackMode ? ' sel' : '';
    html +=
      '<div class="bb-item bb-stack' + stSel + '" data-tower="__stack" ' +
      'title="双开夹具：点击已有炮塔的格子，之后即可在该格建造第二座炮塔">' +
      '<span class="bb-key">E</span>' +
      '<span class="bb-ico" style="color:#c8e6ff">⛭</span>' +
      '<span class="bb-body">' +
      '<span class="bb-nm">双开夹具</span>' +
      '<span class="bb-pr">同格叠加 · 免费</span>' +
      '</span></div>';
    for (var i = 0; i < C.TOWER_ORDER.length; i++) {
      var id = C.TOWER_ORDER[i];
      var d = C.TOWERS[id];
      var cost = C.TOWER_COST[id];
      /* 无尽模式自动解锁全部炮塔 */
      var has = endless || Save.hasTower(id);
      var sel = NB.Game.buildType === id;
      var poor = has && st.gold < cost;
      var cls = 'bb-item';
      if (sel) cls += ' sel';
      if (!has) cls += ' locked';
      else if (poor) cls += ' poor';

      html +=
        '<div class="' + cls + '" data-tower="' + id + '" data-cost="' + cost + '" title="' + U.esc(d.name) + '：' + U.esc(d.desc) + '">' +
        '<span class="bb-key">' + (i < 9 ? (i + 1) : 0) + '</span>' +
        '<span class="bb-ico" style="color:' + d.color + '">' + d.icon + '</span>' +
        '<span class="bb-body">' +
        '<span class="bb-nm">' + U.esc(d.name) +
        (d.flying ? '<i class="bb-move" title="空中单位：选中后点击空格即可转移">移动</i>' : '') +
        '</span>' +
        '<span class="bb-pr">' + (has ? '⬢ ' + cost : '未授权') +
        (d.flying ? ' · <i class="bb-air">空中</i>' : '') + '</span>' +
        '</span>' +
        (has ? '' : '<span class="bb-lock">商城</span>') +
        '</div>';
    }
    el.innerHTML = html;

    U.$$('[data-tower]', el).forEach(function (n) {
      n.addEventListener('click', function () {
        var id = n.getAttribute('data-tower');
        if (id === '__shovel') { NB.Game.toggleShovel(); return; }
        if (id === '__stack') { NB.Game.toggleStack(); return; }
        var st2 = NB.Game.state;
        if (!(st2 && st2.endless) && !Save.hasTower(id)) {
          NB.Audio.play('uiDenied');
          UI.toast('该炮塔尚未授权，请前往军械商城', 'rd', 2000);
          return;
        }
        NB.Game.selectBuild(id);
      });
    });

    /* 选中项滚入可视区 */
    var sel = el.querySelector('.bb-item.sel');
    if (sel && sel.scrollIntoView) {
      try { sel.scrollIntoView({ block: 'nearest' }); } catch (e) { /* 旧浏览器忽略 */ }
    }
    syncLastGold = st ? st.gold : -1;
  };

  /* 实时同步：金币/选中态变化时立刻更新各项可点状态（不重建 DOM，零成本） */
  var syncLastGold = -1;
  UI.buildBarSync = function () {
    if (!el) return;
    var st = NB.Game.state;
    if (!st) return;
    var endless = !!st.endless;
    var changed = syncLastGold !== st.gold;
    if (!changed && syncLastGold === st.gold) {
      /* 金币没变也要检查选中态（建造/铲子/双开切换） */
    }
    syncLastGold = st.gold;
    var items = el.querySelectorAll('.bb-item[data-tower]');
    for (var i = 0; i < items.length; i++) {
      var nd = items[i];
      var id = nd.getAttribute('data-tower');
      if (id === '__shovel') {
        nd.classList.toggle('sel', !!NB.Game.shovelMode);
        continue;
      }
      if (id === '__stack') {
        nd.classList.toggle('sel', !!NB.Game.stackMode);
        continue;
      }
      var cost = parseInt(nd.getAttribute('data-cost'), 10) || 0;
      var has = endless || Save.hasTower(id);
      var sel = NB.Game.buildType === id;
      var poor = has && st.gold < cost;
      var cls = 'bb-item';
      if (sel) cls += ' sel';
      if (!has) cls += ' locked';
      else if (poor) cls += ' poor';
      /* 只有变化时才写 class，避免无谓的样式重算 */
      var want = cls.replace(/ /g, '');
      if (nd.className.replace(/ /g, '') !== want) nd.className = cls;
    }
  };

})(window);
