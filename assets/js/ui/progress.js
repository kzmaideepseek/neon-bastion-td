/* ============================================================
   progress.js — 战区进度 / 成就 / 统计
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U, C = NB.CFG, Save = NB.Save;
  var UI = NB.UI;

  var body = null;
  UI.progressBind = function () { body = U.$('#progressBody'); };

  UI.progressRender = function () {
    if (!body) return;
    var d = Save.get();
    var stars = Save.totalStars(), maxS = Save.maxStars();
    var cleared = Save.clearCount(), total = C.LEVELS.length;

    /* 炮塔授权进度 */
    var unlockedCount = d.unlocked.length;
    /* 天赋进度 */
    var talentLv = 0, talentMax = 0;
    for (var i = 0; i < C.TALENT_ORDER.length; i++) {
      var t = C.TALENTS[C.TALENT_ORDER[i]];
      talentLv += Save.talent(t.key);
      talentMax += t.max;
    }
    /* 成就进度 */
    var achKeys = Object.keys(C.ACHIEVEMENTS);
    var achGot = achKeys.filter(function (k) { return d.ach[k]; }).length;

    var html = '';

    /* 总览进度条 */
    html += '<div class="prog-block">';
    html += '<div class="prog-title">总完成度</div>';
    html += bar(stars, maxS, stars + ' / ' + maxS + ' 星');
    html += '</div>';

    html += '<div class="prog-block">';
    html += '<div class="prog-title">战区推进</div>';
    html += bar(cleared, total, cleared + ' / ' + total + ' 战区已肃清', 'mg');
    html += '</div>';

    html += '<div class="prog-block">';
    html += '<div class="prog-title">炮塔授权</div>';
    html += bar(unlockedCount, C.TOWER_ORDER.length, unlockedCount + ' / ' + C.TOWER_ORDER.length + ' 已授权', 'gd');
    html += '</div>';

    html += '<div class="prog-block">';
    html += '<div class="prog-title">天赋强化</div>';
    html += bar(talentLv, talentMax, talentLv + ' / ' + talentMax + ' 级');
    html += '</div>';

    /* 关卡明细 */
    html += '<div class="prog-block"><div class="prog-title">战区明细</div><div class="kv-grid">';
    for (var j = 0; j < C.LEVELS.length; j++) {
      var lv = C.LEVELS[j];
      var rec = Save.level(lv.id);
      var starTxt = '';
      for (var s = 0; s < 3; s++) starTxt += (s < (rec.stars || 0)) ? '★' : '☆';
      html += '<div class="kv">' +
        '<div class="k">' + (lv.id < 10 ? '0' : '') + lv.id + ' ' + U.esc(lv.name) + '</div>' +
        '<div class="v" style="font-size:15px;color:' + (rec.clear ? '#ffc93c' : '#5b7fa5') + '">' +
        (rec.clear ? starTxt : '未通关') +
        (rec.clear && rec.best ? '<span style="font-size:10px;color:#7d99bd;margin-left:6px">' + U.fmtTime(rec.best) + '</span>' : '') +
        '</div></div>';
    }
    html += '</div></div>';

    /* 统计 */
    var wins = d.stats.wins || 0, losses = d.stats.losses || 0;
    html += '<div class="prog-block"><div class="prog-title">战斗统计</div><div class="kv-grid">' +
      kv('累计击杀', U.fmtFull(d.stats.kills || 0)) +
      kv('累计炮塔', U.fmtFull(d.stats.towers || 0)) +
      kv('总伤害', U.fmtFull(Math.round(d.stats.damage || 0))) +
      kv('胜利场次', wins) +
      kv('失败场次', losses) +
      kv('胜率', (wins + losses > 0 ? Math.round(wins / (wins + losses) * 100) : 0) + '%') +
      kv('开局次数', d.plays || 0) +
      kv('持有晶币', U.fmtFull(d.cores)) +
      '</div></div>';

    /* 成就 */
    html += '<div class="prog-block"><div class="prog-title">成就 ' + achGot + ' / ' + achKeys.length + '</div><div class="ach-list">';
    for (var a = 0; a < achKeys.length; a++) {
      var ak = achKeys[a];
      var ac = C.ACHIEVEMENTS[ak];
      var got = !!d.ach[ak];
      html += '<div class="ach' + (got ? ' got' : '') + '">' +
        '<div class="ach-ico">' + ac.icon + '</div>' +
        '<div><div class="ach-nm">' + U.esc(ac.name) + '</div><div class="ach-ds">' + U.esc(ac.desc) + '</div></div>' +
        '</div>';
    }
    html += '</div></div>';

    body.innerHTML = html;
  };

  function bar(cur, max, txt, cls) {
    return '<div class="prog-bar ' + (cls || '') + '"><i style="width:' +
      (max > 0 ? U.clamp(cur / max, 0, 1) * 100 : 0) + '%"></i></div>' +
      '<div class="prog-txt"><span>' + txt + '</span><span>' +
      (max > 0 ? Math.round(U.clamp(cur / max, 0, 1) * 100) : 0) + '%</span></div>';
  }

  function kv(k, v) {
    return '<div class="kv"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  }

})(window);
