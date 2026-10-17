/* ============================================================
   main.js — 启动入口
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U, Save = NB.Save, Audio = NB.Audio, FX = NB.FX, R = NB.Render;

  var BOOT_LINES = [
    '初始化量子防御矩阵 <b>OK</b>',
    '加载敌方单位数据库 <b>OK</b>',
    '校准战术地形网格 <b>OK</b>',
    '编译粒子特效管线 <b>OK</b>',
    '同步指挥中心存档 <b>OK</b>',
    '战术系统就绪 <b>READY</b>'
  ];

  function boot() {
    var log = U.$('#bootLog');
    if (log) {
      var html = '';
      for (var i = 0; i < BOOT_LINES.length; i++) {
        html += '<div>' + BOOT_LINES[i] + '</div>';
      }
      log.innerHTML = html;
    }

    /* 1. 存档 */
    Save.load();

    /* 2. 应用设置 */
    var s = Save.get().settings;
    Audio.applySettings(s);
    FX.setQuality(s.quality);
    R.setQuality(s.quality);

    /* 3. 绑定 UI */
    NB.UI.bind();
    NB.UI.sidePanelBind();
    NB.UI.buildBarBind();
    NB.UI.shopBind();
    NB.UI.levelsBind();
    NB.UI.progressBind();
    NB.UI.settingsBind();
    NB.UI.Setup.bind();
    NB.UI.Saves.bind();
    NB.Router.init();

    /* 4. 游戏引擎 */
    NB.Game.init();

    /* 5. 进入按钮 */
    var btn = U.$('#btnBoot');
    if (btn) {
      btn.addEventListener('click', function () {
        Audio.unlock();
        Audio.play('uiClick');
        NB.Router.go('menu');
        Audio.playMusic('menu');
      });
    }
  }

  function autoAudioUnlock() {
    /* 兼容：某些浏览器需要在首次交互时解锁 */
    var unlock = function () {
      Audio.unlock();
      if (NB.Router.current() !== 'boot') Audio.playMusic(NB.Router.current() === 'game' ? 'battle' : 'menu');
      w.removeEventListener('pointerdown', unlock);
      w.removeEventListener('keydown', unlock);
    };
    w.addEventListener('pointerdown', unlock);
    w.addEventListener('keydown', unlock);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(); autoAudioUnlock(); });
  } else {
    boot(); autoAudioUnlock();
  }

  /* 全局错误兜底：不让单次异常打断游戏循环 */
  w.addEventListener('error', function (e) {
    console.error('[NB]', e.error || e.message);
  });

})(window);
