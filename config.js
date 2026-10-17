/* ============================================================
   config.js — 游戏内容配置
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var C = NB.CFG = {};

  /* ---------------- 棋盘（加大版：28 x 18） ---------------- */
  C.GRID_W = 36;
  C.GRID_H = 24;
  C.CELL = 44;
  C.CANVAS_W = C.GRID_W * C.CELL;   /* 1232 */
  C.CANVAS_H = C.GRID_H * C.CELL;   /* 792 */

  /* ============================================================
     炮塔（6 种）
     kind: bullet | beam | tesla | arc | missile | slow
     ============================================================ */
  C.TOWERS = {
    plasma: {
      id: 'plasma', name: '等离子炮', short: 'PLASMA', icon: '◈',
      color: '#4fe3ff', color2: '#0d7f9c',
      kind: 'bullet',
      desc: '稳定的单体等离子弹，射速与伤害均衡，是所有防线的基石。',
      unlockCost: 0, free: true,
      base: { dmg: 26, rate: 1.15, range: 3.4, speed: 13.5, pierce: 0 },
      growth: { dmg: 1.175, rate: 1.035, range: 1.028 },
      maxLevel: 12,
      sfx: 'shootPlasma'
    },
    rail: {
      id: 'rail', name: '轨道炮', short: 'RAILGUN', icon: '⌖',
      color: '#e05fd0', color2: '#8c1f78',
      kind: 'beam',
      desc: '瞬发高能磁轨炮，命中单体造成巨额伤害并贯穿直线上的多个敌人，但冷却极长。',
      unlockCost: 80, free: false,
      base: { dmg: 235, rate: 0.42, range: 4.6, speed: 0, pierce: 3 },
      growth: { dmg: 1.20, rate: 1.028, range: 1.032 },
      maxLevel: 12,
      sfx: 'shootRail'
    },
    frost: {
      id: 'frost', name: '寒霜场', short: 'CRYO', icon: '❆',
      color: '#8fd8ff', color2: '#2a6f9e',
      kind: 'slow',
      desc: '范围低温力场，持续削弱区域内所有敌人的移动速度，伤害极低但控场能力无可替代。',
      unlockCost: 70, free: false,
      base: { dmg: 9, rate: 1.0, range: 2.5, speed: 0, pierce: 0, slow: 0.40 },
      growth: { dmg: 1.13, rate: 1.0, range: 1.052, slow: 1.055 },
      maxLevel: 12,
      sfx: 'shootFrost'
    },
    tesla: {
      id: 'tesla', name: '特斯拉线圈', short: 'TESLA', icon: '⚡',
      color: '#b6f4ff', color2: '#3aa8c8',
      kind: 'tesla',
      desc: '释放跳跃电弧，自动在多个敌人之间连锁放电，特别擅长清理密集小怪集群。',
      unlockCost: 130, free: false,
      base: { dmg: 42, rate: 0.95, range: 2.9, speed: 0, pierce: 0, chain: 3, chainFall: 0.78 },
      growth: { dmg: 1.168, rate: 1.042, range: 1.03, chain: 1.02 },
      maxLevel: 12,
      sfx: 'shootTesla'
    },
    arc: {
      id: 'arc', name: '离子风暴', short: 'ARC', icon: '✦',
      color: '#ffd23d', color2: '#a8740a',
      kind: 'arc',
      desc: '向扇形区域倾泻离子束，对范围内所有目标持续灼烧，近身防御的绝对核心。',
      unlockCost: 190, free: false,
      base: { dmg: 19, rate: 4.0, range: 2.7, speed: 0, pierce: 99, cone: 1.15 },
      growth: { dmg: 1.16, rate: 1.028, range: 1.036, cone: 1.02 },
      maxLevel: 12,
      sfx: 'shootArc'
    },
    missile: {
      id: 'missile', name: '追踪导弹', short: 'MISSILE', icon: '➤',
      color: '#7dff5a', color2: '#3d8c1f',
      kind: 'missile',
      desc: '锁定最近的敌人发射追踪弹，命中后产生范围爆炸，对密集队列杀伤力惊人。',
      unlockCost: 250, free: false,
      base: { dmg: 78, rate: 0.72, range: 4.2, speed: 8.5, pierce: 0, blast: 1.35, blastDmg: 0.62 },
      growth: { dmg: 1.182, rate: 1.036, range: 1.03, blast: 1.03 },
      maxLevel: 12,
      sfx: 'shootMissile'
    },
    laser: {
      id: 'laser', name: '镭射光矛', short: 'LANCE', icon: '⌇',
      color: '#ff4d6d', color2: '#a01030',
      kind: 'lance',
      desc: '持续照射单一目标，光矛会随蓄能逐渐变粗增伤，对高护甲重装单位效果拔群。',
      unlockCost: 320, free: false,
      base: { dmg: 42, rate: 2.2, range: 3.6, speed: 0, pierce: 0, armorPen: 0.5, ramp: 1.9 },
      growth: { dmg: 1.19, rate: 1.04, range: 1.032, armorPen: 1.03, ramp: 1.02 },
      maxLevel: 12,
      sfx: 'shootLance'
    },
    spike: {
      id: 'spike', name: '地刺阵列', short: 'SPIKE', icon: '⩕',
      color: '#b6f4ff', color2: '#3aa8c8',
      kind: 'spike',
      desc: '在路径上布设高压地刺，被碾压的敌人持续流血并大幅减速，无需瞄准、全程生效。',
      unlockCost: 150, free: false,
      base: { dmg: 26, rate: 1.0, range: 1.05, speed: 0, pierce: 99, dot: 0.22, slow: 0.30 },
      growth: { dmg: 1.17, rate: 1.0, range: 1.0, dot: 1.02, slow: 1.045 },
      maxLevel: 12,
      sfx: 'shootSpike'
    },
    beacon: {
      id: 'beacon', name: '增幅信标', short: 'BEACON', icon: '✧',
      color: '#ffc93c', color2: '#a8740a',
      kind: 'beacon',
      desc: '自身不造成伤害，但为半径内所有友方炮塔提供伤害与射速加成，是高级防线的核心。',
      unlockCost: 400, free: false,
      base: { dmg: 0, rate: 1.0, range: 3.0, speed: 0, pierce: 0, boost: 0.18, boostRate: 0.14 },
      growth: { dmg: 1, rate: 1, range: 1.10, boost: 1.055, boostRate: 1.05 },
      maxLevel: 12,
      sfx: 'shootBeacon'
    },
    swarm: {
      id: 'swarm', name: '蜂群无人机', short: 'SWARM', icon: '⁂',
      color: '#8be04a', color2: '#3f7018',
      kind: 'swarm',
      desc: '派出三架微型无人机协同作战，每架都是独立的射击单位，单体偏弱但总火力惊人。',
      unlockCost: 460, free: false,
      base: { dmg: 22, rate: 1.55, range: 3.0, speed: 11.0, pierce: 0, units: 3 },
      growth: { dmg: 1.175, rate: 1.038, range: 1.032, units: 1.0 },
      maxLevel: 12,
      sfx: 'shootSwarm'
    },
    repair: {
      id: 'repair', name: '修复厂', short: 'REPAIR', icon: '⚒',
      color: '#5bff9b', color2: '#1a9c5c',
      kind: 'repair',
      desc: '自动修复范围内受损的友方炮塔与基地反应堆，多座相邻可叠加修复速度。',
      unlockCost: 120, free: false,
      base: { dmg: 0, rate: 1.0, range: 5.2, speed: 0, pierce: 0, healRate: 18 },
      growth: { dmg: 1, rate: 1, range: 1.09, healRate: 1.07 },
      maxLevel: 12,
      sfx: 'repairWork'
    },
    gas: {
      id: 'gas', name: '毒气塔', short: 'TOXIN', icon: '☣',
      color: '#a8e05f', color2: '#4a7a14',
      kind: 'gas',
      desc: '持续释放腐蚀毒雾，对范围内所有敌人叠加中毒流血，无视部分护甲，专治成群重甲。',
      unlockCost: 240, free: false,
      base: { dmg: 9, rate: 1, range: 2.6, speed: 0, pierce: 0, dot: 12, dotTime: 3.2 },
      growth: { dmg: 1.16, rate: 1, range: 1.035, dot: 1.155, dotTime: 1.02 },
      maxLevel: 12,
      sfx: 'shootGas'
    },
    gravity: {
      id: 'gravity', name: '重力井', short: 'GRAVITY', icon: '◉',
      color: '#b48cff', color2: '#5a2ea8',
      kind: 'gravity',
      desc: '扭曲局部重力：强力减速并把敌人往回拖，延长敌人在火力区的停留时间。',
      unlockCost: 300, free: false,
      base: { dmg: 6, rate: 1, range: 3.2, speed: 0, pierce: 0, slow: 0.5, pull: 16 },
      growth: { dmg: 1.14, rate: 1, range: 1.04, slow: 1.008, pull: 1.06 },
      maxLevel: 12,
      sfx: 'shootGravity'
    },
    sniper: {
      id: 'sniper', name: '狙击塔', short: 'SNIPER', icon: '✛',
      color: '#ff9a4a', color2: '#a84a10',
      kind: 'sniper',
      desc: '超远射程的单发重型狙击，伤害极高但射速慢，可在敌人逼近防线前点杀高价值目标。',
      unlockCost: 350, free: false,
      base: { dmg: 165, rate: 0.34, range: 7.6, speed: 30, pierce: 0 },
      growth: { dmg: 1.19, rate: 1.03, range: 1.025 },
      maxLevel: 12,
      sfx: 'shootSniper'
    },
    /* ---------- 超贵大杀器：强但各有硬短板，不会造出来就无敌 ---------- */
    orbital: {
      id: 'orbital', name: '轨道轰炸平台', short: 'ORBITAL', icon: '◍',
      color: '#ff6b9d', color2: '#a8204c',
      kind: 'orbital',
      desc: '呼叫全图轨道打击：850 伤害 + 范围溅射，但落点有 1.4 秒延迟、8.3 秒才能打一发，且完全打不中移动快的目标——需要预判。',
      unlockCost: 900, free: false,
      base: { dmg: 850, rate: 0.12, range: 20, speed: 0, pierce: 0, blast: 2.3, blastDmg: 0.55, delay: 1.4 },
      growth: { dmg: 1.165, rate: 1.025, range: 1, blast: 1.03, delay: 0.985 },
      maxLevel: 12,
      sfx: 'shootOrbital'
    },
    storm: {
      id: 'storm', name: '聚能电弧风暴', short: 'STORM', icon: '❂',
      color: '#8fd4ff', color2: '#2a6f9e',
      kind: 'storm',
      desc: '超大范围持续电弧，每秒电击范围内所有敌人；对成群杂兵毁灭性，但单发伤害低、装甲极薄（60），被近身攻击型敌人几下就会打爆。',
      unlockCost: 700, free: false,
      base: { dmg: 46, rate: 2.9, range: 8.0, speed: 0, pierce: 0 },
      growth: { dmg: 1.10, rate: 1.02, range: 1.05 },
      maxLevel: 12,
      hp: 60,
      sfx: 'shootStorm'
    },
    /* ---------- 空中炮塔：可单格移动，移动中也能攻击 ---------- */
    hover: {
      id: 'hover', name: '浮游炮台', short: 'HOVER', icon: '⌬',
      color: '#c8e6ff', color2: '#3a6a8c',
      kind: 'hover',
      desc: '空中单位：选中后点击任意空格即可单格飞行转移，移动中仍可攻击（射速减半）。机动性极强，但属性中规中矩。',
      unlockCost: 320, free: false,
      base: { dmg: 38, rate: 1.3, range: 3.4, speed: 13, pierce: 0 },
      growth: { dmg: 1.175, rate: 1.035, range: 1.03 },
      maxLevel: 12,
      flying: true,
      sfx: 'shootPlasma'
    },
    /* ---------- 通讯中继站：一次性解锁备用敌人出生点 ---------- */
    relay: {
      id: 'relay', name: '通讯中继站', short: 'RELAY', icon: '📡',
      color: '#ffd23d', color2: '#a8740a',
      kind: 'relay',
      desc: '只能建在黄色标记的出生点塔位上：一次性打通该敌人入口（即使中继站被拆除，入口依然开放）。每打通一个额外入口，每波资金收益 +20%。',
      unlockCost: 500, free: false,
      base: { dmg: 0, rate: 1.0, range: 0, speed: 0, pierce: 0 },
      growth: { dmg: 1, rate: 1, range: 1 },
      maxLevel: 1,
      sfx: 'build'
    },
    mine: {
      id: 'mine', name: '矿场', short: 'MINE', icon: '◆',
      color: '#ffd23d', color2: '#a8740a',
      kind: 'mine',
      desc: '每秒自动产出战场资金（1 级 12/秒，满级约 50/秒），可升级；自身没有任何攻击能力，需要其他炮塔保护。',
      unlockCost: 200, free: false,
      base: { dmg: 0, rate: 1.0, range: 0, speed: 0, pierce: 0, income: 12 },
      growth: { dmg: 1, rate: 1, range: 1, income: 1.14 },
      maxLevel: 12,
      sfx: 'build'
    },
    scatter: {
      id: 'scatter', name: '熔渣散射炮', short: 'SCATTER', icon: '✸',
      color: '#ff8a4a', color2: '#a84a10',
      kind: 'scatter',
      desc: '150° 大扇形瞬发溅射，一次覆盖整群敌人；单发伤害中等、射程一般，是清理密集杂雨的专家，对单体BOSS乏力。',
      unlockCost: 280, free: false,
      base: { dmg: 58, rate: 0.85, range: 4.6, speed: 16, pierce: 0, cone: 2.6 },
      growth: { dmg: 1.175, rate: 1.03, range: 1.028, cone: 1 },
      maxLevel: 12,
      sfx: 'shootArc'
    },
    /* ---------- 东风导弹：全图覆盖 / 慢射 / 百分百命中 ---------- */
    dfm: {
      id: 'dfm', name: '东风导弹', short: 'DFM', icon: '➤',
      color: '#ff4d6d', color2: '#7a1024',
      kind: 'dfm',
      desc: '洲际弹道打击：射程覆盖整张地图，发射前需完成轨道校准（较长前摇），命中必定锁定当前目标并造成大范围爆炸，伤害随距离衰减。数量极少、装填极慢，是专门处理漏网重甲与大群的战略级塔。',
      unlockCost: 2600, free: false,
      base: { dmg: 900, rate: 0.055, range: 999, speed: 0, pierce: 0, delay: 3.4, blast: 3.2, blastDmg: 0.45 },
      growth: { dmg: 1.16, rate: 1.02, range: 1, delay: 0.985, blast: 1.02 },
      maxLevel: 10,
      hp: 180,
      sfx: 'shootOrbital'
    },
    /* ---------- 陆地远程炮：超远射程但不覆盖全图 ---------- */
    gustav: {
      id: 'gustav', name: '古斯塔夫炮', short: 'GUSTAV', icon: '⌖',
      color: '#c8b48a', color2: '#5c4a2e',
      kind: 'gustav',
      desc: '超重型轨道炮：射程极远但不及全图，需要长校准时间；单发穿甲巨伤，对路径尽头聚集的重甲群与BOSS效果拔群，但对沿途零散敌人略显浪费。',
      unlockCost: 1400, free: false,
      base: { dmg: 460, rate: 0.30, range: 17, speed: 0, pierce: 6, delay: 1.15, blast: 1.5, blastDmg: 0.55, armorPen: 0.55 },
      growth: { dmg: 1.17, rate: 1.025, range: 1.035, delay: 0.99, blast: 1.02, pierce: 1 },
      maxLevel: 12,
      hp: 420,
      sfx: 'shootOrbital'
    },
    torpedo: {
      id: 'torpedo', name: '巡飞 torpedo', short: 'TORP', icon: '⌁',
      color: '#7de0ff', color2: '#1f6a88',
      kind: 'torpedo',
      desc: '低空巡飞弹巢：射程超出常规塔一大截，弹体带追踪能力会自动修正弹道命中移动目标，穿透数中等，单发伤害高但射速一般。',
      unlockCost: 900, free: false,
      base: { dmg: 165, rate: 0.62, range: 9.2, speed: 34, pierce: 3, armorPen: 0.3 },
      growth: { dmg: 1.16, rate: 1.03, range: 1.035, pierce: 1.02 },
      maxLevel: 12,
      hp: 240,
      sfx: 'shootMissile'
    },
    /* ---------- 新增移动单位 ---------- */
    dronebay: {
      id: 'dronebay', name: '蜂群母舰', short: 'BAY', icon: '⌸',
      color: '#b8f0a0', color2: '#2f6b3a',
      kind: 'dronebay', flying: true,
      desc: '空中母舰：本体无法发射炮弹，只负责释放与回收。母舰周围始终维持 5 架护航无人机在轨巡飞，每架独立索敌、独立开火；无人机血量极薄，一旦被击毁，母舰会立刻放出替补补满编队。可自由单格机动，把火力焦点随时搬到需要的位置。',
      unlockCost: 1100, free: false,
      /* dmg=0：母舰本体不发射，所有伤害由 5 架无人机造成 */
      base: { dmg: 30, rate: 0.9, range: 6.4, speed: 13, pierce: 0 },
      hullDmg: 30,
      growth: { dmg: 1.15, rate: 1.05, range: 1.03 },
      maxLevel: 12,
      hp: 260,
      sfx: 'shootPlasma'
    },
    sling: {
      id: 'sling', name: '悬浮磁索', short: 'SLING', icon: '⌾',
      color: '#c0a8ff', color2: '#4a2f8c',
      kind: 'hover', flying: true,
      desc: '空中拖曳式磁索：可单格机动，拖住大范围多个敌人并持续造成伤害；对密集推进的杂兵群效果拔群，机动性极强但自身装甲薄。',
      unlockCost: 1500, free: false,
      base: { dmg: 24, rate: 1.5, range: 5.4, speed: 13, pierce: 0, chain: 3, chainFall: 0.72, slow: 0.3 },
      growth: { dmg: 1.12, rate: 1.05, range: 1.03, chain: 1.05, chainFall: 1, slow: 1.01 },
      maxLevel: 12,
      hp: 150,
      sfx: 'shootArc'
    }
  };
  C.TOWER_ORDER = ['plasma', 'rail', 'frost', 'tesla', 'arc', 'missile', 'spike', 'laser', 'swarm', 'beacon', 'repair', 'gas', 'gravity', 'sniper', 'orbital', 'storm', 'hover', 'relay', 'mine', 'scatter', 'torpedo', 'dronebay', 'sling', 'gustav', 'dfm'];

  /* 建造费用 = round(base * costMul^lv)，只作用于 plasma 作为基准 */
    C.TOWER_COST = {
    plasma: 60, rail: 130, frost: 90, tesla: 175, arc: 210, missile: 240,
    spike: 80, laser: 290, swarm: 210, beacon: 350, repair: 220,
    gas: 190, gravity: 260, sniper: 320,
    orbital: 3800, storm: 2600, hover: 450, relay: 1200, mine: 240, scatter: 280,
    torpedo: 900, dronebay: 1100, sling: 1500, gustav: 1400, dfm: 2600
  };
  C.UPGRADE_COST_MUL = 1.32;

  /* ============================================================
     敌人（6 种 + BOSS）
     配色：柴油朋克工业风 —— 锈红/铁灰/警戒黄/毒绿/幽蓝/血红
     ============================================================ */
  C.ENEMIES = {
    grunt: {
      id: 'grunt', name: '步兵', hp: 62, speed: 1.42, gold: 9, dmg: 1,
      w: 0.66, h: 0.66, color: '#e8622c', core: '#ffb080', shape: 'hex', xp: 1
    },
    runner: {
      id: 'runner', name: '疾行者', hp: 44, speed: 3.05, gold: 12, dmg: 1,
      w: 0.60, h: 0.60, color: '#ffc61f', core: '#fff0a8', shape: 'tri', xp: 1
    },
    tank: {
      id: 'tank', name: '重装兵', hp: 340, speed: 0.86, gold: 34, dmg: 3,
      w: 1.02, h: 1.02, color: '#8b5cd6', core: '#d6bcff', shape: 'sq', armor: 0.22, xp: 4
    },
    swarm: {
      id: 'swarm', name: '蜂群', hp: 26, speed: 2.25, gold: 5, dmg: 1,
      w: 0.50, h: 0.50, color: '#7dff5a', core: '#d4ffc2', shape: 'dot', xp: 1
    },
    phantom: {
      id: 'phantom', name: '幻影', hp: 120, speed: 2.05, gold: 26, dmg: 2,
      w: 0.72, h: 0.72, color: '#38d9f0', core: '#c4f6ff', shape: 'dia', ghost: true, xp: 3
    },
    overlord: {
      id: 'overlord', name: '霸主', hp: 4600, speed: 0.62, gold: 260, dmg: 12,
      w: 1.9, h: 1.9, color: '#ff2e42', core: '#ffc2ca', shape: 'boss', armor: 0.3, xp: 40
    },

    /* ===== 新增 6 种 ===== */
    drone: {
      id: 'drone', name: '工蜂无人机', hp: 58, speed: 2.55, gold: 11, dmg: 1,
      w: 0.54, h: 0.54, color: '#9ad64a', core: '#e2ffc4', shape: 'wing', xp: 1
    },
    lancer: {
      id: 'lancer', name: '突击炮车', hp: 195, speed: 1.72, gold: 24, dmg: 2,
      w: 0.86, h: 0.86, color: '#e07a1f', core: '#ffd7a8', shape: 'lance', armor: 0.12, xp: 3
    },
    /* ---------- 突袭型：不走固定跑道，从刷新格沿格子直扑基地 ---------- */
    breacher: {
      id: 'breacher', name: '破门突袭兵', hp: 150, speed: 1.95, gold: 20, dmg: 2,
      w: 0.72, h: 0.72, color: '#ff5c7a', core: '#ffd0dc', shape: 'breach', armor: 0.08, xp: 2,
      raider: true
    },
    sapper: {
      id: 'sapper', name: '工兵爆破者', hp: 120, speed: 2.25, gold: 26, dmg: 3,
      w: 0.64, h: 0.64, color: '#b8ff6a', core: '#eaffd0', shape: 'sapper', xp: 3,
      raider: true
    },
    droner: {
      id: 'droner', name: ' infiltrator 渗透者', hp: 95, speed: 2.6, gold: 18, dmg: 2,
      w: 0.58, h: 0.58, color: '#c0a8ff', core: '#e8dcff', shape: 'droner', ghost: true,
      xp: 2, raider: true
    },
    warden: {
      id: 'warden', name: '护盾卫', hp: 280, speed: 1.18, gold: 42, dmg: 2,
      w: 0.94, h: 0.94, color: '#4a8ff0', core: '#c8ddff', shape: 'ward', shield: 340, xp: 5
    },
    mender: {
      id: 'mender', name: '维修单元', hp: 210, speed: 1.34, gold: 46, dmg: 1,
      w: 0.80, h: 0.80, color: '#3ad9c0', core: '#c4fff4', shape: 'mender', heal: 130, xp: 6
    },
    breaker: {
      id: 'breaker', name: '干扰者', hp: 165, speed: 2.0, gold: 30, dmg: 2,
      w: 0.76, h: 0.76, color: '#b06ae0', core: '#e6ccff', shape: 'jam', jamCd: 4.5, xp: 5
    },
    juggernaut: {
      id: 'juggernaut', name: '重装泰坦', hp: 1450, speed: 0.72, gold: 150, dmg: 6,
      w: 1.42, h: 1.42, color: '#5a6b7c', core: '#d0dae4', shape: 'jugg', armor: 0.38, xp: 18
    },
    /* ===== 攻击型：会主动脱离路径攻击附近炮塔 ===== */
    saber: {
      id: 'saber', name: '破袭者', hp: 210, speed: 1.72, gold: 30, dmg: 1,
      w: 0.88, h: 0.88, color: '#ff8a3d', core: '#ffd6b0', shape: 'saber',
      armor: 0.10, xp: 5,
      attacker: true, atkDmg: 11, atkRange: 1.5, atkCd: 1.05
    },
    ripper: {
      id: 'ripper', name: '裂装机兵', hp: 460, speed: 1.30, gold: 62, dmg: 2,
      w: 1.06, h: 1.06, color: '#e0455a', core: '#ffc2cc', shape: 'ripper',
      armor: 0.18, xp: 9,
      attacker: true, atkDmg: 22, atkRange: 1.75, atkCd: 1.25
    }
  };
  C.ENEMY_ORDER = ['grunt', 'runner', 'swarm', 'drone', 'lancer', 'tank', 'phantom', 'breaker', 'warden', 'mender', 'juggernaut', 'overlord', 'saber', 'ripper'];

  /* ============================================================
     难度预设：开局前选择，影响血量/速度/收益/攻击型敌人占比
     ============================================================ */
  C.DIFFICULTIES = {
    easy: {
      key: 'easy', name: '轻松', tag: 'RECRUIT', color: '#5bff9b',
      hpMul: 0.70, spMul: 0.88, goldMul: 1.25, livesBonus: 6,
      attackerRate: 0.00,
      desc: '敌人血量降低 30%，资金收益 +25%。不会有敌人攻击你的炮塔。'
    },
    normal: {
      key: 'normal', name: '标准', tag: 'VETERAN', color: '#4fe3ff',
      hpMul: 1.00, spMul: 1.00, goldMul: 1.00, livesBonus: 0,
      attackerRate: 0.16,
      desc: '标准配置。少量破袭者会脱离路径，低伤害攻击附近炮塔。'
    },
    hard: {
      key: 'hard', name: '困难', tag: 'ELITE', color: '#ffc93c',
      hpMul: 1.45, spMul: 1.12, goldMul: 1.12, livesBonus: -3,
      attackerRate: 0.32,
      desc: '敌人血量 +45%、速度 +12%。约三分之一敌人为攻击型，需要修复厂保护防线。'
    },
    nightmare: {
      key: 'nightmare', name: '噩梦', tag: 'NIGHTMARE', color: '#ff2e42',
      hpMul: 2.10, spMul: 1.24, goldMul: 1.00, livesBonus: -6,
      attackerRate: 0.50,
      desc: '敌人血量翻倍以上，半数敌人会攻击炮塔。基地耐久 -6。建议携带修复厂与信标。'
    }
  };
  C.DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'nightmare'];

  /* ============================================================
     无尽模式预设
     · 波次无限，强度随波数递增（血量线性+指数、速度线性、数量线性）
     · 每 wave.bossEvery 波一个 BOSS 波；每 5 波一支精英小队
     · 波次内容由种子确定性生成（存档只需记录波号即可完整复原）
     ============================================================ */
  C.ENDLESS = {
    startGold: 520,
    lives: 20,
    comp: ['grunt', 'runner', 'swarm', 'drone', 'lancer', 'tank',
      'phantom', 'breaker', 'warden', 'mender', 'juggernaut', 'saber', 'ripper'],
    hpPerWave: 0.042,        /* 血量线性成长（更缓） */
    hpPow: 0.00105,          /* 血量指数成长（波数^1.7） */
    spPerWave: 0.0045,       /* 速度线性成长 */
    spMax: 2.2,              /* 速度倍率上限 */
    countBase: 6,
    countPerWave: 0.62,
    countMax: 40,
    rewardBase: 30,
    rewardPerWave: 6,
    intervalMin: 4.5,
    bossEvery: 10,           /* 每 10 波一个 BOSS 波（第 10/20/30...） */
    eliteEvery: 5,
    batchSize: 6              /* 波表滚动生成批量 */
  };

  /* ============================================================
     关卡（12 关）
     map: 布局名, waves: 波次数, hp/speed 倍率, extraGold 初始资金
     ============================================================ */
  C.LEVELS = [
    {
      id: 1, name: '边境哨站', diff: 1, layout: 'A', waves: 9,
      hpMul: 1.0, spMul: 1.0, startGold: 320, lives: 20,
      reward: 60,
      comp: ['grunt', 'grunt', 'runner', 'grunt', 'swarm', 'drone', 'grunt', 'runner', 'grunt'],
      desc: '外围防线、标准入侵编队。熟悉建造、升级与射程覆盖。'
    },
    {
      id: 2, name: '峡谷隘口', diff: 2, layout: 'B', waves: 10,
      hpMul: 1.16, spMul: 1.03, startGold: 360, lives: 20,
      reward: 70,
      comp: ['grunt', 'runner', 'drone', 'swarm', 'lancer', 'grunt', 'runner', 'tank', 'drone', 'grunt'],
      desc: '重装炮车登场，注意射程覆盖与减速配合。'
    },
    {
      id: 3, name: '霓虹都市', diff: 3, layout: 'C', waves: 11,
      hpMul: 1.34, spMul: 1.06, startGold: 400, lives: 20,
      reward: 88,
      comp: ['swarm', 'drone', 'runner', 'phantom', 'grunt', 'swarm', 'lancer', 'runner', 'phantom', 'drone', 'grunt'],
      desc: '幻影与工蜂无人机成群，高射速与范围伤害更划算。'
    },
    {
      id: 4, name: '废弃矿场', diff: 4, layout: 'D', waves: 12,
      hpMul: 1.56, spMul: 1.09, startGold: 440, lives: 18,
      reward: 104,
      comp: ['grunt', 'drone', 'runner', 'tank', 'phantom', 'lancer', 'grunt', 'runner', 'warden', 'swarm', 'tank', 'drone'],
      desc: '护盾卫首次出现——普通伤害会被护盾吸收，试试破甲光矛。'
    },
    {
      id: 5, name: '反应堆外围', diff: 5, layout: 'E', waves: 13,
      hpMul: 1.82, spMul: 1.12, startGold: 480, lives: 18,
      reward: 126,
      comp: ['grunt', 'runner', 'tank', 'swarm', 'phantom', 'lancer', 'drone', 'warden', 'tank', 'phantom', 'grunt', 'runner', 'warden'],
      desc: '敌群开始携带护盾与干扰，地刺与增幅信标价值凸显。'
    },
    {
      id: 6, name: '冰封渡口', diff: 6, layout: 'F', waves: 14,
      hpMul: 2.10, spMul: 1.16, startGold: 520, lives: 17,
      reward: 152,
      comp: ['swarm', 'drone', 'phantom', 'tank', 'grunt', 'breaker', 'runner', 'warden', 'tank', 'grunt', 'breaker', 'phantom', 'lancer', 'tank'],
      desc: '干扰者会瘫痪你的炮塔，注意分散布局。'
    },
    {
      id: 7, name: '轨道电梯', diff: 7, layout: 'G', waves: 14,
      hpMul: 2.44, spMul: 1.20, startGold: 570, lives: 16,
      reward: 182,
      comp: ['grunt', 'swarm', 'runner', 'tank', 'phantom', 'breaker', 'lancer', 'runner', 'warden', 'drone', 'tank', 'breaker', 'grunt', 'phantom'],
      desc: '紧凑地形，射程覆盖是胜负关键。'
    },
    {
      id: 8, name: '量子实验室', diff: 8, layout: 'H', waves: 15,
      hpMul: 2.80, spMul: 1.24, startGold: 620, lives: 15,
      reward: 216,
      comp: ['runner', 'swarm', 'phantom', 'warden', 'mender', 'grunt', 'lancer', 'tank', 'phantom', 'breaker', 'drone', 'tank', 'mender', 'grunt', 'phantom'],
      desc: '维修单元会持续给友军回血——必须优先集火。'
    },
    {
      id: 9, name: '深空要塞', diff: 9, layout: 'I', waves: 16,
      hpMul: 3.24, spMul: 1.28, startGold: 680, lives: 15,
      reward: 255,
      comp: ['tank', 'grunt', 'runner', 'swarm', 'juggernaut', 'phantom', 'warden', 'runner', 'tank', 'mender', 'breaker', 'lancer', 'phantom', 'drone', 'tank', 'grunt'],
      desc: '重装泰坦登场，高护甲高血量，需要集火与破甲。'
    },
    {
      id: 10, name: '虫巢母舰', diff: 10, layout: 'J', waves: 16,
      hpMul: 3.76, spMul: 1.32, startGold: 740, lives: 14,
      reward: 302,
      comp: ['swarm', 'phantom', 'runner', 'tank', 'lancer', 'warden', 'drone', 'breaker', 'tank', 'mender', 'runner', 'juggernaut', 'phantom', 'swarm', 'drone', 'tank'],
      desc: '蜂群、护盾、干扰、泰坦全上阵，考验综合调度。'
    },
    {
      id: 11, name: '湮灭之环', diff: 11, layout: 'K', waves: 17,
      hpMul: 4.34, spMul: 1.37, startGold: 810, lives: 12,
      reward: 365,
      comp: ['phantom', 'warden', 'runner', 'swarm', 'breaker', 'tank', 'mender', 'lancer', 'juggernaut', 'phantom', 'runner', 'warden', 'breaker', 'tank', 'lancer', 'drone', 'grunt'],
      desc: '极限高压防线，每一次失误都可能致命。'
    },
    {
      id: 12, name: '母星核心', diff: 12, layout: 'L', waves: 18,
      hpMul: 5.20, spMul: 1.42, startGold: 950, lives: 10,
      reward: 620,
      boss: true,
      comp: ['grunt', 'runner', 'tank', 'swarm', 'phantom', 'lancer', 'warden', 'drone', 'breaker', 'mender', 'tank', 'juggernaut', 'phantom', 'runner', 'warden', 'swarm', 'drone', 'tank'],
      desc: '最终决战。三头「霸主」将在最后一波降临，维修单元全程护航。'
    }
  ];

  /* ============================================================
     天赋（跨局永久强化，用晶核购买）
     ============================================================ */
  C.TALENTS = {
    power: {
      key: 'power', name: '武器过载', icon: '⚔', max: 10, costBase: 60, costMul: 1.42,
      desc: '所有炮塔伤害提升 4%（每级，可叠加）。',
      perk: '全炮塔伤害 +4%/级'
    },
    range: {
      key: 'range', name: '远程校准', icon: '◎', max: 10, costBase: 55, costMul: 1.40,
      desc: '所有炮塔射程提升 3%（每级）。',
      perk: '全炮塔射程 +3%/级'
    },
    haste: {
      key: 'haste', name: '超频核心', icon: '⚡', max: 10, costBase: 70, costMul: 1.45,
      desc: '所有炮塔射速提升 3%（每级）。',
      perk: '全炮塔射速 +3%/级'
    },
    economy: {
      key: 'economy', name: '黑市渠道', icon: '⬢', max: 8, costBase: 90, costMul: 1.50,
      desc: '击杀获得金币提升 5%（每级）。',
      perk: '击杀金币 +5%/级'
    },
    interest: {
      key: 'interest', name: '金融算法', icon: '％', max: 5, costBase: 130, costMul: 1.62,
      desc: '每波结束按当前资金 3%（每级，上限 12%）获得额外利息。',
      perk: '每波利息 +3%（上限 12%）'
    },
    repair: {
      key: 'repair', name: '应急维修', icon: '✚', max: 5, costBase: 150, costMul: 1.66,
      desc: '每关开始时基地额外恢复 1 点耐久（每级）。',
      perk: '开局额外耐久 +1/级'
    },
    salvage: {
      key: 'salvage', name: '残骸回收', icon: '⟲', max: 6, costBase: 100, costMul: 1.48,
      desc: '拆除炮塔的返还比例在 75% 基础上，每级额外 +4%（最高 99%）。',
      perk: '拆除返还 75% + 4%/级（上限 99%）'
    },
    bounty: {
      key: 'bounty', name: '悬赏通告', icon: '★', max: 10, costBase: 80, costMul: 1.44,
      desc: '关卡结算晶币奖励提升 12%（每级）。',
      perk: '晶币奖励 +12%/级'
    }
  };
  C.TALENT_ORDER = ['power', 'range', 'haste', 'economy', 'interest', 'repair', 'salvage', 'bounty'];

  /* ============================================================
     成就
     ============================================================ */
  C.ACHIEVEMENTS = {
    first_blood: { key: 'first_blood', name: '首杀', icon: '⚔', desc: '击败第一个敌人。' },
    wave10: { key: 'wave10', name: '压制者', icon: '≋', desc: '单局推进到第 10 波。' },
    clear5: { key: 'clear5', name: '推进者', icon: '◈', desc: '通关 5 个战区。' },
    clear_all: { key: 'clear_all', name: '母星守护者', icon: '★', desc: '通关全部 12 个战区。' },
    star9: { key: 'star9', name: '精锐指挥官', icon: '☆', desc: '累计获得 9 颗星。' },
    star36: { key: 'star36', name: '完美防线', icon: '✪', desc: '累计获得 36 颗星（全三星）。' },
    kills1000: { key: 'kills1000', name: '绞肉机', icon: '☠', desc: '累计击杀 1000 个敌人。' },
    kills5000: { key: 'kills5000', name: ' annihilation', icon: '☣', desc: '累计击杀 5000 个敌人。' },
    towers20: { key: 'towers20', name: '工程师', icon: '⚒', desc: '累计建造 20 座炮塔。' },
    towers100: { key: 'towers100', name: '筑城者', icon: '🏗', desc: '累计建造 100 座炮塔。' },
    rich: { key: 'rich', name: '军火商', icon: '⬢', desc: '累计持有 1000 晶币。' },
    no_leak: { key: 'no_leak', name: '零失守', icon: '✚', desc: '以满耐久通关任意战区。' }
  };
  /* 修正成就名中的英文残留 */
  C.ACHIEVEMENTS.kills5000.name = '歼灭者';

  /* ============================================================
     星级规则
     ============================================================ */
  C.STAR_RULES = [
    { key: 'clear', desc: '完成战区' },
    { key: 'leak', desc: '基地耐久剩余 ≥ 70%' },
    { key: 'speed', desc: '用时 ≤ 目标时间' }
  ];

  /* 目标时间 = waves * 基础波时 + 余量 */
  C.targetTime = function (lv) {
    return Math.round(lv.waves * 26 + 40);
  };

  /* 拆除返还比例：基础 75%，天赋可提升，上限 99% */
  C.sellRate = function () {
    return Math.min(0.99, 0.75 + NB.Save.talent('salvage') * 0.04);
  };

  /* 天赋后的全局系数 */
  C.mods = function () {
    return {
      dmg: 1 + NB.Save.talent('power') * 0.04,
      range: 1 + NB.Save.talent('range') * 0.03,
      rate: 1 + NB.Save.talent('haste') * 0.03,
      gold: 1 + NB.Save.talent('economy') * 0.05,
      bounty: 1 + NB.Save.talent('bounty') * 0.12
    };
  };

})(window);
