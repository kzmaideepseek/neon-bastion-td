/* ============================================================
   hud.js — 顶部状态栏 / 波次条 / 提示条 / 波次横幅 / 模态
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U, C = NB.CFG, Save = NB.Save;
  var UI = NB.UI = NB.UI || {};

  var el = {};

  UI.bind = function () {
    el.lives = U.$('#hudLives');
    el.livesBar = U.$('#hudLivesBar');
    el.gold = U.$('#hudGold');
    el.waveTxt = U.$('#hudWaveTxt');
    el.fpsNum = U.$('#fpsNum');
    el.fpsQ = U.$('#fpsQ');
    el.fpsBox = U.$('#fpsBox');
    el.perfNotice = U.$('#perfNotice');
    el.levelNo = U.$('#hudLevelNo');
    el.levelName = U.$('#hudLevelName');
    el.diff = U.$('#hudDiff');
    el.spawns = U.$('#hudSpawns');
    el.saveBtn = U.$('#btnSave');
    el.rewindBtn = U.$('#btnRewind');
    el.speedBtn = U.$('#btnSpeed');
    el.pauseBtn = U.$('#btnPause');
    el.toast = U.$('#toast-layer');
    el.banner = U.$('#wave-banner');
    el.bannerNum = U.$('#wbNum');
    el.bannerName = U.$('#wbName');
    el.nextBox = U.$('#nextwave-box');
    el.nextTimer = U.$('#nwTimer');
    el.nextBonus = U.$('#nwBonus');
    el.modal = U.$('#modal-layer');
    el.modalBox = U.$('#modalBox');
  };

  /* ============================================================
     HUD 同步
     ============================================================ */
  UI.hudSync = function () {
    var st = NB.Game.state;
    if (!st) return;
    var lv = st.level;
    var endless = !!st.endless;

    /* 关卡号：闯关显示编号，无尽显示 ∞ */
    el.levelNo.textContent = endless ? '∞' : ((lv.id < 10 ? '0' : '') + lv.id);
    el.levelName.textContent = lv.name;
    /* 难度标签（HUD 关卡名右侧） */
    if (st.difficulty) {
      if (el.diff) {
        el.diff.textContent = st.difficulty.name;
        el.diff.style.color = st.difficulty.color;
        el.diff.title = st.difficulty.desc;
      }
    }
    /* 保存按钮：仅无尽模式可用 */
    if (el.saveBtn) el.saveBtn.classList.toggle('hidden', !endless);
    /* 逆转按钮：仅无尽模式可用 */
    if (el.rewindBtn) el.rewindBtn.classList.toggle('hidden', !endless);
    /* 入口数标签 */
    if (el.spawns) {
      if (endless && st.activeSpawns && st.activeSpawns.length > 1) {
        el.spawns.textContent = '入口 ×' + st.activeSpawns.length;
        el.spawns.classList.remove('hidden');
        el.spawns.title = '已打通 ' + st.activeSpawns.length + ' 个敌人入口（每个额外入口使每波资金 +20%）';
      } else {
        el.spawns.classList.add('hidden');
      }
    }
    /* 建造栏实时同步：金币一够就立刻变为可选 */
    if (NB.UI.buildBarSync) NB.UI.buildBarSync();

    el.lives.textContent = st.lives;
    el.gold.textContent = U.fmtFull(st.gold);
    /* 波次显示：无尽「第 N 波」，闯关「第 N / M 波」 */
    if (el.waveTxt) {
      el.waveTxt.textContent = endless
        ? (st.waveNo > 0 ? '第 ' + st.waveNo + ' 波' : '待出击')
        : '第 ' + Math.max(0, st.waveIndex + 1) + ' / ' + st.waves.length + ' 波';
    }
    el.livesBar.style.width = U.clamp(st.lives / st.maxLives, 0, 1) * 100 + '%';
    el.speedBtn.textContent = st.speed + '×';
    el.speedBtn.classList.toggle('on', st.speed > 1);
    el.pauseBtn.textContent = st.status === 'paused' ? '继续' : '暂停';
  };

  UI.hudFlash = function (which) {
    var node = which === 'life' ? el.lives.parentNode : el.gold.parentNode;
    if (!node) return;
    node.classList.remove('flash');
    void node.offsetWidth;
    node.classList.add('flash');
  };

  /* ============================================================
     下一波提示
     ============================================================ */
  UI.nextWaveShow = function (st) {
    if (!st || st.status !== 'playing') { UI.nextWaveHide(); return; }
    if (st.waveIndex >= st.waves.length - 1) { UI.nextWaveHide(); return; }
    el.nextBox.classList.remove('hidden');
    el.nextBonus.textContent = '+' + Math.max(0, Math.round(st.nextWaveT * 6));
  };
  UI.nextWaveHide = function () { el.nextBox.classList.add('hidden'); };
  UI.nextWaveTick = function (st) {
    if (el.nextBox.classList.contains('hidden')) return;
    el.nextTimer.textContent = Math.max(0, st.nextWaveT).toFixed(1);
    el.nextBonus.textContent = '+' + Math.max(0, Math.round(st.nextWaveT * 6));
  };

  /* ============================================================
     波次横幅
     ============================================================ */
  var bannerTimer = 0;
  UI.waveBanner = function (n, name, isBoss) {
    if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = 0; }
    el.bannerNum.textContent = n;
    el.bannerName.textContent = name || '';
    el.banner.classList.remove('hidden');
    el.banner.classList.remove('show');
    void el.banner.offsetWidth;
    el.banner.classList.add('show');
    if (isBoss) {
      el.bannerNum.style.filter = 'hue-rotate(300deg) drop-shadow(0 0 30px rgba(255,61,110,.9))';
    } else {
      el.bannerNum.style.filter = '';
    }
    /* 动画结束（1.9s）后强制隐藏，避免任何残留 */
    bannerTimer = w.setTimeout(function () {
      bannerTimer = 0;
      el.banner.classList.remove('show');
      el.banner.classList.add('hidden');
    }, 1950);
  };

  UI.waveClear = function (n, reward) {
    UI.toast('第 ' + n + ' 波清除  +' + reward + ' ⬢', 'gr', 1700);
    NB.Audio.play('waveClear');
  };

  /* ============================================================
     帧率 / 画质指示
     ============================================================ */
  var QNAME = ['高', '中', '低', '简'];
  var lastQ = -1, lastFps = -1;

  UI.fpsTick = function (perf) {
    if (!el.fpsNum || !perf) return;
    /* 用缓动值显示，避免数字逐帧跳动造成的视觉噪声与误读 */
    var shown = Math.round(perf._disp != null ? perf._disp : perf.fps);
    if (shown !== lastFps) {
      lastFps = shown;
      el.fpsNum.textContent = shown;
      var c = shown >= 55 ? 'ok' : (shown >= 40 ? 'warn' : 'bad');
      el.fpsNum.className = 'fps-num ' + c;
    }
    if (perf.tier !== lastQ || (el.fpsQ && el.fpsQ.dataset.auto !== String(perf.auto))) {
      lastQ = perf.tier;
      if (el.fpsQ) {
        el.fpsQ.dataset.auto = String(perf.auto);
        el.fpsQ.textContent = (perf.auto ? '自动·' : '手动·') + QNAME[perf.tier] || '';
      }
    }
    if (el.fpsBox) {
      el.fpsBox.dataset.tier = String(perf.tier);
      el.fpsBox.dataset.auto = String(perf.auto);
    }
    /* 画质一有变化就同步常驻说明（不靠计时器，帧率回升即自动消失） */
    paintNotice(false);
  };

  /* ============================================================
     性能提示（自动降特效时告知玩家做了什么）
     —— 刻意做得安静：贴在 FPS 框下方，自动消失，不抢焦点
     ============================================================ */
  var TIER_TAG = ['', '中', '低', '简'];
  /* ============================================================
     画质说明（常驻）
     ------------------------------------------------------------
     只要画质不是「高」，这块就一直挂在 FPS 旁边，告诉玩家
     画面被简化了哪些部分 —— 直到帧率回升、画质回到「高」才消失。
     不做成几秒就消失的 toast：塔的样子变了，玩家必须能随时知道原因。
     ============================================================ */
  var noticePinned = false;
  var shownTier = -1;

  /* 每档具体被简化了什么 —— 常驻展示用 */
  var TIER_DETAIL = [
    '',
    '粒子密度与装饰光效已降低',
    '粒子降至 30%，装饰动画与叠加光效关闭',
    '炮塔简化为指向标记，全部装饰动画关闭'
  ];

  function paintNotice(force) {
    if (!el.perfNotice) return;
    var P = NB.Perf;
    var tier = P ? P.tier : 0;
    if (tier === shownTier && !force) return;
    shownTier = tier;
    if (tier === 0) {
      el.perfNotice.classList.add('hidden');
      return;
    }
    var auto = P.auto;
    el.perfNotice.innerHTML =
      '<i class="pn-tag">' + (TIER_TAG[tier] || '中') + '画质</i>' +
      '<span class="pn-body">' +
      '<b>为保帧率已简化</b>' + U.esc(TIER_DETAIL[tier] || '') +
      '<br><span class="pn-sub">' +
      (auto ? '帧率回升到 56 以上会自动恢复原样'
            : '当前为手动锁定，恢复自动后可随时升降') +
      '</span></span>' +
      '<button class="pn-x" type="button" title="点击固定显示">固定</button>';
    el.perfNotice.classList.remove('hidden');
    el.perfNotice.classList.toggle('pinned', noticePinned);
    var bx = el.perfNotice.querySelector('.pn-x');
    if (bx) {
      bx.textContent = noticePinned ? '取消固定' : '固定';
      bx.addEventListener('click', function (e) {
        e.stopPropagation();
        noticePinned = !noticePinned;
        paintNotice(true);
      });
    }
  }
  UI.perfNotice = function () { paintNotice(true); };

      /* 点击循环：自动 -> 高 -> 中 -> 低 -> 自动 */
  if (el.fpsBox) {
    el.fpsBox.addEventListener('click', function () {
      var P = NB.Perf;
      if (!P) return;
      if (P.auto) { P.setAuto(false); P.setTier(0); }
      else if (P.tier === 0) { P.setTier(1); }
      else if (P.tier === 1) { P.setTier(2); }
      else if (P.tier === 2) { P.setTier(3); }
      else { P.setAuto(true); }
      P._cool = 3;
      NB.Audio.play('uiClick');
      paintNotice(true);
      UI.fpsTick(P);
    });
  }

  /* ============================================================
     Toast
     ============================================================ */
  var toastQ = [];
  UI.toast = function (msg, kind, dur) {
    dur = dur || 1600;
    if (toastQ.length > 4) { var old = toastQ.shift(); if (old.parentNode) old.parentNode.removeChild(old); }
    var t = U.el('div', 'toast ' + (kind || ''), U.esc(msg));
    el.toast.appendChild(t);
    toastQ.push(t);
    w.setTimeout(function () {
      t.classList.add('out');
      w.setTimeout(function () {
        if (t.parentNode) t.parentNode.removeChild(t);
        var i = toastQ.indexOf(t);
        if (i >= 0) toastQ.splice(i, 1);
      }, 320);
    }, dur);
  };

  /* ============================================================
     模态框
     ============================================================ */
  UI.modalShow = function (html, opts) {
    opts = opts || {};
    el.modalBox.innerHTML = html;
    el.modal.classList.remove('hidden');
    el.modal.classList.toggle('soft', !!opts.soft);
    UI._modalLive = !!opts.live;
    return el.modalBox;
  };
  UI.modalHide = function () {
    el.modal.classList.add('hidden');
    el.modalBox.innerHTML = '';
    UI._modalLive = false;
  };
  UI.modalVisible = function () { return !el.modal.classList.contains('hidden'); };
  UI.pulseModal = function () { /* 暂停时保持静态 */ };

  /* ---------- 结算 ---------- */
  UI.resultModal = function (st) {
    var r = st.result;
    if (!r) return;
    var html = '';

    /* ---- 无尽模式失守：专属结算（记录最高波数） ---- */
    if (st.endless) {
      var best = Save.endlessBest();
      var newBest = (r.wave || 0) >= (best.wave || 0) && (r.wave || 0) > 0;
      html =
        '<div class="md-ico">☠</div>' +
        '<div class="md-title lose">防线失守</div>' +
        '<div class="md-sub">无尽模式 · 作战难度 ' + U.esc(st.difficulty.name) +
        ' · 坚持到第 ' + (r.wave || 1) + ' 波</div>' +
        (newBest ? '<div class="md-sub" style="color:#ffc93c;margin-bottom:14px">★ 新纪录！历史最佳第 ' +
          (r.wave || 1) + ' 波</div>' : '') +
        '<div class="md-rows">' +
        row('坚持波数', '第 ' + (r.wave || 1) + ' 波') +
        row('历史最佳', '第 ' + (best.wave || 0) + ' 波') +
        row('击杀数', r.kills) +
        row('坚持时间', U.fmtTime(r.time)) +
        row('部署炮塔', r.towers) +
        '</div>' +
        '<div class="md-acts">' +
        '<button class="btn btn-primary" data-act="endlessRetry">再次挑战</button>' +
        (st.saveSlot ? '<button class="btn" data-act="endlessLoad">读取存档继续</button>' : '') +
        '<button class="btn" data-act="endlessManager">存档管理</button>' +
        '<button class="btn btn-ghost" data-act="menu">返回主菜单</button>' +
        '</div>';
      var box2 = UI.modalShow(html);
      U.$$('[data-act]', box2).forEach(function (b) {
        b.addEventListener('click', function () {
          NB.Audio.play('uiClick');
          var a = b.getAttribute('data-act');
          if (a === 'endlessRetry') {
            UI.modalHide();
            NB.Game.start(0, {
              endless: true, layout: st.map.key, variant: st.variant,
              difficulty: st.difficulty.key
            });
            NB.Router.go('game');
          } else if (a === 'endlessLoad') {
            UI.modalHide();
            NB.Game.start(0, { endless: true, save: st.saveSlot });
            NB.Router.go('game');
          } else if (a === 'endlessManager') {
            NB.UI.saveManager(function () { NB.Game.abort(); });
          } else {
            NB.Game.abort();
          }
        });
      });
      return;
    }

    if (r.win) {
      var starHtml = '<b>★</b>';
      for (var i = 1; i < r.stars; i++) starHtml += '<b>★</b>';
      for (var j = r.stars; j < 3; j++) starHtml += '<span>★</span>';
      var lifePct = Math.round(r.lifePct * 100);
      html =
        '<div class="md-ico">🏆</div>' +
        '<div class="md-title win">战区肃清</div>' +
        '<div class="md-sub">' + U.esc(st.level.name) + ' · 地图难度 ' + st.level.diff +
        ' · 作战难度 ' + U.esc(st.difficulty.name) + '</div>' +
        '<div class="md-stars">' + starHtml + '</div>' +
        '<div class="md-rows">' +
        row('击杀数', r.kills) +
        row('用时', U.fmtTime(r.time) + ' / 目标 ' + U.fmtTime(r.targetTime), r.time <= r.targetTime) +
        row('基地耐久', lifePct + '%', r.s2) +
        row('部署炮塔', r.towers) +
        row('造成伤害', U.fmtFull(Math.round(r.damage))) +
        '</div>' +
        '<div class="md-row" style="border-color:rgba(255,194,74,.5);background:rgba(50,36,8,.5)">' +
        '<span class="k">晶币收入' + (r.firstClear ? '（首通 ×1.5）' : '') + '</span>' +
        '<span class="v gd">◈ +' + r.cores + '</span></div>' +
        '<div class="md-acts">' +
        '<button class="btn btn-primary" data-act="retry">再次挑战</button>' +
        '<button class="btn" data-act="next">下一战区</button>' +
        '<button class="btn btn-ghost" data-act="menu">返回主菜单</button>' +
        '</div>';
    } else {
      html =
        '<div class="md-ico">💀</div>' +
        '<div class="md-title lose">防线失守</div>' +
        '<div class="md-sub">' + U.esc(st.level.name) + ' · 坚持到第 ' + (r.wave || 1) + ' 波</div>' +
        '<div class="md-rows">' +
        row('击杀数', r.kills) +
        row('坚持时间', U.fmtTime(r.time)) +
        row('部署炮塔', r.towers) +
        '</div>' +
        '<div class="md-row" style="border-color:rgba(255,194,74,.4)">' +
        '<span class="k">回收晶币</span><span class="v gd">◈ +' + r.cores + '</span></div>' +
        '<div class="md-acts">' +
        '<button class="btn btn-primary" data-act="retry">重新部署</button>' +
        '<button class="btn btn-ghost" data-act="menu">返回主菜单</button>' +
        '</div>';
    }
    var box = UI.modalShow(html);
    /* 星星音效 */
    if (r.win) {
      for (var s = 0; s < r.stars; s++) {
        (function (k) { w.setTimeout(function () { NB.Audio.play('star'); void k; }, 380 + k * 190); })(s);
      }
    }
    U.$$('[data-act]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        NB.Audio.play('uiClick');
        var a = b.getAttribute('data-act');
        if (a === 'retry') { UI.modalHide(); NB.Game.start(st.level.id); NB.Router.go('game'); }
        else if (a === 'next') {
          UI.modalHide();
          var nxt = st.level.id + 1;
          if (nxt > C.LEVELS.length) { NB.Game.abort(); return; }
          if (!Save.level(st.level.id).clear) { NB.Game.abort(); return; }
          NB.Game.start(nxt); NB.Router.go('game');
        }
        else NB.Game.abort();
      });
    });
    void box;
  };

  function row(k, v, good) {
    return '<div class="md-row"><span class="k">' + k + '</span><span class="v' +
      (good === true ? ' gr' : (good === false ? '' : '')) + '">' + v + '</span></div>';
  }

  /* ---------- 拆除确认 ---------- */
  UI.confirmSell = function (tw, value, pct) {
    var html =
      '<div class="md-ico">⚙</div>' +
      '<div class="md-title pause">拆除炮塔</div>' +
      '<div class="md-sub">' + U.esc(tw.def.name) + ' · LV ' + tw.level + '</div>' +
      '<div class="md-row" style="margin-bottom:18px">' +
      '<span class="k">返还金额</span><span class="v gd">⬢ ' + value + '（' + pct + '% 造价）</span></div>' +
      '<div class="md-acts">' +
      '<button class="btn btn-danger" data-act="yes">确认拆除</button>' +
      '<button class="btn btn-primary" data-act="no">保留</button>' +
      '</div>' +
      '<div class="sp-note" style="margin-top:10px">快捷键：X 或 右键</div>';
    var box = UI.modalShow(html);
    U.$$('[data-act]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        NB.Audio.play(b.getAttribute('data-act') === 'yes' ? 'uiClick' : 'uiBack');
        if (b.getAttribute('data-act') === 'yes') NB.Game.sellTower(tw);
        UI.modalHide();
      });
    });
  };

  /* ---------- 暂停 ---------- */
  UI.pauseModal = function (st) {
    if (UI.modalVisible() && el.modalBox.getAttribute('data-pause') === '1') return;
    var endless = !!st.endless;
    var waveTxt = endless
      ? '第 ' + st.waveNo + ' 波（无尽）'
      : '第 ' + (st.waveIndex + 1) + ' / ' + st.waves.length + ' 波';
    var html =
      '<div class="md-ico">⏸</div>' +
      '<div class="md-title pause">战术暂停</div>' +
      '<div class="md-sub">' + U.esc(st.level.name) + ' · ' + waveTxt + '</div>' +
      '<div class="md-rows">' +
      '<div class="md-row"><span class="k">战场资金</span><span class="v gd">⬢ ' + U.fmtFull(st.gold) + '</span></div>' +
      '<div class="md-row"><span class="k">基地耐久</span><span class="v cy">◈ ' + st.lives + ' / ' + st.maxLives + '</span></div>' +
      '<div class="md-row"><span class="k">击杀总数</span><span class="v">' + st.kills + '</span></div>' +
      '<div class="md-row"><span class="k">已用时间</span><span class="v">' + U.fmtTime(st.playTime) + '</span></div>' +
      '</div>' +
      '<div class="md-acts">' +
      '<button class="btn btn-primary" data-act="resume">继续作战</button>' +
      '<button class="btn" data-act="speed">切换速度 ' + st.speed + '×</button>' +
      (endless ? '<button class="btn" data-act="save">保存进度</button>' : '') +
      (endless ? '<button class="btn" data-act="rewind">⏪ 逆转</button>' : '') +
      (endless ? '<button class="btn" data-act="saves">存档管理</button>' : '') +
      '<button class="btn btn-danger" data-act="quit">撤退</button>' +
      '</div>';
    var box = UI.modalShow(html);
    box.setAttribute('data-pause', '1');
    U.$$('[data-act]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-act');
        NB.Audio.play('uiClick');
        if (a === 'resume') { NB.Game.togglePause(); }
        else if (a === 'speed') { NB.Game.toggleSpeed(); UI.modalHide(); UI.pauseModal(NB.Game.state); }
        else if (a === 'save') { box.removeAttribute('data-pause'); NB.UI.saveInGame(); }
        else if (a === 'rewind') { UI.modalHide(); UI.rewindModal(); }
        else if (a === 'saves') { box.removeAttribute('data-pause'); NB.UI.saveManager(); }
        else if (a === 'quit') { box.removeAttribute('data-pause'); NB.Game.state.status = 'playing'; UI.modalHide(); NB.Game.quit(); }
      });
    });
  };

  /* ---------- 逆转（回溯）弹窗 ---------- */
  UI.rewindModal = function () {
    var st = NB.Game.state;
    if (!st || !st.endless) return;
    var list = NB.Game.rewindList();
    var left = NB.Game.rewindLeft();
    var html =
      '<div class="md-ico">⏪</div>' +
      '<div class="md-title pause">时空逆转</div>' +
      '<div class="md-sub">回到 5 分钟内的任意时间点 · 剩余次数 ' + left + ' / 3</div>';
    if (!list.length) {
      html += '<div class="sv-empty">暂无可回溯的时间点（需要先进行约 2.5 秒）</div>';
    } else {
      html += '<div class="rw-list">';
      /* 只显示最近 24 个点（1 分钟粒度太密，抽稀显示） */
      var step = Math.max(1, Math.ceil(list.length / 24));
      for (var i = 0; i < list.length; i += step) {
        var it = list[i];
        html +=
          '<div class="rw-row" data-rw="' + it.idx + '">' +
          '<span class="rw-ago">-' + it.ago + 's</span>' +
          '<span class="rw-wave">第 ' + it.waveNo + ' 波</span>' +
          '<span class="rw-gold">⬢ ' + U.fmtFull(it.gold) + '</span>' +
          '<span class="rw-life">◈ ' + it.lives + '</span>' +
          '</div>';
      }
      html += '</div>';
      html += '<div class="md-note">回溯后敌人生成序列将与原来完全一致（波次由种子确定性生成）</div>';
    }
    html +=
      '<div class="md-acts">' +
      '<button class="btn" data-act="close">关闭</button>' +
      '</div>';
    var box = UI.modalShow(html);
    U.$$('[data-rw]', box).forEach(function (row) {
      row.addEventListener('click', function () {
        var idx = parseInt(row.getAttribute('data-rw'), 10);
        NB.Audio.play('uiClick');
        if (NB.Game.rewindTo(idx)) UI.modalHide();
      });
    });
    U.$$('[data-act]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        NB.Audio.play('uiClick');
        UI.modalHide();
      });
    });
  };

  /* ---------- 撤退确认 ---------- */
  UI.confirmQuit = function (st) {
    var endless = !!st.endless;
    var html =
      '<div class="md-ico">⚠</div>' +
      '<div class="md-title pause">确认撤退？</div>' +
      '<div class="md-sub">' + (endless
        ? '无尽模式进度将自动保存到当前存档（第 ' + st.waveNo + ' 波）'
        : '当前战区进度不会保存') + '</div>' +
      '<div class="md-acts">' +
      '<button class="btn btn-primary" data-act="stay">继续作战</button>' +
      '<button class="btn btn-danger" data-act="go">撤退</button>' +
      '</div>';
    var box = UI.modalShow(html);
    U.$$('[data-act]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        NB.Audio.play('uiClick');
        if (b.getAttribute('data-act') === 'stay') {
          UI.modalHide();
          if (st.status === 'paused') NB.Game.togglePause();
        } else {
          UI.modalHide();
          NB.Game.abort();
        }
      });
    });
  };

  /* ============================================================
     主菜单统计
     ============================================================ */
  UI.renderMenuStats = function () {
    var d = Save.get();
    var box = U.$('#menuStats');
    if (!box) return;
    var stars = Save.totalStars(), maxS = Save.maxStars();
    var cleared = Save.clearCount(), total = C.LEVELS.length;
    var kills = d.stats.kills || 0;
    var towers = d.stats.towers || 0;
    var wins = d.stats.wins || 0, losses = d.stats.losses || 0;
    var rate = (wins + losses > 0) ? Math.round(wins / (wins + losses) * 100) + '%' : '—';

    var items = [
      { k: '晶币余额', v: U.fmtFull(d.cores), cls: 'gd' },
      { k: '战区进度', v: cleared + ' / ' + total, cls: 'cy' },
      /* 星级说明写清楚：12 关 × 每关最多 3 星 */
      { k: '通关评星', v: stars + ' / ' + maxS, cls: 'cy', tip: '每关最多 3 星，通关得 1 星；基地耐久≥70% 再得 1 星；限时通关再得 1 星。12 关共 36 星。' },
      { k: '无尽最佳', v: '第 ' + (Save.endlessBest().wave || 0) + ' 波', cls: '', tip: '无尽模式历史最高波数' },
      { k: '累计击杀', v: U.fmt(kills), cls: '', tip: '历史上击毁的全部敌人数量' },
      { k: '累计建造', v: U.fmt(towers), cls: '', tip: '历史上建造过的炮塔总数' },
      { k: '战斗胜率', v: rate, cls: '', tip: '胜利 ' + wins + ' 场 / 失败 ' + losses + ' 场' }
    ];

    box.innerHTML = items.map(function (i) {
      return '<div class="mstat ' + i.cls + '"' + (i.tip ? ' title="' + U.esc(i.tip) + '"' : '') + '>' +
        '<span class="k">' + i.k + '</span><span class="v">' + i.v + '</span></div>';
    }).join('');

    var foot = U.$('#menuFootInfo');
    if (foot) foot.textContent = 'NEON BASTION v1.0 · 存档：' + (Save.available() ? '本地浏览器' : '内存（不可持久）');
  };

})(window);
