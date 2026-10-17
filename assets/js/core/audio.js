/* ============================================================
   audio.js — 程序化音频引擎（WebAudio）
   · 背景音乐：4 首合成曲目（主菜单 / 战斗 / 胜利 / 失败）
   · 音效：射击、爆炸、建造、升级、出售、错误、波次、UI 等
   · 全程零外部资源，纯代码合成
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var A = NB.Audio = {};

  var ctx = null, master = null, comp = null, musicBus = null, sfxBus = null;
  var ready = false, unlocked = false;
  var noiseBuf = null;
  var vol = { master: 0.75, bgm: 0.42, sfx: 0.70 };

  A.ready = function () { return ready; };

  /* ---------------- 初始化 ---------------- */
  A.init = function () {
    if (ctx) return true;
    var AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) { console.warn('[Audio] WebAudio 不可用'); return false; }
    try { ctx = new AC(); } catch (e) { console.warn('[Audio] 创建失败', e); return false; }

    master = ctx.createGain();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 8;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;

    musicBus = ctx.createGain();
    sfxBus = ctx.createGain();
    musicBus.gain.value = vol.bgm;
    sfxBus.gain.value = vol.sfx;

    musicBus.connect(master);
    sfxBus.connect(master);
    master.connect(comp);
    comp.connect(ctx.destination);

    /* 预生成白噪声缓冲 */
    var len = Math.floor(ctx.sampleRate * 1.6);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    applyVol();
    ready = true;
    return true;
  };

  A.unlock = function () {
    if (!ctx) A.init();
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume();
    unlocked = true;
    return ctx.state === 'running';
  };

  function applyVol() {
    if (!master) return;
    var m = vol.master;
    master.gain.value = m * m * 0.9;
    if (musicBus) musicBus.gain.value = vol.bgm;
    if (sfxBus) sfxBus.gain.value = vol.sfx;
  }

  A.setVolume = function (k, v) {
    v = Math.max(0, Math.min(1, v));
    vol[k] = v;
    applyVol();
  };
  A.volumes = function () { return { master: vol.master, bgm: vol.bgm, sfx: vol.sfx }; };
  A.applySettings = function (s) {
    if (!s) return;
    if (typeof s.master === 'number') vol.master = s.master;
    if (typeof s.bgm === 'number') vol.bgm = s.bgm;
    if (typeof s.sfx === 'number') vol.sfx = s.sfx;
    applyVol();
  };

  var muted = false;
  A.setMuted = function (m) {
    muted = !!m;
    if (master) master.gain.value = muted ? 0 : vol.master * vol.master * 0.9;
  };
  A.isMuted = function () { return muted; };

  /* ---------------- 基础发声单元 ---------------- */
  function now() { return ctx.currentTime; }

  /* 单振荡器音符 */
  function tone(opt) {
    if (!ready || muted) return;
    var t0 = now() + (opt.delay || 0);
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = opt.type || 'sine';
    osc.frequency.setValueAtTime(opt.f0, t0);
    if (opt.f1 != null) {
      if (opt.exp === false) osc.frequency.linearRampToValueAtTime(Math.max(1, opt.f1), t0 + opt.dur);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, opt.f1), t0 + opt.dur);
    }
    if (opt.detune) osc.detune.value = opt.detune;

    var peak = opt.gain == null ? 0.2 : opt.gain;
    var atk = opt.atk == null ? 0.006 : opt.atk;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + atk);
    if (opt.sus != null) {
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * opt.sus), t0 + opt.dur * 0.6);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opt.dur);

    var node = osc;
    if (opt.filter) {
      var f = ctx.createBiquadFilter();
      f.type = opt.filter;
      f.frequency.setValueAtTime(opt.fc0 == null ? 1200 : opt.fc0, t0);
      if (opt.fc1 != null) f.frequency.exponentialRampToValueAtTime(Math.max(40, opt.fc1), t0 + opt.dur);
      f.Q.value = opt.q == null ? 1 : opt.q;
      node.connect(f); f.connect(g);
    } else node.connect(g);
    g.connect(opt.bus || sfxBus);
    osc.start(t0);
    osc.stop(t0 + opt.dur + 0.03);
  }

  /* 噪声爆（打击/爆炸） */
  function noise(opt) {
    if (!ready || muted) return;
    var t0 = now() + (opt.delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = opt.rate || 1;
    var f = ctx.createBiquadFilter();
    f.type = opt.filter || 'bandpass';
    f.frequency.setValueAtTime(opt.fc0 == null ? 900 : opt.fc0, t0);
    if (opt.fc1 != null) f.frequency.exponentialRampToValueAtTime(Math.max(40, opt.fc1), t0 + opt.dur);
    f.Q.value = opt.q == null ? 0.9 : opt.q;
    var g = ctx.createGain();
    var peak = opt.gain == null ? 0.18 : opt.gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (opt.atk == null ? 0.004 : opt.atk));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opt.dur);
    src.connect(f); f.connect(g); g.connect(opt.bus || sfxBus);
    src.start(t0);
    src.stop(t0 + opt.dur + 0.03);
  }

  /* ---------------- 音效库 ---------------- */
  var SFX = {
    uiHover: function () { tone({ type: 'sine', f0: 1400, f1: 1700, dur: 0.05, gain: 0.035, exp: false }); },
    uiClick: function () {
      tone({ type: 'square', f0: 900, f1: 1500, dur: 0.06, gain: 0.07, exp: false });
      noise({ fc0: 3000, fc1: 6000, dur: 0.05, gain: 0.035, q: 1.4 });
    },
    uiBack: function () { tone({ type: 'square', f0: 700, f1: 380, dur: 0.09, gain: 0.07, exp: false }); },
    uiDenied: function () {
      tone({ type: 'square', f0: 220, f1: 150, dur: 0.13, gain: 0.10, exp: false, filter: 'lowpass', fc0: 1400, fc1: 600 });
      tone({ type: 'square', f0: 165, f1: 110, dur: 0.16, gain: 0.08, exp: false, delay: 0.09 });
    },
    buy: function () {
      var n = [784, 988, 1319];
      for (var i = 0; i < n.length; i++) tone({ type: 'triangle', f0: n[i], dur: 0.14, gain: 0.11, delay: i * 0.055 });
      noise({ fc0: 5200, fc1: 9000, dur: 0.16, gain: 0.03, q: 1.1, delay: 0.02 });
    },
    build: function () {
      tone({ type: 'square', f0: 300, f1: 900, dur: 0.13, gain: 0.13, exp: false, filter: 'lowpass', fc0: 900, fc1: 4200 });
      tone({ type: 'sine', f0: 160, f1: 70, dur: 0.2, gain: 0.16 });
      noise({ fc0: 1400, fc1: 400, dur: 0.15, gain: 0.09, filter: 'lowpass' });
    },
    upgrade: function () {
      var n = [523, 659, 784, 1047];
      for (var i = 0; i < n.length; i++) {
        tone({ type: 'triangle', f0: n[i], dur: 0.16, gain: 0.10, delay: i * 0.05 });
        tone({ type: 'sine', f0: n[i] * 2, dur: 0.11, gain: 0.045, delay: i * 0.05 });
      }
      noise({ fc0: 3000, fc1: 8000, dur: 0.3, gain: 0.035, q: 0.8, delay: 0.08 });
    },
    shovel: function () {
      noise({ fc0: 1400, fc1: 260, dur: 0.16, gain: 0.07, q: 0.8 });
      tone({ type: 'triangle', f0: 220, f1: 90, dur: 0.14, gain: 0.06, filter: 'lowpass', fc0: 900, fc1: 300 });
    },
    shootGas: function () {
      noise({ fc0: 700, fc1: 1900, dur: 0.34, gain: 0.045, filter: 'bandpass', q: 0.9 });
    },
    shootGravity: function () {
      tone({ type: 'sine', f0: 460, f1: 130, dur: 0.34, gain: 0.06, filter: 'lowpass', fc0: 1200, fc1: 320 });
    },
    shootOrbital: function () {
      tone({ type: 'sine', f0: 90, f1: 620, dur: 0.5, gain: 0.07, filter: 'lowpass', fc0: 300, fc1: 1800 });
      noise({ fc0: 200, fc1: 1400, dur: 0.42, gain: 0.05, filter: 'bandpass', q: 0.8 });
    },
    shootStorm: function () {
      noise({ fc0: 1800, fc1: 900, dur: 0.1, gain: 0.05, filter: 'highpass', q: 0.7 });
      tone({ type: 'square', f0: 1400, f1: 700, dur: 0.08, gain: 0.03, filter: 'bandpass', fc0: 2000, fc1: 900 });
    },
    shootSniper: function () {
      tone({ type: 'sawtooth', f0: 1700, f1: 240, dur: 0.16, gain: 0.09, filter: 'lowpass', fc0: 4200, fc1: 520 });
      noise({ fc0: 2600, fc1: 500, dur: 0.12, gain: 0.06, q: 1.1 });
    },
    sell: function () {
      var n = [880, 660, 440, 330];
      for (var i = 0; i < n.length; i++) tone({ type: 'triangle', f0: n[i], dur: 0.13, gain: 0.09, delay: i * 0.045 });
    },
    shootPlasma: function () {
      tone({ type: 'sawtooth', f0: 1150, f1: 380, dur: 0.11, gain: 0.075, filter: 'lowpass', fc0: 3200, fc1: 700 });
      noise({ fc0: 2400, fc1: 900, dur: 0.07, gain: 0.04, q: 1.2 });
    },
    shootRail: function () {
      tone({ type: 'square', f0: 1500, f1: 190, dur: 0.2, gain: 0.13, exp: false, filter: 'lowpass', fc0: 4200, fc1: 500 });
      tone({ type: 'sine', f0: 200, f1: 48, dur: 0.3, gain: 0.17 });
      noise({ fc0: 1800, fc1: 240, dur: 0.22, gain: 0.1, filter: 'lowpass' });
    },
    shootFrost: function () {
      tone({ type: 'sine', f0: 620, f1: 1500, dur: 0.16, gain: 0.05, exp: false });
      tone({ type: 'triangle', f0: 1550, f1: 2400, dur: 0.14, gain: 0.032, exp: false, delay: 0.02 });
      noise({ fc0: 6000, fc1: 9000, dur: 0.2, gain: 0.028, q: 2.2 });
    },
    shootTesla: function () {
      noise({ fc0: 3800, fc1: 1200, dur: 0.13, gain: 0.075, q: 3.2 });
      tone({ type: 'square', f0: 2400, f1: 900, dur: 0.1, gain: 0.05, exp: false });
    },
    shootArc: function () {
      tone({ type: 'square', f0: 780, f1: 2100, dur: 0.16, gain: 0.06, exp: false, filter: 'bandpass', fc0: 1800, fc1: 4200, q: 2.4 });
      noise({ fc0: 2200, fc1: 5200, dur: 0.14, gain: 0.045, q: 2.8 });
    },
    shootMissile: function () {
      noise({ fc0: 500, fc1: 2200, dur: 0.3, gain: 0.06, q: 0.7 });
      tone({ type: 'sawtooth', f0: 260, f1: 700, dur: 0.28, gain: 0.05, exp: false, filter: 'lowpass', fc0: 800, fc1: 2400 });
    },
    hit: function () { noise({ fc0: 2600, fc1: 1200, dur: 0.05, gain: 0.028, q: 1.6 }); },
    shootLance: function () {
      /* 持续灼烧的高频嗡鸣 */
      tone({ type: 'sawtooth', f0: 1750, f1: 2450, dur: 0.16, gain: 0.05, exp: false, filter: 'bandpass', fc0: 2200, fc1: 3800, q: 3.4 });
      noise({ fc0: 4200, fc1: 6800, dur: 0.14, gain: 0.035, q: 2.6 });
      tone({ type: 'sine', f0: 320, f1: 220, dur: 0.14, gain: 0.05 });
    },
    shootSpike: function () {
      /* 地刺弹起 + 电击 */
      tone({ type: 'square', f0: 240, f1: 1400, dur: 0.08, gain: 0.05, exp: false });
      noise({ fc0: 3200, fc1: 1400, dur: 0.11, gain: 0.04, q: 2.8 });
      tone({ type: 'sine', f0: 90, f1: 55, dur: 0.12, gain: 0.09 });
    },
    shootBeacon: function () {
      /* 信标充能：上行琶音 */
      tone({ type: 'sine', f0: 420, f1: 900, dur: 0.30, gain: 0.05, exp: false });
      tone({ type: 'triangle', f0: 630, f1: 1350, dur: 0.28, gain: 0.032, exp: false, delay: 0.05 });
    },
    shootSwarm: function () {
      /* 微型无人机：短促高频啁啾 */
      tone({ type: 'square', f0: 2100, f1: 1450, dur: 0.055, gain: 0.035, exp: false });
      noise({ fc0: 5000, fc1: 2600, dur: 0.06, gain: 0.022, q: 2.2 });
    },
    shieldBreak: function () {
      noise({ fc0: 3400, fc1: 700, dur: 0.32, gain: 0.10, q: 1.1 });
      tone({ type: 'triangle', f0: 900, f1: 220, dur: 0.3, gain: 0.07 });
    },
    healPulse: function () {
      tone({ type: 'sine', f0: 560, f1: 900, dur: 0.24, gain: 0.045, exp: false });
      tone({ type: 'sine', f0: 840, f1: 1320, dur: 0.20, gain: 0.028, exp: false, delay: 0.06 });
    },
    jam: function () {
      tone({ type: 'square', f0: 320, f1: 90, dur: 0.3, gain: 0.075, filter: 'lowpass', fc0: 1800, fc1: 420 });
      noise({ fc0: 800, fc1: 200, dur: 0.26, gain: 0.055, filter: 'bandpass', q: 1.6 });
    },
    meleeHit: function () {
      /* 金属撞击 + 液压撕扯 */
      noise({ fc0: 1800, fc1: 400, dur: 0.14, gain: 0.085, q: 1.3 });
      tone({ type: 'square', f0: 620, f1: 180, dur: 0.11, gain: 0.055, exp: false });
      tone({ type: 'triangle', f0: 150, f1: 70, dur: 0.16, gain: 0.075, delay: 0.03 });
    },
    towerDown: function () {
      /* 炮塔损毁：金属坍塌 */
      noise({ fc0: 2200, fc1: 120, dur: 0.55, gain: 0.16, filter: 'lowpass', q: 0.7 });
      tone({ type: 'sawtooth', f0: 260, f1: 45, dur: 0.5, gain: 0.11, filter: 'lowpass', fc0: 900, fc1: 130 });
      tone({ type: 'square', f0: 90, f1: 40, dur: 0.6, gain: 0.08, filter: 'lowpass', fc0: 400, fc1: 90, delay: 0.1 });
    },
    repairWork: function () {
      /* 焊枪：持续高频嘶嘶 */
      noise({ fc0: 5200, fc1: 6400, dur: 0.10, gain: 0.030, q: 3.0 });
    },
    explodeSmall: function () {
      noise({ fc0: 1400, fc1: 160, dur: 0.26, gain: 0.13, filter: 'lowpass', q: 0.7 });
      tone({ type: 'sine', f0: 220, f1: 42, dur: 0.28, gain: 0.15 });
    },
    explodeBig: function () {
      noise({ fc0: 2000, fc1: 90, dur: 0.6, gain: 0.19, filter: 'lowpass', q: 0.6 });
      tone({ type: 'sine', f0: 170, f1: 30, dur: 0.7, gain: 0.22 });
      tone({ type: 'sawtooth', f0: 90, f1: 24, dur: 0.5, gain: 0.09, filter: 'lowpass', fc0: 500, fc1: 120 });
    },
    leak: function () {
      tone({ type: 'sawtooth', f0: 400, f1: 90, dur: 0.4, gain: 0.15, filter: 'lowpass', fc0: 1600, fc1: 260 });
      noise({ fc0: 700, fc1: 180, dur: 0.4, gain: 0.09, filter: 'lowpass' });
    },
    waveStart: function () {
      tone({ type: 'sawtooth', f0: 130, f1: 260, dur: 0.3, gain: 0.1, exp: false, filter: 'lowpass', fc0: 900, fc1: 2600 });
      tone({ type: 'sine', f0: 65, dur: 0.4, gain: 0.13 });
      noise({ fc0: 200, fc1: 3000, dur: 0.3, gain: 0.05, q: 0.6, delay: 0.02 });
    },
    waveClear: function () {
      var n = [659, 880];
      n.forEach(function (f, i) { tone({ type: 'triangle', f0: f, dur: 0.22, gain: 0.1, delay: i * 0.1 }); });
    },
    victory: function () {
      var seq = [523, 659, 784, 1047, 1319];
      seq.forEach(function (f, i) {
        tone({ type: 'triangle', f0: f, dur: 0.42, gain: 0.13, delay: i * 0.13, bus: sfxBus });
        tone({ type: 'sine', f0: f * 2, dur: 0.3, gain: 0.05, delay: i * 0.13 });
      });
      tone({ type: 'sine', f0: 130.8, dur: 1.5, gain: 0.12, delay: 0.5 });
      tone({ type: 'sine', f0: 196, dur: 1.4, gain: 0.09, delay: 0.5 });
      tone({ type: 'sine', f0: 261.6, dur: 1.3, gain: 0.07, delay: 0.52 });
    },
    defeat: function () {
      var seq = [440, 392, 330, 262, 196];
      seq.forEach(function (f, i) {
        tone({ type: 'sawtooth', f0: f, dur: 0.5, gain: 0.1, delay: i * 0.17, filter: 'lowpass', fc0: 1400, fc1: 380 });
      });
      tone({ type: 'sine', f0: 98, dur: 1.8, gain: 0.14, delay: 0.6 });
      noise({ fc0: 600, fc1: 90, dur: 1.4, gain: 0.05, filter: 'lowpass', delay: 0.6 });
    },
    star: function (i) {
      var f = [880, 1108, 1318][i] || 880;
      tone({ type: 'triangle', f0: f, dur: 0.36, gain: 0.12 });
      tone({ type: 'sine', f0: f * 1.5, dur: 0.26, gain: 0.05 });
    }
  };

  var lastPlay = {};
  A.play = function (name) {
    if (!ready || muted) return;
    if (!ctx || ctx.state !== 'running') return;
    var f = SFX[name];
    if (!f) return;
    /* 同帧同音效节流，避免叠加爆音 */
    var t = w.performance.now();
    if (lastPlay[name] && t - lastPlay[name] < 22) return;
    lastPlay[name] = t;
    try { f(); } catch (e) { /* 忽略单次失败 */ }
  };

  /* 冷却中允许重复的连射音效（不节流） */
  A.sfx = function (name, minGap) {
    if (!ready || muted || !ctx || ctx.state !== 'running') return;
    var f = SFX[name]; if (!f) return;
    var t = w.performance.now();
    var g = minGap == null ? 0 : minGap;
    if (g && lastPlay[name] && t - lastPlay[name] < g) return;
    lastPlay[name] = t;
    try { f(); } catch (e) { }
  };

  /* ============================================================
     背景音乐：前瞻式调度器
     ============================================================ */
  var SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phryg: [0, 1, 3, 5, 7, 8, 10]
  };

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  /* 曲目定义：和弦进行（每和弦 8 步） */
  var TRACKS = {
    menu: {
      bpm: 84, root: 45, scale: 'dorian', swing: 0,
      chords: [[0, 3, 7], [5, 8, 12], [3, 7, 10], [0, 3, 7]],
      bassPat: [1, 0, 0, 0, 0, 0, 1, 0],
      arpPat: [1, 0, 1, 0, 1, 0, 1, 1],
      kick: [1, 0, 0, 0, 1, 0, 0, 0],
      hat: [0, 0, 1, 0, 0, 0, 1, 0],
      padGain: 0.055, arpGain: 0.045, bassGain: 0.075, drumGain: 0.05,
      arpWave: 'triangle', lead: false
    },
    battle: {
      bpm: 138, root: 45, scale: 'minor', swing: 0,
      chords: [[0, 3, 7], [0, 3, 7], [-2, 2, 5], [-2, 2, 5], [-4, 0, 3], [-4, 0, 3], [3, 7, 10], [0, 3, 7]],
      bassPat: [1, 0, 1, 0, 1, 0, 1, 1],
      arpPat: [1, 1, 0, 1, 1, 0, 1, 1],
      kick: [1, 0, 0, 1, 1, 0, 0, 1],
      hat: [0, 1, 0, 1, 0, 1, 0, 1],
      padGain: 0.035, arpGain: 0.04, bassGain: 0.085, drumGain: 0.075,
      arpWave: 'sawtooth', lead: true
    },
    victory: {
      bpm: 112, root: 48, scale: 'minor', swing: 0,
      chords: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]],
      bassPat: [1, 0, 0, 1, 0, 0, 1, 0],
      arpPat: [1, 1, 1, 1, 1, 1, 1, 1],
      kick: [1, 0, 0, 0, 1, 0, 0, 0],
      hat: [0, 0, 1, 0, 0, 0, 1, 0],
      padGain: 0.06, arpGain: 0.05, bassGain: 0.07, drumGain: 0.045,
      arpWave: 'triangle', lead: true
    },
    defeat: {
      bpm: 68, root: 43, scale: 'phryg', swing: 0,
      chords: [[0, 3, 7], [1, 5, 8], [0, 3, 7], [-2, 1, 5]],
      bassPat: [1, 0, 0, 0, 1, 0, 0, 0],
      arpPat: [1, 0, 0, 1, 0, 1, 0, 0],
      kick: [1, 0, 0, 0, 0, 0, 0, 0],
      hat: [0, 0, 0, 0, 0, 0, 1, 0],
      padGain: 0.07, arpGain: 0.035, bassGain: 0.085, drumGain: 0.035,
      arpWave: 'sine', lead: false
    }
  };

  var music = {
    name: null, track: null, step: 0, nextTime: 0, timer: 0,
    fade: 1, targetFade: 1, nodes: []
  };

  function stopAllMusicNodes() {
    for (var i = 0; i < music.nodes.length; i++) {
      try { music.nodes[i].stop(); } catch (e) { }
    }
    music.nodes.length = 0;
  }

  A.playMusic = function (name) {
    if (!ready) return;
    if (music.name === name) return;
    var wasMuted = muted;
    muted = false; /* 切歌本身必须发声，否则听不到淡入 */
    music.name = name;
    music.track = TRACKS[name] || null;
    music.step = 0;
    if (ctx.state === 'suspended') ctx.resume();
    music.nextTime = now() + 0.08;
    music.fade = 0;
    music.targetFade = 1;
    if (music.timer) { clearInterval(music.timer); music.timer = 0; }
    music.timer = w.setInterval(scheduler, 26);
    scheduler();
    muted = wasMuted;
  };

  A.stopMusic = function (fadeOut) {
    music.targetFade = 0;
    music.name = fadeOut === false ? null : music.name;
    if (fadeOut === false) {
      music.name = null;
      music.targetFade = 0;
    }
    var self = this;
    w.setTimeout(function () {
      if (music.targetFade === 0) {
        if (music.timer) { clearInterval(music.timer); music.timer = 0; }
        stopAllMusicNodes();
        music.name = null;
      }
    }, 700);
  };

  function scheduler() {
    if (!ctx || !music.track) return;
    var t = music.track;
    var spb = 60 / t.bpm / 2; /* 八分音符 */
    var guard = 0;
    while (music.nextTime < now() + 0.18 && guard++ < 64) {
      scheduleStep(music.step, music.nextTime);
      var sw = t.swing ? spb * (1 + t.swing) : spb;
      music.nextTime += spb;
      music.step = (music.step + 1) % (t.chords.length * 8);
    }
  }

  function scheduleStep(step, when) {
    var t = music.track;
    var sc = SCALES[t.scale];
    var ci = Math.floor(step / 8) % t.chords.length;
    var ch = t.chords[ci];
    var s = step % 8;
    var dur = 60 / t.bpm / 2 * 1.6;
    var g = music.fade;

    function n(deg, oct) {
      var idx = ((deg % sc.length) + sc.length) % sc.length;
      var o = Math.floor(deg / sc.length) + (oct || 0);
      return t.root + sc[idx] + o * 12;
    }

    /* Bass */
    if (t.bassPat[s]) {
      mTone({
        f: mtof(n(ch[0], -2)), t: 'sawtooth', dur: dur * 1.5,
        gain: t.bassGain * g, when: when,
        filter: 'lowpass', fc0: 320, fc1: 180, q: 6
      });
    }
    /* Pad（每和弦起始） */
    if (s === 0) {
      for (var i = 0; i < ch.length; i++) {
        mTone({
          f: mtof(n(ch[i], 0)), t: 'sine', dur: dur * 7.2,
          gain: t.padGain * g, when: when, atk: 0.35
        });
        mTone({
          f: mtof(n(ch[i], 0)), t: 'triangle', dur: dur * 7.2,
          gain: t.padGain * 0.55 * g, when: when, atk: 0.4, detune: 7
        });
      }
    }
    /* Arp */
    if (t.arpPat[s]) {
      var pick = ch[s % ch.length];
      mTone({
        f: mtof(n(pick, 1)), t: t.arpWave, dur: dur * 0.9,
        gain: t.arpGain * g, when: when, filter: 'lowpass', fc0: 4200, fc1: 1500, q: 2
      });
      if (t.lead) {
        mTone({
          f: mtof(n(ch[(s + 1) % ch.length], 2)), t: 'sine', dur: dur * 0.6,
          gain: t.arpGain * 0.42 * g, when: when + 0.008
        });
      }
    }
    /* Kick */
    if (t.kick[s]) {
      mTone({ f: 132, f1: 42, t: 'sine', dur: 0.24, gain: 0.20 * g, when: when, exp: true });
      noiseHit({ when: when, dur: 0.05, gain: 0.05 * g, fc0: 220, fc1: 60, type: 'lowpass' });
    }
    /* Hat */
    if (t.hat[s]) {
      noiseHit({ when: when, dur: 0.05, gain: t.drumGain * 0.6 * g, fc0: 7200, fc1: 5200, type: 'highpass', q: 0.8 });
    }
  }

  function mTone(o) {
    if (!ctx) return null;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = o.t || 'sine';
    osc.frequency.setValueAtTime(o.f, o.when);
    if (o.detune) osc.detune.value = o.detune;
    var pk = Math.max(0.0002, o.gain);
    g.gain.setValueAtTime(0.0001, o.when);
    g.gain.exponentialRampToValueAtTime(pk, o.when + (o.atk || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, o.when + o.dur);
    var node = osc;
    if (o.filter) {
      var f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(o.fc0, o.when);
      f.frequency.exponentialRampToValueAtTime(Math.max(40, o.fc1), o.when + o.dur);
      f.Q.value = o.q || 1;
      node.connect(f); f.connect(g);
    } else node.connect(g);
    g.connect(musicBus);
    osc.start(o.when);
    osc.stop(o.when + o.dur + 0.05);
    music.nodes.push(osc);
    if (music.nodes.length > 220) music.nodes.shift();
    return osc;
  }

  function noiseHit(o) {
    if (!ctx) return;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.fc0, o.when);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, o.fc1), o.when + o.dur);
    f.Q.value = o.q == null ? 1 : o.q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, o.when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), o.when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, o.when + o.dur);
    src.connect(f); f.connect(g); g.connect(musicBus);
    src.start(o.when);
    src.stop(o.when + o.dur + 0.02);
    music.nodes.push(src);
  }

  /* 每帧更新淡入淡出 */
  A.tickMusic = function (dt) {
    if (!ctx || !music.track) return;
    var target = muted ? 0 : music.targetFade;
    var spd = target > music.fade ? 1.6 : 2.2;
    music.fade += (target - music.fade) * Math.min(1, dt * spd);
    if (music.fade < 0.004 && target === 0) {
      if (music.timer) { clearInterval(music.timer); music.timer = 0; }
      stopAllMusicNodes();
      music.name = null; music.track = null;
    }
  };

})(window);
