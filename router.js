/* ============================================================
   router.js — 界面路由
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U, Audio = NB.Audio;
  var R = NB.Router = {};

  var cur = 'boot';
  var SCREENS = {
    boot: '#scr-boot', menu: '#scr-menu', levels: '#scr-levels',
    shop: '#scr-shop', progress: '#scr-progress', settings: '#scr-settings',
    setup: '#scr-setup', game: '#scr-game'
  };

  R.current = function () { return cur; };

  R.go = function (name) {
    if (!SCREENS[name]) name = 'menu';
    /* 离开游戏页时隐藏侧栏 */
    if (cur === 'game' && name !== 'game' && NB.UI.sidePanelHide) NB.UI.sidePanelHide();

    U.$$('.screen').forEach(function (s) { s.classList.remove('active'); });
    var t = U.$(SCREENS[name]);
    if (t) t.classList.add('active');
    cur = name;

    /* 音乐切换 */
    if (name === 'menu' || name === 'levels' || name === 'shop' || name === 'progress' || name === 'settings' || name === 'setup') {
      Audio.playMusic('menu');
    } else if (name === 'boot') {
      Audio.stopMusic();
    }
    /* game 页音乐由 Game.start 负责（战斗曲），若状态不在则回菜单曲 */

    /* 按页面刷新内容 */
    switch (name) {
      case 'menu': NB.UI.renderMenuStats(); break;
      case 'levels': NB.UI.levelsRender(); break;
      case 'shop': NB.UI.shopRender(); break;
      case 'progress': NB.UI.progressRender(); break;
      case 'settings': NB.UI.settingsRender(); break;
      case 'setup': break;   /* 内容由 Setup.open 渲染 */
      case 'game':
        NB.UI.buildBarRender();
        NB.UI.hudSync();
        NB.Game.resize();
        break;
    }
  };

  R.init = function () {
    /* 统一处理所有 data-back 按钮 */
    U.$$('[data-back]').forEach(function (b) {
      b.addEventListener('click', function () {
        Audio.play('uiBack');
        R.go('menu');
      });
    });

    /* 主菜单按钮 */
    on('#btnPlay', function () { Audio.play('uiClick'); R.go('levels'); });
    on('#btnEndless', function () { Audio.play('uiClick'); NB.UI.Setup.openEndless(); });
    on('#btnShop', function () { Audio.play('uiClick'); R.go('shop'); });
    on('#btnProgress', function () { Audio.play('uiClick'); R.go('progress'); });
    on('#btnSettings', function () { Audio.play('uiClick'); R.go('settings'); });

    /* HUD 按钮 */
    on('#btnPause', function () { NB.Game.togglePause(); });
    on('#btnSpeed', function () { NB.Game.toggleSpeed(); });
    on('#btnSave', function () { NB.UI.saveInGame(); });
    on('#btnRewind', function () { NB.UI.rewindModal(); });
    on('#btnQuit', function () { NB.Game.quit(); });
    on('#btnNextWave', function () { NB.Game.callWaveNow(); });

    /* 按钮悬停音 */
    U.$$('.btn, .tab, .bb-item, .lv-row, .shop-card').forEach(function (n) {
      n.addEventListener('mouseenter', function () {
        if (n.classList.contains('btn')) Audio.play('uiHover');
      });
    });
  };

  function on(sel, fn) {
    var n = U.$(sel);
    if (n) n.addEventListener('click', fn);
  }

})(window);
