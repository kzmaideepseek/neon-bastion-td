/* ============================================================
   settings.js — 系统设置
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U, Save = NB.Save, Audio = NB.Audio, FX = NB.FX, R = NB.Render;
  var UI = NB.UI;

  var body = null;
  UI.settingsBind = function () { body = U.$('#settingsBody'); };

  UI.settingsRender = function () {
    if (!body) return;
    var s = Save.get().settings;

    body.innerHTML =
      row('主音量', 'Master', s.master, 'master') +
      row('背景音乐', 'BGM', s.bgm, 'bgm') +
      row('音效', 'SFX', s.sfx, 'sfx') +
      toggleRow('画面震动', '受击与爆炸时的屏幕震动', 'shake', s.shake) +
      selectRow('渲染画质', '低画质会减少粒子数量并关闭部分辉光', 'quality', s.quality,
        [{ v: 'high', n: '高（推荐）' }, { v: 'low', n: '低（省资源）' }]) +

      '<div class="danger-zone">' +
      '<div class="dz-t">数据管理</div>' +
      '<div class="dz-btns">' +
      '<button class="btn btn-sm" data-act="export">导出存档</button>' +
      '<button class="btn btn-sm" data-act="import">导入存档</button>' +
      '<button class="btn btn-sm btn-danger" data-act="wipe">清空全部存档</button>' +
      '</div>' +
      '<div style="margin-top:10px;font-size:11px;color:#536d8f" id="ioMsg"></div>' +
      '</div>';

    /* 滑块 */
    U.$$('[data-vol]', body).forEach(function (r) {
      r.addEventListener('input', function () {
        var k = r.getAttribute('data-vol');
        var v = parseFloat(r.value) / 100;
        Save.get().settings[k] = v;
        Audio.applySettings(Save.get().settings);
        var out = U.$('[data-volv=' + k + ']', body);
        if (out) out.textContent = Math.round(v * 100) + '%';
      });
      r.addEventListener('change', function () { Save.save(); });
    });

    /* 开关 */
    U.$$('[data-tog]', body).forEach(function (n) {
      n.addEventListener('click', function () {
        var k = n.getAttribute('data-tog');
        var v = !Save.get().settings[k];
        Save.get().settings[k] = v;
        n.classList.toggle('on', v);
        n.textContent = v ? '开' : '关';
        Audio.setMuted(k === 'master' && false ? false : false);
        Save.save();
      });
    });

    /* 下拉 */
    U.$$('[data-sel]', body).forEach(function (n) {
      n.addEventListener('click', function () {
        var k = n.getAttribute('data-sel');
        var v = n.getAttribute('data-val');
        Save.get().settings[k] = v;
        if (k === 'quality') {
          FX.setQuality(v);
          R.setQuality(v);
        }
        UI.settingsRender();
        Save.save();
        Audio.play('uiClick');
      });
    });

    /* 数据 */
    U.$$('[data-act]', body).forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-act');
        Audio.play('uiClick');
        var msg = U.$('#ioMsg');
        if (a === 'export') {
          var txt = Save.exportText();
          try {
            w.localStorage.setItem('nb_save_backup', txt);
            if (msg) msg.textContent = '存档已备份到浏览器（nb_save_backup）。共 ' + txt.length + ' 字符。';
            UI.toast('存档已导出备份', 'gr', 2000);
          } catch (e) {
            if (msg) msg.textContent = '导出失败：' + e.message;
          }
        } else if (a === 'import') {
          var t = null;
          try { t = w.localStorage.getItem('nb_save_backup'); } catch (e) { }
          if (!t) {
            if (msg) msg.textContent = '没有找到备份存档。';
            UI.toast('无备份可导入', 'rd', 1800);
          } else if (Save.importText(t)) {
            Audio.applySettings(Save.get().settings);
            UI.settingsRender();
            UI.toast('存档导入成功', 'gr', 2000);
            NB.UI.renderMenuStats();
          } else {
            if (msg) msg.textContent = '导入失败：备份数据格式不正确。';
          }
        } else if (a === 'wipe') {
          Save.reset();
          Audio.applySettings(Save.get().settings);
          UI.settingsRender();
          UI.renderMenuStats();
          UI.toast('存档已清空', 'rd', 2200);
        }
      });
    });
  };

  function row(title, sub, val, key) {
    return '<div class="set-row"><div class="set-lb">' + title +
      '<small>' + sub + '</small></div>' +
      '<input type="range" min="0" max="100" step="1" value="' + Math.round(val * 100) + '" data-vol="' + key + '">' +
      '<span class="set-val" data-volv="' + key + '">' + Math.round(val * 100) + '%</span></div>';
  }

  function toggleRow(title, sub, key, val) {
    return '<div class="set-row"><div class="set-lb">' + title +
      '<small>' + sub + '</small></div>' +
      '<button class="btn btn-sm' + (val ? ' on' : '') + '" data-tog="' + key + '">' + (val ? '开' : '关') + '</button></div>';
  }

  function selectRow(title, sub, key, val, opts) {
    return '<div class="set-row"><div class="set-lb">' + title +
      '<small>' + sub + '</small></div><div style="display:flex;gap:6px">' +
      opts.map(function (o) {
        return '<button class="btn btn-sm' + (o.v === val ? ' on' : '') + '" data-sel="' + key + '" data-val="' + o.v + '">' + o.n + '</button>';
      }).join('') + '</div></div>';
  }

})(window);
