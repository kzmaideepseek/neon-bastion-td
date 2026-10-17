/* ============================================================
   saves.js — 无尽模式存档管理
   · 存档列表（读取 / 重命名 / 删除）
   · 新建存档命名输入
   · 战斗中手动保存（保存到当前槽 / 另存新槽）
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U, C = NB.CFG, Save = NB.Save;
  var UI = NB.UI;

  var M = UI.Saves = {};

  M.bind = function () { /* 模态按需创建，无需预绑定 */ };

  function layoutName(key) {
    var names = {
      A: '边境开阔带', B: '峡谷隘口', C: '霓虹都市', D: '废弃矿场',
      E: '反应堆外围', F: '冰封渡口', G: '轨道电梯', H: '量子实验室',
      I: '深空要塞', J: '虫巢母舰', K: '湮灭之环', L: '母星核心'
    };
    return names[key] || key;
  }
  function diffName(key) {
    var d = C.DIFFICULTIES[key];
    return d ? d.name : '标准';
  }
  function timeAgo(ts) {
    if (!ts) return '—';
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return s + ' 秒前';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    return Math.floor(s / 86400) + ' 天前';
  }

  /* ============================================================
     存档管理列表
     ============================================================ */
  M.manager = function (onClose) {
    render(onClose);
  };
  UI.saveManager = M.manager;

  function render(onClose) {
    var slots = Save.endlessSlots();
    var html =
      '<div class="md-ico">💾</div>' +
      '<div class="md-title pause">无尽存档管理</div>' +
      '<div class="md-sub">本地保存 · 可读取 / 重命名 / 删除</div>';

    /* 新建行 */
    html += '<div class="sv-new">' +
      '<input class="sv-input" id="svNewName" type="text" maxlength="24" placeholder="新存档名称">' +
      '<button class="btn btn-sm btn-primary" data-sv="create">新建</button></div>';

    if (!slots.length) {
      html += '<div class="sv-empty">暂无存档。在无尽模式中每通过一波会自动保存，也可在暂停菜单手动保存。</div>';
    } else {
      html += '<div class="sv-list">';
      for (var i = 0; i < slots.length; i++) {
        var s = slots[i];
        html += '<div class="sv-row" data-id="' + s.id + '">' +
          '<div class="sv-info">' +
          '<div class="sv-name">' + U.esc(s.name || '无尽存档') + '</div>' +
          '<div class="sv-meta">' + layoutName(s.layout) + ' · ' + diffName(s.difficulty) +
          ' · 第 <b>' + (s.waveNo || 0) + '</b> 波 · 击杀 ' + (s.kills || 0) +
          ' · ' + timeAgo(s.updated) + '</div>' +
          '</div>' +
          '<div class="sv-acts">' +
          '<button class="btn btn-sm btn-primary" data-sv="load">读取</button>' +
          '<button class="btn btn-sm" data-sv="rename">重命名</button>' +
          '<button class="btn btn-sm btn-danger" data-sv="delete">删除</button>' +
          '</div></div>';
      }
      html += '</div>';
    }

    html += '<div class="md-acts">' +
      '<button class="btn btn-ghost" data-sv="close">关闭</button></div>';

    var box = UI.modalShow(html);
    box.setAttribute('data-saves', '1');

    /* 新建 */
    var input = box.querySelector('#svNewName');
    if (input) input.value = '无尽存档 ' + (Save.endlessSlotCount() + 1);

    U.$$('[data-sv]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-sv');
        NB.Audio.play('uiClick');
        if (act === 'close') {
          UI.modalHide();
          if (onClose) onClose();
        } else if (act === 'create') {
          var nm = (input && input.value || '').trim() || ('无尽存档 ' + (Save.endlessSlotCount() + 1));
          /* 从配置页新建：用当前配置直接开局 */
          var cfg = NB.UI.Setup.get();
          var id = Save.endlessCreate(nm, {
            layout: cfg.layout || 'A', variant: cfg.variant || 0,
            difficulty: cfg.difficulty || 'normal', waveNo: 0, kills: 0
          });
          UI.modalHide();
          NB.Game.start(0, {
            endless: true, layout: cfg.layout || 'A', variant: cfg.variant || 0,
            difficulty: cfg.difficulty || 'normal', newSlot: id
          });
          NB.Router.go('game');
          NB.Game.saveEndless(id);
          NB.UI.toast('已创建存档「' + nm + '」· 第 1 波', 'cy', 2200);
        } else {
          var row = b.closest('.sv-row');
          var id2 = row ? row.getAttribute('data-id') : null;
          if (!id2) return;
          if (act === 'load') {
            UI.modalHide();
            loadSlot(id2);
          } else if (act === 'rename') {
            renamePrompt(id2, render.bind(null, onClose));
          } else if (act === 'delete') {
            deleteConfirm(id2, render.bind(null, onClose));
          }
        }
      });
    });
  }

  function loadSlot(id) {
    var slot = Save.endlessSlot(id);
    if (!slot) { UI.toast('存档不存在', 'rd', 1600); return; }
    NB.Game.start(0, { endless: true, save: id });
    NB.Router.go('game');
    NB.UI.toast('已读取存档「' + (slot.name || '') + '」· 第 ' +
      (slot.waveNo || 0) + ' 波', 'cy', 2200);
  }

  /* ============================================================
     重命名 / 删除确认
     ============================================================ */
  function renamePrompt(id, done) {
    var slot = Save.endlessSlot(id);
    if (!slot) return;
    var html =
      '<div class="md-ico">✎</div>' +
      '<div class="md-title pause">重命名存档</div>' +
      '<div class="sv-new" style="justify-content:center;margin:16px 0 20px">' +
      '<input class="sv-input" id="svRenameInput" type="text" maxlength="24" value="' +
      U.esc(slot.name || '') + '"></div>' +
      '<div class="md-acts">' +
      '<button class="btn btn-primary" data-rn="ok">确认</button>' +
      '<button class="btn btn-ghost" data-rn="no">取消</button></div>';
    var box = UI.modalShow(html);
    var inp = box.querySelector('#svRenameInput');
    if (inp) { inp.focus(); inp.select(); }
    U.$$('[data-rn]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        NB.Audio.play('uiClick');
        if (b.getAttribute('data-rn') === 'ok') {
          var nm = (inp && inp.value || '').trim();
          if (nm) {
            Save.endlessRename(id, nm);
            UI.toast('已重命名为「' + nm + '」', 'gd', 1600);
          }
        }
        if (done) done(); else UI.modalHide();
      });
    });
  }

  function deleteConfirm(id, done) {
    var slot = Save.endlessSlot(id);
    if (!slot) return;
    var html =
      '<div class="md-ico">🗑</div>' +
      '<div class="md-title lose">删除存档</div>' +
      '<div class="md-sub">「' + U.esc(slot.name || '') + '」· 第 ' + (slot.waveNo || 0) + ' 波</div>' +
      '<div class="md-rows"><div class="md-row"><span class="k">提示</span>' +
      '<span class="v">删除后无法恢复</span></div></div>' +
      '<div class="md-acts">' +
      '<button class="btn btn-danger" data-del="yes">确认删除</button>' +
      '<button class="btn btn-primary" data-del="no">取消</button></div>';
    var box = UI.modalShow(html);
    U.$$('[data-del]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        NB.Audio.play('uiClick');
        if (b.getAttribute('data-del') === 'yes') {
          Save.endlessDelete(id);
          UI.toast('存档已删除', 'rd', 1600);
          /* 若删除的正是当前对局绑定的槽位，解绑 */
          var g = NB.Game.state;
          if (g && g.saveSlot === id) g.saveSlot = null;
        }
        if (done) done(); else UI.modalHide();
      });
    });
  }

  /* ============================================================
     命名输入（新开局用）
     ============================================================ */
  M.namePrompt = function (title, def, onConfirm) {
    var html =
      '<div class="md-ico">💾</div>' +
      '<div class="md-title pause">' + U.esc(title || '存档命名') + '</div>' +
      '<div class="md-sub">为该无尽存档取个名字，之后可随时读取</div>' +
      '<div class="sv-new" style="justify-content:center;margin:16px 0 20px">' +
      '<input class="sv-input" id="svNameInput" type="text" maxlength="24" value="' +
      U.esc(def || '') + '"></div>' +
      '<div class="md-acts">' +
      '<button class="btn btn-primary" data-np="ok">开始防御 ▶</button>' +
      '<button class="btn btn-ghost" data-np="no">取消</button></div>';
    var box = UI.modalShow(html);
    var inp = box.querySelector('#svNameInput');
    if (inp) { inp.focus(); inp.select(); }
    var ok = function () {
      NB.Audio.play('uiClick');
      var nm = (inp && inp.value || '').trim() || def || '无尽存档';
      UI.modalHide();
      if (onConfirm) onConfirm(nm);
    };
    U.$$('[data-np]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.getAttribute('data-np') === 'ok') ok();
        else { NB.Audio.play('uiBack'); UI.modalHide(); }
      });
    });
    if (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); ok(); }
      });
    }
  };
  UI.saveNamePrompt = M.namePrompt;

  /* ============================================================
     战斗中手动保存
     ============================================================ */
  M.saveInGame = function () {
    var st = NB.Game.state;
    if (!st || !st.endless) { UI.toast('仅无尽模式支持存档', 'rd', 1600); return; }
    if (st.saveSlot) {
      NB.Game.saveEndless(st.saveSlot);
      UI.toast('进度已保存 · 第 ' + st.waveNo + ' 波', 'gd', 1800);
    } else {
      M.namePrompt('保存进度 · 存档命名', '无尽存档 ' + (Save.endlessSlotCount() + 1), function (nm) {
        NB.Game.saveEndless(null, nm);
        UI.toast('进度已保存 · 第 ' + st.waveNo + ' 波', 'gd', 1800);
      });
    }
  };
  UI.saveInGame = M.saveInGame;

})(window);
