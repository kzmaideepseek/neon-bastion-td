/* ============================================================
   waves.js — 波次生成器
   特色：
   · 12 关各有独立兵种编排，随关卡推进逐步解锁新机制
   · 每波带随机变体（同兵种不同编队），保证重复游玩不腻
   · 精英波 / 集中冲锋 / BOSS 护卫
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U, C = NB.CFG;
  var W = NB.Waves = {};

  /**
   * 生成整关波次表
   * 每波 entries: [{type, delay}]，按关卡编排 + 随机变体
   */
  W.build = function (level, opts) {
    opts = opts || {};
    /* 攻击型敌人占比：由难度决定（0 = 不出现） */
    var atkRate = opts.attackerRate || 0;
    var atkTypes = ['saber', 'ripper'];

    var waves = [];
    var comp = level.comp;
    var n = level.waves;
    var names = WAVE_NAMES;
    var rng = new NB.Path.Rng(level.id * 7717 + 31);

    for (var i = 0; i < n; i++) {
      var entries = [];
      var prog = i / Math.max(1, n - 1);

      /* 攻击型敌人只在中后期出现，前期保留给玩家发育 */
      var atkAllowed = atkRate > 0 && i >= 2;
      var atkProb = atkAllowed ? atkRate * (0.5 + prog * 0.9) : 0;
      /* 前期用 saber，后期混入 ripper */
      var strongAtkAt = 0.55 + prog * 0.3;

      /* 基础数量随进度增长 */
      var count = Math.round(5 + i * 1.3 + Math.pow(prog, 2) * 9);
      if (level.boss) count = Math.round(count * 0.92);
      count = Math.min(count, 38);

      /* 兵种编排：主兵 + 次兵 + 补充兵，随机抽取 */
      var primary = comp[i % comp.length];
      var secondary = comp[(i + 1) % comp.length];
      var tertiary = comp[(i + 3) % comp.length];

      var t = 0;
      var gapBase = Math.max(0.28, 0.92 - prog * 0.5);

      for (var k = 0; k < count; k++) {
        var type;
        var r = rng.next();
        /* 按难度概率替换为攻击型敌人 */
        if (atkProb > 0 && r < atkProb) {
          type = (rng.next() < strongAtkAt) ? 'saber' : 'ripper';
        } else if (r < 0.60) type = primary;
        else if (r < 0.88) type = secondary;
        else type = tertiary;

        entries.push({ type: type, delay: t });
        t += gapBase * gapFor(type);
      }

      /* 每 4 波：集中冲锋（随机兵种） */
      if (i > 0 && i % 4 === 3) {
        var rushN = 6 + Math.round(prog * 10);
        var rt = 1.6;
        /* 冲锋兵种随机，形成战术变化 */
        var rushPool = ['swarm', 'runner', 'drone', 'phantom', primary];
        var rtype = rushPool[rng.int(0, rushPool.length - 1)];
        for (var m = 0; m < rushN; m++) {
          entries.push({ type: rtype, delay: rt });
          rt += 0.15;
        }
        /* 冲锋后配 2 个重装压阵 */
        for (var h = 0; h < 2; h++) {
          entries.push({ type: (h === 0 ? 'tank' : tertiary), delay: rt + 0.4 });
        }
      }

      /* 每 7 波：精英小队（高倍率精英单位） */
      if (i > 0 && i % 7 === 6) {
        var et = t + 2.2;
        var elite = ['lancer', 'warden', 'breaker', 'juggernaut'];
        var eCount = 1 + Math.round(prog * 3);
        for (var e = 0; e < eCount; e++) {
          entries.push({ type: elite[rng.int(0, elite.length - 1)], delay: et, elite: 1 });
          et += 0.7;
        }
      }

      /* BOSS：最后一波，双霸主 + 护卫 */
      if (level.boss && i === n - 1) {
        entries.push({ type: 'overlord', delay: 0.2 });
        entries.push({ type: 'overlord', delay: 0.2 });
        entries.push({ type: 'overlord', delay: 6.0 });
        for (var g = 0; g < 12; g++) {
          entries.push({
            type: ['phantom', 'tank', 'lancer', 'breaker'][g % 4],
            delay: 0.6 + g * 0.65
          });
        }
        /* BOSS 护卫：维修单元 */
        entries.push({ type: 'mender', delay: 3.2 });
        entries.push({ type: 'mender', delay: 12.0 });
      }

      entries.sort(function (a, b) { return a.delay - b.delay; });

      /* 波间隔随进度缩短 */
      var interval = Math.max(5, 20 - i * 0.55);
      /* 奖励随进度提升 */
      var reward = Math.round((26 + i * 7.5) * (1 + prog * 0.5));

      waves.push({
        index: i,
        name: names[i % names.length],
        entries: entries,
        interval: interval,
        reward: reward,
        isBoss: !!(level.boss && i === n - 1),
        /* 本波强度倍率（无尽模式逐波成长；闯关模式取关卡固定值） */
        hpMul: level.hpMul,
        spMul: level.spMul,
        /* 本波随机编队标识，用于 UI 展示变化 */
        seedTag: rng.int(1000, 9999)
      });
    }
    return waves;
  };

  /* ============================================================
     无尽模式：确定性无限波次生成
     —— 每个波次的内容只由「波号」决定（种子 = f(波号)），
        因此存档只需记录波号即可完整复原后续波表。
     —— 强度成长：血量 线性 + 指数、速度 线性（封顶）、数量 线性
     ============================================================ */
  W.buildEndless = function (fromIdx, count, diffKey) {
    var atkRate = (C.DIFFICULTIES[diffKey || 'normal'] || C.DIFFICULTIES.normal).attackerRate;
    var out = [];
    for (var i = 0; i < count; i++) out.push(endlessWave(fromIdx + i, atkRate));
    return out;
  };
  /* 单波生成（测试与存档复原共用） */
  W.endlessWave = endlessWave;

  function endlessWave(idx, atkRate) {
    var E = C.ENDLESS;
    var rng = new NB.Path.Rng(idx * 6151 + 7717);

    var hpMul = 1 + idx * E.hpPerWave + Math.pow(idx, 1.7) * E.hpPow;
    var spMul = Math.min(E.spMax, 1 + idx * E.spPerWave);

    var isBoss = idx > 0 && (idx + 1) % E.bossEvery === 0;
    var isElite = idx > 0 && (idx + 1) % E.eliteEvery === 0 && !isBoss;

    var count = Math.min(E.countMax, Math.round(E.countBase + idx * E.countPerWave));
    var gapBase = Math.max(0.30, 0.95 - idx * 0.004);

    /* 攻击型敌人：第 3 波起按难度概率混入，越往后越多 */
    var atkProb = (idx >= 2 && atkRate > 0) ? atkRate * (0.6 + Math.min(0.8, idx * 0.012)) : 0;

    var entries = [];
    var t = 0;
    for (var k = 0; k < count; k++) {
      var type;
      var r = rng.next();
      if (atkProb > 0 && r < atkProb) {
        type = (rng.next() < 0.45 + Math.min(0.4, idx * 0.008)) ? 'saber' : 'ripper';
      } else {
        /* 兵种池随波数推进解锁重型单位（约第 24 波全解锁） */
        var pool = E.comp.slice(0, Math.min(E.comp.length, 5 + Math.floor(idx / 3)));
        /* 重甲占比随波数爬升：第 4 波起出现，第 40 波后稳定在 55% */
        var heavyP = U.clamp((idx - 3) / 40, 0, 0.55);
        if (rng.next() < heavyP) {
          /* 重甲池：从已解锁的重型单位里抽 */
          var heavy = pool.slice(4);
          if (heavy.length) {
            type = heavy[rng.int(0, heavy.length - 1)];
          } else {
            type = pool[rng.int(0, pool.length - 1)];
          }
        } else {
          type = pool[rng.int(0, pool.length - 1)];
        }
      }
      entries.push({ type: type, delay: t });
      t += gapBase * gapFor(type);
    }

    /* 每 4 波：集中冲锋 */
    if (idx > 0 && idx % 4 === 3) {
      var rushN = 6 + Math.min(14, Math.round(idx * 0.25));
      var rt = 1.6;
      var rushPool = ['swarm', 'runner', 'drone', 'phantom'];
      var rtype = rushPool[rng.int(0, rushPool.length - 1)];
      for (var m = 0; m < rushN; m++) {
        entries.push({ type: rtype, delay: rt });
        rt += 0.14;
      }
      entries.push({ type: 'tank', delay: rt + 0.4 });
      entries.push({ type: 'juggernaut', delay: rt + 0.9 });
      /* 第 20 波起：冲锋尾部再压一组重甲，越往后越多 */
      if (idx >= 20) {
        var tailN = 1 + Math.min(6, Math.floor((idx - 20) / 6));
        var tailPool = ['warden', 'breaker', 'ripper', 'juggernaut', 'mender'];
        for (var tn = 0; tn < tailN; tn++) {
          entries.push({ type: tailPool[rng.int(0, tailPool.length - 1)], delay: rt + 1.6 + tn * 0.9, elite: 1 });
        }
      }
    }

    /* 每 5 波：精英小队（高倍率） */
    if (isElite) {
      var et = t + 2.2;
      var elite = ['lancer', 'warden', 'breaker', 'juggernaut'];
      var eCount = 1 + Math.min(6, Math.floor(idx / 6));
      for (var e = 0; e < eCount; e++) {
        entries.push({ type: elite[rng.int(0, elite.length - 1)], delay: et, elite: 1 });
        et += 0.7;
      }
    }

    /* BOSS 波：霸主 x N + 混编护卫 + 维修护航
       bossN 按 1 基波号计算：第 10~21 波 1 头，第 22 波起 2 头，第 44 波起 3 头。
       原先用 0 基 idx 直接除，导致第 22 波仍只刷 1 头、实际第 23 波才变 2 头，与说明差一波。 */
    if (isBoss) {
      var bossN = 1 + Math.floor((idx + 1) / 22);
      for (var b2 = 0; b2 < bossN; b2++) {
        entries.push({ type: 'overlord', delay: 0.2 + b2 * 5.5, elite: 1 });
      }
      var guardN = 14 + Math.min(14, Math.floor(idx / 2.5));
      for (var g = 0; g < guardN; g++) {
        entries.push({
          type: ['phantom', 'tank', 'lancer', 'breaker', 'warden'][g % 5],
          delay: 0.6 + g * 0.6,
          elite: idx >= 40 ? 1 : 0
        });
      }
      entries.push({ type: 'mender', delay: 3.2 });
      entries.push({ type: 'mender', delay: 12.0 });
    }

    entries.sort(function (a, b) { return a.delay - b.delay; });

    var interval = Math.max(E.intervalMin, 18 - idx * 0.22);
    var reward = Math.round((E.rewardBase + idx * E.rewardPerWave) * (isBoss ? 1.8 : 1));

    return {
      index: idx,
      name: isBoss ? 'BOSS 突击波' : WAVE_NAMES[idx % WAVE_NAMES.length],
      entries: entries,
      interval: interval,
      reward: reward,
      isBoss: isBoss,
      hpMul: hpMul,
      spMul: spMul,
      seedTag: rng.int(1000, 9999)
    };
  }

  /* 兵种出场间隔系数：越重越慢 */
  function gapFor(type) {
    var d = C.ENEMIES[type];
    if (!d) return 1;
    if (type === 'swarm' || type === 'drone') return 0.48;
    if (type === 'runner') return 0.75;
    if (type === 'phantom' || type === 'breaker') return 0.88;
    if (type === 'saber') return 0.92;
    if (type === 'lancer' || type === 'mender') return 1.1;
    if (type === 'ripper') return 1.25;
    if (type === 'tank' || type === 'warden') return 1.55;
    if (type === 'juggernaut') return 2.4;
    if (type === 'overlord') return 6;
    return 1;
  }

  var WAVE_NAMES = [
    '侦察波', '前哨接触', '密集突击', '渗透小队', '重装推进',
    '空降突袭', '交叉火力', '精英部队', '饱和攻击', '破防行动',
    '总攻预备', '指挥部队', '绝望冲锋', '终局决战'
  ];
  W.WAVE_NAMES = WAVE_NAMES;

})(window);
