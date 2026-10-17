/* ============================================================
   entities.js — 敌人 / 炮塔 / 弹丸 实体与行为
   ============================================================ */
(function (w) {
  'use strict';

  var NB = w.NB || (w.NB = {});
  var U = NB.U, C = NB.CFG, FX = NB.FX;
  var E = NB.Ent = {};

  /* 弹丸尾焰渐变缓存：坐标随弹体尺寸固定，按 size 缓存，避免每帧每弹创建 */
  var _bctx = null, _bcache = {}, _bn = 0;
  function flameGrad(ctx, size) {
    if (_bctx !== ctx) { _bctx = ctx; _bcache = {}; _bn = 0; }
    var key = size | 0;
    var g = _bcache[key];
    if (g) return g;
    g = ctx.createLinearGradient(-size, 0, -size * 3, 0);
    g.addColorStop(0, 'rgba(255,201,60,.9)');
    g.addColorStop(1, 'rgba(255,92,46,0)');
    if (_bn < 24) { _bcache[key] = g; _bn++; }
    return g;
  }

  /* ============================================================
     敌人
     ============================================================ */
  var eid = 0;

  /**
   * Enemy(state, typeId, hpMul, spMul)
   * state: 需要 { map, mods, onLeak, onKill, shake }
   */
  E.Enemy = function (state, typeId, hpMul, spMul) {
    var d = C.ENEMIES[typeId];
    this.uid = ++eid;
    this.type = typeId;
    this.def = d;
    this.maxHp = Math.max(1, Math.round(d.hp * hpMul));
    this.hp = this.maxHp;
    this.baseSpeed = d.speed * spMul;
    this.speed = this.baseSpeed;
    this.gold = d.gold;
    this.dmg = d.dmg;
    this.w = d.w * C.CELL;
    this.h = d.h * C.CELL;
    this.armor = d.armor || 0;
    this.ghost = !!d.ghost;
    this.shape = d.shape;
    this.color = d.color;
    this.core = d.core;
    this.xp = d.xp;
    this.dist = 0;
    this.x = 0; this.y = 0; this.ang = 0;
    this.alive = true;
    this.dead = false;
    this.slowT = 0; this.slowF = 0;       /* 减速剩余时间 / 强度 */
    this.stunT = 0;
    this.hitT = 0;
    this.bob = Math.random() * U.TAU;
    this.deadT = 0;
    this.state = state;
    this.map = state.map;
    this.spawnT = 0;
    this.scale = d.shape === 'boss' || d.shape === 'jugg' ? 1 : U.rand(0.93, 1.07);
    this.rot = Math.random() * 0.5 - 0.25;
    /* --- 特殊机制 --- */
    this.shield = d.shield ? Math.round(d.shield * hpMul) : 0;
    this.maxShield = this.shield;
    this.shieldT = 0;
    this.healRate = d.heal ? d.heal * hpMul : 0;
    this.healT = 0;
    this.jamCd = d.jamCd || 0;
    this.jamT = Math.random() * 2;
    this.dotT = 0;                          /* 地刺流血 */
    this.dotDmg = 0; this.dotSrc = null;
    /* 攻击型：锁定炮塔后脱离路径 */
    this.attackTarget = null;
    this.attackCdT = 0;
    this.atkCdT = 0;
    this.atkWind = 0;
    /* 突袭型：从随机格子刷新，沿格子直扑基地（不走固定跑道） */
    this.raider = !!d.raider;
    if (this.raider) {
      this.gx = 0; this.gy = 0;
      this.goalX = this.map.base.x; this.goalY = this.map.base.y;
      this.stepT = 0;
      this.burstT = 0;
      this.dist = 0;
      var rc = NB.Path.cellCenter(Math.floor(this.map.base.x / C.CELL),
        Math.floor(this.map.base.y / C.CELL));
      this.x = rc.x; this.y = rc.y; this.ang = 0;
      this.alive = true;
      return;
    }
    /* 多出生点：随机选一条已激活路径（回溯/读档时由外部指定） */
    this.pathIdx = (state && state.pickSpawn) ? state.pickSpawn() : 0;
    this.pathTotal = NB.Path.pathTotal(this.map, this.pathIdx);
    var p = NB.Path.posAt(this.map, 0, this.pathIdx);
    this.x = p.x; this.y = p.y; this.ang = p.ang;
  };

  /* 突袭兵：布放到指定格（由 game.js 的刷新逻辑调用） */
  E.Enemy.prototype.placeAt = function (gx, gy) {
    if (!this.raider) return false;
    this.gx = gx; this.gy = gy;
    var c = NB.Path.cellCenter(gx, gy);
    this.x = c.x; this.y = c.y;
    this.stepT = 0;
    return true;
  };

  /* 突袭兵每帧更新：朝基地方向逐格推进（可穿跑道与建筑），到基地即造成泄漏 */
  E.Enemy.prototype.updateRaider = function (dt) {
    if (!this.alive) { this.deadT -= dt; return this.deadT > 0; }
    if (this.slowT > 0) this.slowT -= dt; else this.slowF = 0;
    if (this.stunT > 0) this.stunT -= dt;
    if (this.hitT > 0) this.hitT -= dt;

    if (this.dotT > 0) {
      this.dotT -= dt;
      var rdd = this.dotDmg * dt;
      this.hp -= rdd;
      if (this.state) this.state.damageDealt += rdd;
      if (this.hp <= 0) { this.hp = 0; this.kill(); return false; }
      if (this.dotT <= 0) this.dotDmg = 0;
    }

    var sp = this.speedNow() * C.CELL;
    var dx = this.goalX - this.x, dy = this.goalY - this.y;
    var d = Math.sqrt(dx * dx + dy * dy);

    /* 抵达基地：按格判定，避免擦边漏判 */
    var bgx = Math.floor(this.goalX / C.CELL), bgy = Math.floor(this.goalY / C.CELL);
    if (Math.abs(this.gx - bgx) <= 1 && Math.abs(this.gy - bgy) <= 1) {
      this.reachBase();
      return false;
    }
    if (d < 2) {
      this.reachBase();
      return false;
    }

    this.ang = Math.atan2(dy, dx);
    this.bob += dt * 7;

    /* 逐格推进：每移动一格做一次格子归属更新 */
    this.dist += sp * dt;
    var stepLen = C.CELL;
    this.stepT += sp * dt;
    if (this.stepT >= stepLen) {
      this.stepT -= stepLen;
      var ngx = this.x + (dx / d) * stepLen;
      var ngy = this.y + (dy / d) * stepLen;
      /* 只在跨越格边界时更新格子索引 */
      var ngx = Math.floor(ngx / C.CELL), ngy = Math.floor(ngy / C.CELL);
      if (ngx !== this.gx || ngy !== this.gy) {
        this.gx = ngx; this.gy = ngy;
        if (Math.random() < dt * 26) {
          FX.spark(this.x, this.y, {
            n: 1, c1: this.color, c2: '#ffffff',
            spMin: 8, spMax: 34, lifeMin: 0.14, lifeMax: 0.32, sizeMin: 1.2, sizeMax: 2.6
          });
        }
      }
    }

    this.x += (dx / d) * sp * dt;
    this.y += (dy / d) * sp * dt;

    /* 突袭兵的攻击型行为：贴近炮塔就开火 */
    this.burstT -= dt;
    if (this.burstT <= 0) {
      this.burstT = 0.55;
      var towers = this.state.towers;
      for (var i = 0; i < towers.length; i++) {
        var t = towers[i];
        if (t.hp <= 0) continue;
        var tdx = t.x - this.x, tdy = t.y - this.y;
        var td2 = tdx * tdx + tdy * tdy;
        if (td2 > C.CELL * C.CELL * 2.6) continue;
        if (Math.random() < 0.34) {
          /* 优先打无人机（若在附近） */
          var tgtX = t.x, tgtY = t.y, didHit = false;
          if (t.kind === 'dronebay' && t.drones) {
            for (var rd = 0; rd < t.drones.length; rd++) {
              var rdn = t.drones[rd];
              if (!rdn.alive) continue;
              var rdx = rdn.x - this.x, rdy = rdn.y - this.y;
              if (rdx * rdx + rdy * rdy > C.CELL * C.CELL * 2.6) continue;
              rdn.hp -= this.dmg;
              rdn.hitT = 0.16;
              tgtX = rdn.x; tgtY = rdn.y;
              didHit = true;
              if (rdn.hp <= 0) { rdn.hp = 0; t.killDrone(rdn.slot); }
              break;
            }
          }
          FX.line(this.x, this.y, tgtX, tgtY, { color: this.color, width: 1.6, life: 0.12 });
          if (!didHit) {
            t.hp -= this.dmg;
            t.hitT = 0.16;
            if (t.hp <= 0) { t.destroy && t.destroy(); }
          }
        }
        break;
      }
    }
    return true;
  };

  E.Enemy.prototype.speedNow = function () {
    var s = this.baseSpeed;
    if (this.slowT > 0) s *= (1 - this.slowF);
    if (this.stunT > 0) s = 0;
    return Math.max(0.08, s);
  };

  E.Enemy.prototype.damage = function (raw, srcTower, opts) {
    if (!this.alive) return 0;
    opts = opts || {};
    var armor = this.armor;
    /* 破甲选项 */
    if (opts.armorPen) armor = armor * (1 - U.clamp(opts.armorPen, 0, 1));
    /* 无视护盾开关 */
    var d = raw * (1 - armor);
    /* 先扣护盾 */
    if (this.shield > 0 && !opts.trueDmg) {
      var sd = Math.min(this.shield, d);
      this.shield -= sd;
      d -= sd;
      this.shieldT = 0.4;
      FX.hitBurst(this.x, this.y, '#8fd8ff', 5);
      if (this.shield <= 0) {
        FX.ring(this.x, this.y, { r0: 6, r1: eShatterR(this.w), life: 0.4, color: '#8fd8ff', width: 2.4 });
        FX.shard(this.x, this.y, { n: 10, c1: '#8fd8ff', c2: '#ffffff', spMin: 90, spMax: 260, grav: 60 });
        NB.Audio.sfx('shieldBreak', 60);
      }
    }
    if (d <= 0) return 0;
    this.hp -= d;
    this.hitT = 0.12;
    if (this.state) this.state.damageDealt += d;
    if (this.hp <= 0) {
      this.hp = 0;
      this.kill();
      return d;
    }
    return d;
  };

  function eShatterR(w) { return Math.max(22, w * 1.2); }

  /* 施加持续伤害（地刺流血） */
  E.Enemy.prototype.applyDot = function (dps, srcTower) {
    this.dotDmg = Math.max(this.dotDmg, dps);
    this.dotSrc = srcTower;
    this.dotT = Math.max(this.dotT, 0.5);
  };

  E.Enemy.prototype.slow = function (factor, dur) {
    /* 取最强减速，不叠加强度，但刷新时长 */
    if (factor > this.slowF) { this.slowF = factor; this.slowT = Math.max(this.slowT, dur); }
    else this.slowT = Math.max(this.slowT, dur * 0.6);
  };

  E.Enemy.prototype.kill = function () {
    if (!this.alive) return;
    this.alive = false;
    this.deadT = 0.28;
    var st = this.state;
    /* 掉落 */
    var gold = Math.round(this.gold * (st.mods ? st.mods.gold : 1));
    st.gold += gold;
    st.kills++;
    st.waveKills++;
    if (st.onKill) st.onKill(this, gold);
    /* 特效 */
    var sc = this.shape === 'boss' ? 3.2 : (this.w / C.CELL) * 1.15;
    FX.death(this.x, this.y, this.color, sc);
    if (this.shape === 'boss') {
      FX.explode(this.x, this.y, { scale: 3.4, color: this.color, c2: '#ffd76a', n: 30, smoke: 10, shards: 18 });
      if (st.shake) st.shake(22);
      NB.Audio.play('explodeBig');
    } else {
      NB.Audio.sfx(this.w / C.CELL > 0.7 ? 'explodeSmall' : 'hit', 45);
    }
  };

  E.Enemy.prototype.reachBase = function () {
    if (!this.alive) return;
    this.alive = false;
    this.deadT = 0.2;
    var st = this.state;
    st.leaks++;
    st.lives -= this.dmg;
    if (st.onLeak) st.onLeak(this);
    FX.explode(this.map.base.x, this.map.base.y, { scale: 1.5, color: '#ff3d6e', c2: '#ffd76a', n: 16, smoke: 5, shards: 8 });
    if (st.shake) st.shake(11);
    NB.Audio.play('leak');
  };

  E.Enemy.prototype.update = function (dt) {
    if (this.raider) return this.updateRaider(dt);
    if (!this.alive) {
      this.deadT -= dt;
      return this.deadT > 0;
    }
    if (this.slowT > 0) this.slowT -= dt; else this.slowF = 0;
    if (this.stunT > 0) this.stunT -= dt;
    if (this.hitT > 0) this.hitT -= dt;
    if (this.shieldT > 0) this.shieldT -= dt;

    /* 持续伤害（地刺流血） */
    if (this.dotT > 0) {
      this.dotT -= dt;
      var dd = this.dotDmg * dt;
      this.hp -= dd;
      if (this.state) this.state.damageDealt += dd;
      if (Math.random() < dt * 8) {
        FX.spark(this.x, this.y, {
          n: 1, c1: '#b6f4ff', c2: '#ffffff', spMin: 20, spMax: 70,
          lifeMin: 0.12, lifeMax: 0.3, ang: -Math.PI / 2
        });
      }
      if (this.hp <= 0) { this.hp = 0; this.kill(); return false; }
      if (this.dotT <= 0) this.dotDmg = 0;
    }

    /* 护盾自然回充 */
    if (this.maxShield > 0 && this.shield < this.maxShield && this.shieldT <= 0) {
      this.shield = Math.min(this.maxShield, this.shield + this.maxShield * 0.10 * dt);
    }

    /* 维修单元：治疗附近友军 */
    if (this.healRate > 0) {
      this.healT -= dt;
      if (this.healT <= 0) {
        this.healT = 0.9;
        var es = this.state.enemies, rr = C.CELL * 2.2, rr2 = rr * rr, healed = 0;
        for (var i = 0; i < es.length; i++) {
          var o = es[i];
          if (!o.alive || o === this) continue;
          var ddx = o.x - this.x, ddy = o.y - this.y;
          if (ddx * ddx + ddy * ddy > rr2) continue;
          var amount = this.healRate * 0.9;
          var before = o.hp;
          o.hp = Math.min(o.maxHp, o.hp + amount);
          o.shield = Math.min(o.maxShield, o.shield + amount * 0.5);
          if (o.hp > before) {
            FX.text(o.x, o.y - o.w * 0.5, '+' + Math.round(o.hp - before), {
              color: '#3ad9c0', size: 11, life: 0.6, vy: -38, vx: 0
            });
            healed++;
          }
        }
        if (healed) {
          FX.ring(this.x, this.y, { r0: 8, r1: rr, life: 0.5, color: '#3ad9c0', width: 1.6, alpha: 0.5 });
          NB.Audio.sfx('healPulse', 420);
        }
      }
    }

    /* 干扰者：周期性瘫痪附近炮塔 */
    if (this.jamCd > 0) {
      this.jamT -= dt;
      if (this.jamT <= 0) {
        this.jamT = this.jamCd;
        var ts = this.state.towers, jr = C.CELL * 2.6, jr2 = jr * jr, jammed = 0;
        for (var t = 0; t < ts.length; t++) {
          var tw = ts[t];
          var tdx = tw.x - this.x, tdy = tw.y - this.y;
          if (tdx * tdx + tdy * tdy > jr2) continue;
          tw.jamT = 2.2;
          jammed++;
        }
        if (jammed) {
          FX.ring(this.x, this.y, { r0: 10, r1: jr, life: 0.6, color: '#b06ae0', width: 2.2 });
          FX.spark(this.x, this.y, {
            n: 14, c1: '#b06ae0', c2: '#e6ccff', spMin: 100, spMax: 300, lifeMin: 0.3, lifeMax: 0.7
          });
          NB.Audio.sfx('jam', 400);
        }
      }
    }

    /* ============================================================
       攻击型敌人：锁定最近的炮塔并脱离路径攻击
       只在难度允许时启用（state.allowAttackers）
       ============================================================ */
    if (this.def.attacker && this.state.allowAttackers) {
      /* 已锁定目标：追击并攻击 */
      if (this.attackTarget && this.attackTarget.alive) {
        var tg = this.attackTarget;
        var adx = tg.x - this.x, ady = tg.y - this.y;
        var ad2 = adx * adx + ady * ady;
        var reach = (this.def.atkRange || 1.5) * C.CELL;
        this.ang = Math.atan2(ady, adx);
        if (ad2 > reach * reach) {
          /* 追击：直接朝目标移动 */
          var asp = this.speedNow() * C.CELL;
          this.x += (adx / Math.sqrt(ad2)) * asp * dt;
          this.y += (ady / Math.sqrt(ad2)) * asp * dt;
          this.bob += dt * 6;
          this.atkWind = 0;
          return true;
        }
        /* 进入攻击距离：停止移动，按冷却攻击 */
        this.atkCdT -= dt;
        this.bob += dt * 5;
        if (this.atkCdT <= 0) {
          this.atkCdT = this.def.atkCd || 1.1;
          this.atkWind = 1;              /* 触发挥臂动画 */
          var dmg = this.def.atkDmg || 10;
          var killed;
          var dref = tg._drone;
          if (dref) {
            /* 命中无人机：代理对象没有 damage() 方法，这里单独结算 */
            if (!dref.alive || dref.hp <= 0) {
              killed = true;
              this.attackTarget = null;
              this.attackCdT = 0.2;
            } else {
              dref.hp -= dmg;
              dref.hitT = 0.14;
              if (dref.hp <= 0) {
                dref.hp = 0;
                tg._bay.killDrone(dref.slot);
                dref.alive = false;
                killed = true;
                this.attackTarget = null;
                this.attackCdT = 0.15;
              } else {
                killed = false;
                this.attackCdT = 0.22;   /* 代理目标只有这一个机体，转头立即再打 */
              }
            }
            /* 代理已失效：把攻击特效打在无人机实际位置 */
            FX.spark(dref.x, dref.y, {
              n: 6, c1: this.color, c2: '#ffffff',
              spMin: 60, spMax: 200, lifeMin: 0.12, lifeMax: 0.3, ang: this.ang
            });
            FX.line(this.x, this.y, dref.x, dref.y, { color: this.color, width: 1.6, life: 0.12 });
            NB.Audio.sfx('meleeHit', 60);
            return true;
          }
          if (typeof tg.damage === 'function') {
            killed = tg.damage(dmg);
          } else {
            this.attackTarget = null;
            return true;
          }
          /* 攻击特效 */
          FX.spark(tg.x, tg.y, {
            n: 6, c1: this.color, c2: '#ffffff',
            spMin: 60, spMax: 200, lifeMin: 0.12, lifeMax: 0.3, ang: this.ang
          });
          FX.line(this.x, this.y, tg.x, tg.y, {
            color: this.color, width: 1.6, life: 0.12
          });
          NB.Audio.sfx('meleeHit', 60);
          if (killed) this.attackTarget = null;
        }
        return true;
      }

      /* 未锁定：寻找范围内最近的炮塔 */
      if (this.attackCdT === undefined) this.attackCdT = 0;
      this.attackCdT -= dt;
      if (this.attackCdT <= 0) {
        this.attackCdT = 0.35;
        var tlist = this.state.towers;
        var best = null, bd2 = Infinity, srch = C.CELL * 3.2;
        var srch2 = srch * srch;
        for (var ti = 0; ti < tlist.length; ti++) {
          var tt = tlist[ti];
          var ddx = tt.x - this.x, ddy = tt.y - this.y;
          var dd2 = ddx * ddx + ddy * ddy;
          if (dd2 < bd2 && dd2 <= srch2) { bd2 = dd2; best = tt; }
          /* 蜂群母舰的无人机体积小、血量低，是更优先的目标 */
          if (tt.kind === 'dronebay' && tt.drones) {
            for (var di2 = 0; di2 < tt.drones.length; di2++) {
              var dnn = tt.drones[di2];
              if (!dnn.alive) continue;
              var ddx2 = dnn.x - this.x, ddy2 = dnn.y - this.y;
              var dd22 = ddx2 * ddx2 + ddy2 * ddy2;
              /* 无人机距离打 0.6 折，让攻击型明显偏向打无人机 */
              if (dd22 * 0.36 < bd2 && dd22 <= srch2) {
                bd2 = dd22 * 0.36;
                best = {
                  get x() { return dnn.x; },
                  get y() { return dnn.y; },
                  get hp() { return dnn.hp; },
                  get alive() { return dnn.alive; },
                  _drone: dnn, _bay: tt, _proxy: true
                };
              }
            }
          }
        }
        if (best) {
          this.attackTarget = best;
          this.atkCdT = 0.5;
          return true;
        }
      }
      /* 未找到目标：正常沿路径前进 */
    }

    var sp = this.speedNow() * C.CELL;
    this.dist += sp * dt;
    if (this.dist >= this.pathTotal) { this.reachBase(); return false; }
    var p = NB.Path.posAt(this.map, this.dist, this.pathIdx);
    this.x = p.x; this.y = p.y;
    this.ang = p.ang;
    this.bob += dt * 6;
    return true;
  };

  /* ============================================================
     炮塔
     ============================================================ */
  var tid = 0;

  /**
   * Tower(state, typeId, gx, gy)
   */
  E.Tower = function (state, typeId, gx, gy) {
    var d = C.TOWERS[typeId];
    this.uid = ++tid;
    this.type = typeId;
    this.def = d;
    this.kind = d.kind;
    this.gx = gx; this.gy = gy;
    var c = NB.Path.cellCenter(gx, gy);
    this.x = c.x; this.y = c.y;
    this.level = 1;
    this.cd = 0;
    this.ang = -Math.PI / 2;
    this.targetAng = this.ang;
    this.invested = C.TOWER_COST[typeId];
    this.kills = 0;
    this.damageDone = 0;
    this.state = state;
    this.fireT = 0;
    this.recoil = 0;
    this.spin = Math.random() * U.TAU;
    this.pulse = Math.random() * U.TAU;
    this.buildT = 0.42;
    this.idle = 0;
    this.overheat = 0;
    this.alive = true;
    /* --- 装甲耐久（会被破袭者/裂装机兵攻击）；d.hp 为绝对值（聚能电弧 60），否则按造价 --- */
    this.maxHp = d.hp != null ? d.hp : Math.round(130 + C.TOWER_COST[typeId] * 1.1);
    this.hp = this.maxHp;
    this.hitT = 0;
    this.jamT = 0;
    this.attackAnim = 0;
    this.repairGlow = 0;     /* 被修复时的发光反馈 */
    /* --- 空中单位：可单格移动 --- */
    this.flying = !!d.flying;
    this.moving = false;
    this.moveTX = this.x; this.moveTY = this.y;
    this.moveSpeed = 320;    /* px/s */
    this.incomeAcc = 0;      /* 矿场资金累积 */
    this.stormT = 0;         /* 电弧脉冲计时 */
    /* --- 东风导弹：升起倒计时 1->0，归零瞬间引爆 --- */
    this.launchT = 0;
    this.launchFlash = 0;
    /* --- 属性缓存（stats() 脏标记） --- */
    this._sig = null;
    this._sc = null;
    this._bd = 0; this._br = 0;
    /* --- 双开叠塔：同格第二座塔的视觉偏移 --- */
    this.stackSlot = 0;
    this.drawX = this.x; this.drawY = this.y;
  };

  /* 炮塔受伤；返回 true 表示已损毁 */
  E.Tower.prototype.damage = function (amount) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.hitT = 0.22;
    if (this.state) this.state.damageDealt -= 0;  /* 保持字段语义：此处不计入玩家伤害 */
    if (this.hp <= 0) { this.hp = 0; this.destroy(); return true; }
    return false;
  };

  /* 炮塔损毁：从战场移除并播放残骸特效 */
  E.Tower.prototype.destroy = function () {
    /* 母舰被摧毁：全部无人机殉爆 */
    if (this.drones) {
      for (var di = 0; di < this.drones.length; di++) {
        var dd = this.drones[di];
        if (!dd.alive) continue;
        FX.explode(dd.x, dd.y, { scale: 0.9, color: this.def.color, c2: '#ffffff', n: 14, smoke: 4, shards: 6 });
        dd.alive = false;
      }
      this.drones.length = 0;
    }
    if (!this.alive) return;
    this.alive = false;
    var st = this.state;
    /* 爆炸特效 */
    FX.explode(this.x, this.y, {
      scale: 0.9, color: '#8a95a3', c2: '#c9d6e2', n: 14, smoke: 6, shards: 10
    });
    FX.shock(this.x, this.y, {
      r0: 6, r1: 44, life: 0.42, color: '#8a95a3', color2: '#ffffff', width: 2.6
    });
    FX.text(this.x, this.y - 14, '损毁', { color: '#ff2e42', size: 13, life: 1.1, vy: -40 });
    if (st.shake) st.shake(7);
    NB.Audio.play('towerDown');
    /* 从战场移除 */
    var i = st.towers.indexOf(this);
    if (i >= 0) st.towers.splice(i, 1);
    if (st.selected === this) { st.selected = null; NB.UI.sidePanelHide(); }
    if (st.hoverTower === this) st.hoverTower = null;
    NB.UI.toast(this.def.name + ' 被摧毁！', 'rd', 1600);
    NB.UI.buildBarRender();
  };

  /* 当前等级属性（含天赋 + 信标加成）
     性能：属性只在「等级 / 天赋 / 信标加成 / 空中移动中」变化时才变。
     用脏标记 _sig 缓存结果，避免每帧为每座塔重算整条 Math.pow 链
     —— 塔数量上百时这是最主要的帧率开销来源。
     注意：调用方不得修改返回对象；需要临时改写请自行浅拷贝。 */
  E.Tower.prototype.stats = function () {
    var bo = this._bonus || null;
    var flyPen = (this.flying && this.moving) ? 1 : 0;
    /* 无 mods 的 state（测试/半初始化路径）用中性值，避免抛错 */
    var m = this.state.mods || { dmg: 1, rate: 1, range: 1, gold: 1, bounty: 1 };
    /* 签名必须覆盖全部影响结果的输入：等级 / 天赋系数 / 信标加成 / 飞行移动。
       早期签名漏了 mods —— 一旦 state.mods 被替换（读档、天赋刷新），
       _sig 字符串不变，塔会继续沿用一整套过期属性。 */
    var sig = this.level + '|' + m.dmg + ',' + m.rate + ',' + m.range + '|' +
      (bo ? (bo.dmg + ',' + bo.rate) : '0') + '|' + flyPen;
    if (this._sig === sig && this._sc) return this._sc;

    var d = this.def, g = this.level - 1;
    var b = d.base, gr = d.growth;
    var bd = bo ? (1 + bo.dmg) : 1;
    var br = bo ? (1 + bo.rate) : 1;

    var s = {
      dmg: b.dmg * Math.pow(gr.dmg, g) * m.dmg * bd,
      rate: b.rate * Math.pow(gr.rate, g) * m.rate * br,
      range: b.range * Math.pow(gr.range, g) * m.range * C.CELL,
      speed: b.speed * C.CELL,
      pierce: b.pierce || 0
    };
    if (b.slow != null) s.slow = Math.min(0.78, b.slow * Math.pow(gr.slow || 1, g));
    if (b.chain != null) s.chain = Math.round(b.chain * Math.pow(gr.chain || 1, g));
    if (b.chainFall != null) s.chainFall = b.chainFall;
    if (b.cone != null) s.cone = b.cone * Math.pow(gr.cone || 1, g);
    if (b.dot != null) s.dot = b.dot * Math.pow(gr.dot || 1, g);
    if (b.armorPen != null) s.armorPen = Math.min(0.9, b.armorPen * Math.pow(gr.armorPen || 1, g));
    if (b.ramp != null) s.ramp = b.ramp * Math.pow(gr.ramp || 1, g);
    if (b.units != null) s.units = Math.max(1, Math.round(b.units * Math.pow(gr.units || 1, g)));
    if (b.boost != null) {
      s.boost = b.boost * Math.pow(gr.boost || 1, g);
      s.boostRate = (b.boostRate || 0) * Math.pow(gr.boostRate || 1, g);
    }
    if (b.healRate != null) {
      s.healRate = b.healRate * Math.pow(gr.healRate || 1, g);
    }
    if (b.pull != null) s.pull = b.pull * Math.pow(gr.pull || 1, g);
    if (b.income != null) s.income = b.income * Math.pow(gr.income || 1, g);
    if (b.delay != null) s.delay = b.delay * Math.pow(gr.delay || 1, g);
    if (b.blast != null) {
      s.blast = b.blast * Math.pow(gr.blast || 1, g) * C.CELL;
      s.blastDmg = b.blastDmg || 0.6;
    }
    /* 空中单位移动中：射速减半 */
    if (flyPen) s.rate *= 0.5;
    /* 信标自身不吃自己的加成 */
    if (this.kind === 'beacon') { s.dmg = 0; s.rate = 1; }
    this._sig = sig;
    this._sc = s;
    return s;
  };

  /* 空中单位：移动到目标格（立即更新格子归属，位置插值） */
  E.Tower.prototype.moveTo = function (gx, gy) {
    if (!this.canMoveTo(gx, gy)) return false;
    var st = this.state;
    var c = NB.Path.cellCenter(gx, gy);
    this.moveTX = c.x; this.moveTY = c.y;
    this.moving = true;
    this.gx = gx; this.gy = gy;
    /* 叠塔槽位随新格重算，飞过去后不再沿用旧偏移 */
    var slot = st.towerCountAt(gx, gy) - 1;
    this.stackSlot = slot < 0 ? 0 : slot;
    this.applyStackOffset();
    st._beaconSig = null;
    NB.Audio.sfx('uiClick', 300);
    return true;
  };

  /* 无人机阵亡：爆炸特效 + 通知母舰进入补充冷却 */
  E.Tower.prototype.killDrone = function (slot) {
    if (!this.drones) return false;
    for (var i = 0; i < this.drones.length; i++) {
      var d = this.drones[i];
      if (d.slot === slot && d.alive) {
        d.alive = false;
        this.respawnT = 0.55;
        FX.explode(d.x, d.y, { scale: 0.85, color: this.def.color, c2: '#ffffff', n: 12, smoke: 3, shards: 5 });
        FX.ring(d.x, d.y, { r0: 3, r1: 22, life: 0.28, color: '#ffffff', width: 1.8 });
        this.pulse += 0.25;
        NB.Audio.sfx('hit', 55);
        return true;
      }
    }
    return false;
  };

  /* 存活无人机数量（侧栏显示） */
  E.Tower.prototype.droneAlive = function () {
    if (!this.drones) return 0;
    var n = 0;
    for (var i = 0; i < this.drones.length; i++) if (this.drones[i].alive) n++;
    return n;
  };

  /* 该格容量：双开夹具 2 座，否则 1 座 */
  E.Tower.capAt = function (st, gx, gy) {
    return (st.stacked && st.stacked[gx + ',' + gy]) ? 2 : 1;
  };

  /* 能否移动到指定格（UI 预览用，无副作用） */
  E.Tower.prototype.canMoveTo = function (gx, gy) {
    if (!this.flying || this.buildT > 0) return false;
    if (!NB.Path.inBounds(gx, gy)) return false;
    /* 已在本格：原地不动不算移动 */
    if (gx === this.gx && gy === this.gy) return false;
    var st = this.state;
    /* 中继站塔位专供 relay，空中单位也不得占用 */
    if (NB.Path.blockedAt(st.map, gx, gy) === 4) return false;
    /* 同格已有 1 座且未装夹具 -> 不可落点 */
    if (st.towerCountAt(gx, gy) >= E.Tower.capAt(st, gx, gy)) return false;
    return true;
  };

  /* 同格叠塔的视觉偏移（第 2 座向左下错开，避免完全重叠） */
  E.Tower.prototype.applyStackOffset = function () {
    var off = C.CELL * 0.19;
    this.stackSlot = this.stackSlot || 0;
    this.drawX = this.x + (this.stackSlot % 2 === 1 ? off : -off);
    this.drawY = this.y + (this.stackSlot >= 1 ? off * 0.7 : 0);
  };

  /* 轨道轰炸引爆：范围伤害 + 距离衰减 */
  E.detonateStrike = function (st, sk) {
    if (sk.beam) return beamStrike(st, sk);
    /* 弹道导弹：落点跟随锁定目标，目标移动也会被追上 -> 百分百命中 */
    if (sk.ballistic) {
      if (sk.locked && sk.locked.alive) { sk.x = sk.locked.x; sk.y = sk.locked.y; }
      else {
        var alt = nearestEnemy(st, sk.x, sk.y, sk.blast * 2.2);
        if (alt) { sk.x = alt.x; sk.y = alt.y; }
      }
    }
    var r2 = sk.blast * sk.blast;
    var killed = 0;
    for (var i = 0; i < st.enemies.length; i++) {
      var e = st.enemies[i];
      if (!e.alive) continue;
      var dx = e.x - sk.x, dy = e.y - sk.y;
      var d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      /* 边缘伤害衰减到 blastDmg */
      var fall = 1 - (Math.sqrt(d2) / sk.blast) * (1 - (sk.blastDmg || 0.6));
      var d = e.damage(sk.dmg * fall, sk.src);
      if (sk.src) sk.src.damageDone += d;
      if (!e.alive) { killed++; if (sk.src) sk.src.kills++; }
    }
    FX.explode(sk.x, sk.y, {
      scale: Math.max(1, sk.blast / (C.CELL * 0.85)),
      color: sk.color || '#ff6b9d', n: 24, smoke: 7, shards: 10
    });
    FX.ring(sk.x, sk.y, { r0: sk.blast * 0.4, r1: sk.blast * 1.6, life: 0.35, color: '#ffffff', width: 2.4 });
    st.shake(6);
    NB.Audio.play('explodeSmall');
    return killed;
  };

  function nearestEnemy(st, x, y, maxR) {
    var best = null, bd = maxR * maxR;
    for (var i = 0; i < st.enemies.length; i++) {
      var e = st.enemies[i];
      if (!e.alive) continue;
      var dx = e.x - x, dy = e.y - y, d2 = dx * dx + dy * dy;
      if (d2 > bd) continue;
      bd = d2; best = e;
    }
    return best;
  }

  /* 古斯塔夫炮：瞬发贯穿光束，沿射线打穿一串目标 */
  function beamStrike(st, sk) {
    var src = sk.src;
    var ox = sk.x, oy = sk.y;
    var aim = sk.aim || { x: ox, y: oy };
    var dx = aim.x - ox, dy = aim.y - oy;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len, uy = dy / len;
    var blast = sk.blast || 0;
    var reach = sk.pierce > 0 ? len * 1.35 + blast * 2 : len + blast * 2;
    var maxHits = sk.pierce > 0 ? sk.pierce + 1 : 999;
    var hits = 0;
    for (var i = 0; i < st.enemies.length && hits < maxHits; i++) {
      var e = st.enemies[i];
      if (!e.alive) continue;
      var rx = e.x - ox, ry = e.y - oy;
      var proj = rx * ux + ry * uy;
      if (proj < -blast || proj > reach) continue;
      var perp = Math.abs(rx * uy - ry * ux);
      var half = Math.max(e.w, e.h) * 0.5;
      var w = half + blast;
      if (perp > w) continue;
      var fall = 1 - (perp / w) * 0.5;
      var d = e.damage(sk.dmg * fall, { armorPen: sk.armorPen || 0 });
      if (src) { src.damageDone += d; }
      if (!e.alive && src) src.kills++;
      hits++;
      FX.hitBurst(e.x, e.y, sk.color, 6);
    }
    var ex = ox + ux * reach, ey = oy + uy * reach;
    FX.line(ox, oy, ex, ey, { color: '#ffffff', width: 5.5, life: 0.16, alpha: 0.95 });
    FX.line(ox, oy, ex, ey, { color: sk.color, width: 11, life: 0.26, alpha: 0.5 });
    FX.glow(ex, ey, { size: 34, life: 0.3, color: sk.color });
    FX.spark(ox, oy, {
      n: 12, c1: '#ffffff', c2: sk.color,
      spMin: 80, spMax: 260, lifeMin: 0.2, lifeMax: 0.5,
      sizeMin: 1.6, sizeMax: 4, ang: Math.atan2(uy, ux)
    });
    st.shake(hits > 0 ? 7 : 3);
    NB.Audio.play('explodeSmall');
    return 0;
  }

  /* 信标光环：为附近友塔提供加成 */
  E.Tower.prototype.applyBeacon = function (towers) {
    if (this.kind !== 'beacon') return;
    /* 建造动画期间不生效，但建造一结束立刻开始（buildT 会归零） */
    if (this.buildT > 0) return;
    var s = this.stats();
    if (!(s.boost > 0)) return;
    var r = s.range, r2 = r * r;
    for (var i = 0; i < towers.length; i++) {
      var t = towers[i];
      if (t === this) continue;
      var dx = t.x - this.x, dy = t.y - this.y;
      if (dx * dx + dy * dy > r2) continue;
      t._bd = Math.max(t._bd || 0, s.boost);
      t._br = Math.max(t._br || 0, s.boostRate);
    }
  };

  /* 信标光环：脏标记重算
     光环只在「建塔/拆塔/移动完成/信标升级」时变化，逐帧全量重算纯属浪费。
     game.js 每帧调用 recomputeBeacon(st)，内部用 _sig 判断是否需要真正重算。 */
  E.recomputeBeacon = function (st) {
    var towers = st.towers;
    /* 签名：塔数 + 信标数 + 每座信标的等级与坐标 + 每座塔的坐标 */
    var sig = towers.length + '|';
    var i, bc = 0;
    for (i = 0; i < towers.length; i++) {
      var t = towers[i];
      t._bd = 0; t._br = 0;
      sig += t.gx + ',' + t.gy + ';';
      if (t.kind === 'beacon' && t.buildT <= 0) { bc++; sig += t.level + ','; }
    }
    if (st._beaconSig === sig) return false;
    st._beaconSig = sig;

    for (i = 0; i < towers.length; i++) {
      var b = towers[i];
      if (b.kind !== 'beacon' || b.buildT > 0) continue;
      var st1 = b.stats();
      if (!(st1.boost > 0)) continue;
      var r = st1.range, r2 = r * r;
      var boost = st1.boost, boostRate = st1.boostRate || 0;
      for (var j = 0; j < towers.length; j++) {
        var o = towers[j];
        if (o === b) continue;
        var dx = o.x - b.x, dy = o.y - b.y;
        if (dx * dx + dy * dy > r2) continue;
        if (o._bd < boost) o._bd = boost;
        if (o._br < boostRate) o._br = boostRate;
      }
    }
    return true;
  };

  /* 是否可移动（空中单位且建造完成） */
  E.Tower.prototype.canMove = function () {
    return !!(this.flying && this.buildT <= 0);
  };

  E.Tower.prototype.upCost = function () {
    if (this.level >= this.def.maxLevel) return 0;
    var lv = this.level;
    return Math.round(C.TOWER_COST[this.type] * Math.pow(C.UPGRADE_COST_MUL, lv - 1) * 0.78);
  };

  E.Tower.prototype.totalDmgAt = function (lv) {
    var d = this.def, b = d.base, gr = d.growth, m = this.state.mods;
    return b.dmg * Math.pow(gr.dmg, lv - 1) * m.dmg;
  };
  E.Tower.prototype.totalRateAt = function (lv) {
    var d = this.def, b = d.base, gr = d.growth, m = this.state.mods;
    return b.rate * Math.pow(gr.rate, lv - 1) * m.rate;
  };
  E.Tower.prototype.totalRangeAt = function (lv) {
    var d = this.def, b = d.base, gr = d.growth, m = this.state.mods;
    return b.range * Math.pow(gr.range, lv - 1) * m.range;
  };

  E.Tower.prototype.sellValue = function () {
    return Math.floor(this.invested * C.sellRate());
  };

  E.Tower.prototype.upgrade = function () {
    var c = this.upCost();
    if (!c || this.level >= this.def.maxLevel) return false;
    if (this.state.gold < c) return false;
    this.state.gold -= c;
    this.invested += c;
    this.level++;
    this._sig = null;   /* 等级变了，属性缓存失效 */
    this.state._beaconSig = null;
    FX.upgrade(this.x, this.y, this.def.color);
    NB.Audio.play('upgrade');
    if (this.state.onUpgrade) this.state.onUpgrade(this);
    return true;
  };

  /* 目标选择：路径进度最大的敌人 */
  E.Tower.prototype.pickTarget = function (enemies, s) {
    /* 真实圆形距离判定：s.range 很大（东风导弹 999）时平方比较既慢又会溢出 */
    var best = null, bestD = -1, r = s.range;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!e.alive) continue;
      if (e.dist < bestD) continue;
      if (r < 9000) {
        var dx = e.x - this.x, dy = e.y - this.y;
        if (dx * dx + dy * dy > r * r) continue;
      }
      bestD = e.dist; best = e;
    }
    return best;
  };

  E.Tower.prototype.update = function (dt, enemies) {
    if (this.buildT > 0) this.buildT -= dt;
    /* 东风导弹升起动画 + 发射闪光衰减 */
    if (this.launchFlash > 0) this.launchFlash -= dt;
    if (this.launchT > 0) {
      this.launchT = Math.max(0, this.launchT - dt / Math.max(0.2, (this.def.base.delay || 3.4)));
    }
    /* 空中单位移动（移动中仍可攻击） */
    if (this.flying && this.moving) {
      var mdx = this.moveTX - this.x, mdy = this.moveTY - this.y;
      var md = Math.sqrt(mdx * mdx + mdy * mdy);
      var mstep = this.moveSpeed * dt;
      if (md <= mstep || md < 0.5) {
        this.x = this.moveTX; this.y = this.moveTY;
        this.moving = false;
      } else {
        this.x += mdx / md * mstep;
        this.y += mdy / md * mstep;
      }
      /* 移动中射击精度/射速下降 */
      this._movePenalty = true;
      /* 移动尾焰 */
      if (Math.random() < dt * 20) {
        FX.spark(this.x, this.y, {
          n: 1, c1: this.def.color, c2: '#ffffff',
          spMin: 5, spMax: 30, lifeMin: 0.15, lifeMax: 0.35,
          sizeMin: 1, sizeMax: 2.4
        });
      }
    }
    if (this.fireT > 0) this.fireT -= dt;
    if (this.recoil > 0) this.recoil -= dt * 4;
    if (this.repairGlow > 0) this.repairGlow = Math.max(0, this.repairGlow - dt * 2.2);
    if (this.hitT > 0) this.hitT -= dt;
    if (this.jamT > 0) this.jamT -= dt;
    this.spin += dt * (this.kind === 'tesla' ? 2.6 : 0.7);
    this.pulse += dt * 2;
    this.cd -= dt;

    var s = this.stats();
    /* 空中单位移动中的射速减半已在 stats() 内处理 */

    /* --- 被干扰：停火 --- */
    if (this.jamT > 0) {
      this.jammed = true;
      return;
    }
    this.jammed = false;

    /* --- 寒霜场：持续光环 --- */
    if (this.kind === 'slow') {
      var r2 = s.range * s.range;
      var touched = 0;
      for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (!e.alive) continue;
        var dx = e.x - this.x, dy = e.y - this.y;
        if (dx * dx + dy * dy > r2) continue;
        e.slow(s.slow, 0.4);
        e.damage(s.dmg * dt * 1.6, this);
        this.damageDone += s.dmg * dt * 1.6;
        touched++;
      }
      if (touched && Math.random() < dt * 6) FX.frostPulse(this.x, this.y, s.range * 0.5, this.def.color);
      this.cd = 0;
      return;
    }

    /* --- 地刺：无需目标，对范围内敌人持续伤害+减速+流血 --- */
    if (this.kind === 'spike') {
      var sr2 = s.range * s.range;
      var hit = 0;
      for (var k = 0; k < enemies.length; k++) {
        var se = enemies[k];
        if (!se.alive) continue;
        if (Math.abs(se.x - this.x) > s.range || Math.abs(se.y - this.y) > s.range) continue;
        var sdx = se.x - this.x, sdy = se.y - this.y;
        if (sdx * sdx + sdy * sdy > sr2) continue;
        se.damage(s.dmg * dt, this);
        this.damageDone += s.dmg * dt;
        se.slow(s.slow, 0.35);
        se.applyDot(s.dot, this);
        hit++;
      }
      this.attackAnim = hit > 0 ? 1 : Math.max(0, (this.attackAnim || 0) - dt * 3);
      this.cd = 0;
      return;
    }

    /* --- 增幅信标：不攻击 --- */
    if (this.kind === 'beacon') {
      this.attackAnim = (this.attackAnim || 0) * 0.94 + 0.06;
      this.cd = 0;
      return;
    }

    /* --- 矿场：每秒产出资金，无攻击 --- */
    if (this.kind === 'mine') {
      this.incomeAcc += s.income * dt;
      if (this.incomeAcc >= 1) {
        var add = Math.floor(this.incomeAcc);
        this.incomeAcc -= add;
        this.state.gold += add;
        this.damageDone += 0;
        /* 金币反馈（节流） */
        if (Math.random() < dt * 4) {
          FX.coin(this.x + (Math.random() - 0.5) * 20, this.y - 8, 1);
        }
      }
      this.attackAnim = 0.5 + 0.5 * Math.sin(this.pulse);
      this.cd = 0;
      return;
    }

    /* --- 通讯中继站：无攻击，常驻信号灯 --- */
    if (this.kind === 'relay') {
      this.attackAnim = 0.5 + 0.5 * Math.sin(this.pulse * 1.4);
      this.cd = 0;
      return;
    }

    /* --- 聚能电弧风暴：超大范围脉冲电击（自身极脆） --- */
    if (this.kind === 'storm') {
      var sr2 = s.range * s.range;
      this.stormT -= dt;
      var pulseOn = this.stormT <= 0;
      if (pulseOn) this.stormT = 1 / Math.max(0.2, s.rate);
      var hitN = 0, lineN = 0;
      for (var si2 = 0; si2 < enemies.length; si2++) {
        var se2 = enemies[si2];
        if (!se2.alive) continue;
        var sdx = se2.x - this.x, sdy = se2.y - this.y;
        if (sdx * sdx + sdy * sdy > sr2) continue;
        hitN++;
        if (pulseOn) {
          var sd = se2.damage(s.dmg, this);
          this.damageDone += sd;
          if (!se2.alive) this.kills++;
          /* 电弧弹道线（限 10 条，避免特效爆炸） */
          if (lineN < 10) {
            lineN++;
            FX.line(this.x, this.y, se2.x, se2.y, {
              color: this.def.color, width: 1.8, life: 0.13
            });
          }
        }
      }
      this.attackAnim = hitN > 0
        ? Math.min(1, (this.attackAnim || 0) + dt * 6)
        : Math.max(0, (this.attackAnim || 0) - dt * 3);
      if (pulseOn && hitN > 0) NB.Audio.sfx(this.def.sfx, 120);
      this.cd = 0;
      return;
    }

    /* --- 毒气塔：持续毒雾，周期性叠加中毒流血（DOT 无视护甲与护盾） --- */
    if (this.kind === 'gas') {
      var ga2 = s.range * s.range;
      this.gasT = (this.gasT || 0) - dt;
      var gasTick = this.gasT <= 0;
      if (gasTick) this.gasT = 0.4;
      var gasHit = 0;
      for (var gi = 0; gi < enemies.length; gi++) {
        var ge = enemies[gi];
        if (!ge.alive) continue;
        var gdx = ge.x - this.x, gdy = ge.y - this.y;
        if (gdx * gdx + gdy * gdy > ga2) continue;
        gasHit++;
        ge.slow(0.16, 0.5);
        if (gasTick) ge.applyDot(s.dot, this);
      }
      this.attackAnim = gasHit > 0
        ? Math.min(1, (this.attackAnim || 0) + dt * 4)
        : Math.max(0, (this.attackAnim || 0) - dt * 2);
      /* 毒雾涌出粒子 */
      if (gasHit > 0 && Math.random() < dt * 7) {
        var ga3 = Math.random() * U.TAU, gd2 = Math.random() * s.range * 0.85;
        FX.spark(this.x + Math.cos(ga3) * gd2, this.y + Math.sin(ga3) * gd2, {
          n: 1, c1: this.def.color, c2: '#e8ffd0',
          spMin: 6, spMax: 26, lifeMin: 0.5, lifeMax: 1.1,
          sizeMin: 2.4, sizeMax: 5.2, grav: -26, drag: 0.94
        });
      }
      this.cd = 0;
      return;
    }

    /* --- 重力井：强力减速 + 把敌人往回拖 --- */
    if (this.kind === 'gravity') {
      var gv2 = s.range * s.range;
      var gvHit = 0;
      for (var pi = 0; pi < enemies.length; pi++) {
        var pe = enemies[pi];
        if (!pe.alive) continue;
        var pdx = pe.x - this.x, pdy = pe.y - this.y;
        if (pdx * pdx + pdy * pdy > gv2) continue;
        gvHit++;
        pe.slow(s.slow, 0.3);
        /* 往回拖：减少行进距离（不小于 0），下一帧位置由 dist 重算 */
        pe.dist = Math.max(0, pe.dist - s.pull * dt);
        if (Math.random() < dt * 3) {
          FX.spark(pe.x, pe.y, {
            n: 1, c1: this.def.color, c2: '#e8d8ff',
            spMin: 10, spMax: 40, lifeMin: 0.2, lifeMax: 0.45,
            sizeMin: 1.4, sizeMax: 3
          });
        }
      }
      this.attackAnim = gvHit > 0
        ? Math.min(1, (this.attackAnim || 0) + dt * 5)
        : Math.max(0, (this.attackAnim || 0) - dt * 3);
      this.cd = 0;
      return;
    }

    /* --- 修复厂：持续修复范围内友军装甲 --- */
    if (this.kind === 'repair') {
      var pr = s.range, pr2 = pr * pr;
      var repaired = 0;
      for (var ri = 0; ri < this.state.towers.length; ri++) {
        var rt = this.state.towers[ri];
        if (rt === this || rt.hp >= rt.maxHp) continue;
        var rdx = rt.x - this.x, rdy = rt.y - this.y;
        if (rdx * rdx + rdy * rdy > pr2) continue;
        /* 按比例恢复：每秒 healRate 点，最低 2% 上限 */
        var amount = s.healRate * dt;
        var before = rt.hp;
        rt.hp = Math.min(rt.maxHp, rt.hp + amount);
        rt.repairGlow = Math.min(1, rt.repairGlow + dt * 4);
        if (rt.hp > before) {
          repaired++;
          /* 修复反馈粒子 */
          if (Math.random() < dt * 9) {
            FX.spark(rt.x, rt.y, {
              n: 1, c1: '#5bff9b', c2: '#ffffff',
              spMin: 15, spMax: 55, lifeMin: 0.25, lifeMax: 0.55,
              grav: -60, ang: -Math.PI / 2
            });
          }
        }
      }
      /* --- 修复基地：基地在射程内时恢复耐久 ---
         速率为炮塔修复的 12%（刻意压低，避免无限回血），
         多座修复厂各自独立累加，一起建可线性提升修复速度 */
      var base = this.state.map.base;
      var bdx = base.x - this.x, bdy = base.y - this.y;
      if (bdx * bdx + bdy * bdy <= pr2 && this.state.lives < this.state.maxLives) {
        this.state.livesFrac = (this.state.livesFrac || 0) + s.healRate * 0.12 * dt;
        if (this.state.livesFrac >= 1) {
          var add = Math.floor(this.state.livesFrac);
          this.state.livesFrac -= add;
          var beforeL = this.state.lives;
          this.state.lives = Math.min(this.state.maxLives, this.state.lives + add);
          if (this.state.lives > beforeL) {
            repaired++;
            /* 基地修复反馈 */
            FX.spark(base.x, base.y, {
              n: 3, c1: '#5bff9b', c2: '#ffffff',
              spMin: 20, spMax: 70, lifeMin: 0.3, lifeMax: 0.6,
              grav: -50, ang: -Math.PI / 2
            });
            if (Math.random() < dt * 1.5) {
              NB.UI.toast('反应堆修复 +' + (this.state.lives - beforeL) + ' 耐久', 'gr', 1400);
            }
          }
        }
      }
      /* 修复束视觉 */
      this.attackAnim = repaired > 0 ? Math.min(1, (this.attackAnim || 0) + dt * 5)
        : Math.max(0, (this.attackAnim || 0) - dt * 3);
      /* 焊枪声（有修复目标才响，节流到 340ms） */
      if (repaired > 0) NB.Audio.sfx('repairWork', 340);
      this.cd = 0;
      return;
    }

    /* --- 光矛：蓄能递增 --- */
    if (this.kind === 'lance') {
      this.rampT = (this.rampT || 0) + dt;
    }

    /* --- 蜂群：多单位 --- */
    if (this.kind === 'swarm') {
      if (!this.units) {
        this.units = [];
        var un = s.units || 3;
        for (var u = 0; u < un; u++) {
          this.units.push({ ang: u * U.TAU / un, r: C.CELL * 0.34, x: this.x, y: this.y, fireT: 0 });
        }
      }
      /* 单位跟随 */
      for (var u2 = 0; u2 < this.units.length; u2++) {
        var un2 = this.units[u2];
        un2.ang += dt * 2.2;
        var tx = this.x + Math.cos(un2.ang) * un2.r;
        var ty = this.y + Math.sin(un2.ang) * un2.r;
        un2.x += (tx - un2.x) * Math.min(1, dt * 9);
        un2.y += (ty - un2.y) * Math.min(1, dt * 9);
        if (un2.fireT > 0) un2.fireT -= dt;
      }
    }

    /* ============================================================
       蜂群母舰：本体不放弹，靠 5 架无人机作战
       - 无人机各自环绕巡飞（轨道半径/相位/角速度各不相同）
       - 独立索敌、独立开火、独立血量
       - 被击毁后母舰自动补充，维持满编
       ============================================================ */
    if (this.kind === 'dronebay') {
      var maxU = 5;
      var target4 = this.pickTarget(enemies, s);
      this.target = target4;
      if (target4) {
        this.targetAng = Math.atan2(target4.y - this.y, target4.x - this.x);
        this.idle = 0;
      } else {
        this.idle += dt;
        this.targetAng = -Math.PI / 2 + Math.sin(this.idle * 0.7) * 0.7;
      }
      /* 母舰自身缓慢转向（不参与瞄准判定） */
      this.ang = U.angLerp(this.ang, this.targetAng, Math.min(1, dt * 3));

      if (!this.drones) this.drones = [];

      /* --- 补充：满编校验（含重生延迟） --- */
      this.respawnT = Math.max(0, (this.respawnT || 0) - dt);
      var aliveN = 0;
      for (var q = 0; q < this.drones.length; q++) if (this.drones[q].alive) aliveN++;
      if (aliveN < maxU && this.respawnT <= 0) {
        var slot = null;
        for (var q2 = 0; q2 < maxU && !slot; q2++) {
          var used = false;
          for (var q3 = 0; q3 < this.drones.length; q3++) {
            if (this.drones[q3].alive && this.drones[q3].slot === q2) { used = true; break; }
          }
          if (!used) slot = q2;
        }
        if (slot != null) {
          var dAng = slot * U.TAU / maxU + this.pulse;
          var dR = C.CELL * 0.30;
          var hpU = 55 + this.level * 16 + (s.income || 0) * 0;
          this.drones.push({
            slot: slot, alive: true,
            ang: dAng, r: dR,
            orbit: 1.05 + (slot % 3) * 0.22,      /* 各机轨道角速度不同 */
            wob: slot * 1.7,                        /* 相位差，避免重叠 */
            wobF: 1.6 + (slot % 2) * 0.5,
            x: this.x + Math.cos(dAng) * dR,
            y: this.y + Math.sin(dAng) * dR,
            vx: 0, vy: 0, ang: 0,
            hp: hpU, maxHp: hpU,
            fireT: 0.25 + slot * 0.14,             /* 错峰开火，避免同帧齐射 */
            hitT: 0, muzzle: 0
          });
          /* 放出特效：舱口闪光 + 绿色粒子 */
          FX.ring(this.x, this.y, { r0: 4, r1: C.CELL * 0.5, life: 0.32, color: this.def.color, width: 2 });
          FX.spark(this.x, this.y, {
            n: 6, c1: this.def.color, c2: '#ffffff',
            spMin: 30, spMax: 90, lifeMin: 0.2, lifeMax: 0.45,
            sizeMin: 1.2, sizeMax: 2.6
          });
          this.respawnT = 0.45;   /* 补充间隔，避免瞬间刷满 */
        }
      }

      /* --- 无人机巡飞 + 独立开火 --- */
      var anyFiring = false;
      for (var d = 0; d < this.drones.length; d++) {
        var dr = this.drones[d];
        if (!dr.alive) continue;
        if (dr.hitT > 0) dr.hitT -= dt;
        if (dr.muzzle > 0) dr.muzzle -= dt;
        /* 轨道运动 + 呼吸式半径起伏 */
        dr.ang += dt * dr.orbit;
        var rr = dr.r + Math.sin(this.state.time * dr.wobF + dr.wob) * C.CELL * 0.11;
        var tx2 = this.x + Math.cos(dr.ang) * rr;
        var ty2 = this.y + Math.sin(dr.ang) * rr;
        var nvx = (tx2 - dr.x), nvy = (ty2 - dr.y);
        var nd = Math.sqrt(nvx * nvx + nvy * nvy);
        if (this.moving) {
          /* 母舰转移途中：无人机随舰刚性跟随，避免掉队 */
          dr.x = tx2; dr.y = ty2;
          dr.vx = (this.moveTX - this.x); dr.vy = (this.moveTY - this.y);
          dr.ang2 = Math.atan2(this.moveTY - this.y, this.moveTX - this.x);
        } else {
          /* 悬停巡飞：用带阻尼的追踪收敛到轨道点。
             早期实现是「恒定速度 + 0.6px 死区」，会冲过目标后带着旧速度折返，
             表现为整队抽搐（用户报「动态咋抽了」）。 */
          /* 固定步长保护：切标签页回来或高倍速时 dt 可能很大，
             不夹住会把无人机直接甩出轨道。 */
          var ndt = Math.min(dt, 1 / 30);
          var maxSp = C.CELL * 2.6;
          /* 转向力：指向轨道点，速度上限保证轨道速度稳定 */
          var nux = nd > 0.001 ? nvx / nd : 0;
          var nuy = nd > 0.001 ? nvy / nd : 0;
          var steer = ndt * 11;
          dr.vx += nux * maxSp * steer;
          dr.vy += nuy * maxSp * steer;
          /* 阻力只跟速度成正比（不跟距离），接近目标时不会被压死，
             所以无人机始终保持真实的轨道速度，机头朝向也不会乱翻。 */
          var drag = 1 - Math.min(0.9, ndt * 3.4);
          dr.vx *= drag; dr.vy *= drag;
          var sp2 = Math.sqrt(dr.vx * dr.vx + dr.vy * dr.vy);
          if (sp2 > maxSp) { dr.vx = dr.vx / sp2 * maxSp; dr.vy = dr.vy / sp2 * maxSp; sp2 = maxSp; }
          /* 贴到轨道点就吸附，避免在目标周围绕小圈 */
          if (nd < 0.6 && sp2 < C.CELL * 0.8) { dr.x = tx2; dr.y = ty2; }
          else { dr.x += dr.vx * ndt; dr.y += dr.vy * ndt; }
          /* 机头朝向：速度足够大才更新，否则保持上一帧 */
          if (dr.vx * dr.vx + dr.vy * dr.vy > 9) dr.ang2 = Math.atan2(dr.vy, dr.vx);
        }

        if (dr.fireT > 0) dr.fireT -= dt;
        if (target4 && dr.fireT <= 0 && this.buildT <= 0) {
          var ut = this.pickTarget(enemies, s);
          if (ut) {
            dr.fireT = 1 / Math.max(0.05, s.rate);
            dr.muzzle = 0.1;
            st_pushBullet(this, ut, s, dr.x, dr.y);
            this.fireT = 0.1;
            anyFiring = true;
          } else {
            dr.fireT = 0.2;
          }
        }
      }
      /* 回收已死机体，保持数组有界 */
      for (var z = this.drones.length - 1; z >= 0; z--) {
        if (!this.drones[z].alive) this.drones.splice(z, 1);
      }
      this.attackAnim = anyFiring ? Math.min(1, (this.attackAnim || 0) + dt * 6) : Math.max(0, (this.attackAnim || 0) - dt * 3);
      this.cd = 0;
      return;   /* 本体绝不发射，直接返回 */
    }

    /* --- 常规：需要目标 --- */
    var target = this.pickTarget(enemies, s);
    this.target = target;
    if (target) {
      var ta = Math.atan2(target.y - this.y, target.x - this.x);
      this.targetAng = ta;
      var turnSpeed = (this.kind === 'beam' || this.kind === 'tesla' || this.kind === 'swarm') ? 12 : 8;
      this.ang = U.angLerp(this.ang, ta, Math.min(1, dt * turnSpeed));
      this.idle = 0;
    } else {
      this.idle += dt;
      this.targetAng = -Math.PI / 2 + Math.sin(this.idle * 0.7) * 0.7;
      this.ang = U.angLerp(this.ang, this.targetAng, Math.min(1, dt * 2.2));
      if (this.kind === 'lance') this.rampT = 0;
    }

    if (!target || this.buildT > 0) return;
    var diff = Math.abs(U.angDiff(this.ang, this.targetAng));
    var needAim = (this.kind === 'missile' || this.kind === 'swarm') ? 0.5 : 0.16;
    if (diff > needAim) return;

    if (this.kind === 'swarm') {
      /* 每个单位独立开火 */
      for (var u3 = 0; u3 < this.units.length; u3++) {
        var uu = this.units[u3];
        if (uu.fireT > 0) continue;
        uu.fireT = 1 / s.rate;
        var tgt2 = this.pickTarget(enemies, s);
        if (!tgt2) { uu.fireT = 0.25; continue; }
        st_pushBullet(this, tgt2, s, uu.x, uu.y);
      }
      this.fireT = 0.1;
      this.attackAnim = 1;
      return;
    }

    if (this.cd > 0) return;

    this.cd = 1 / s.rate;
    this.fireT = 0.14;
    this.recoil = 1;
    this.attackAnim = 1;
    this.fire(this, target, s);
  };

  /* 蜂群开火辅助 */
  function st_pushBullet(tw, tgt, s, x, y) {
    var ang = Math.atan2(tgt.y - y, tgt.x - x);
    var b = new E.Bullet(tw.state, tw, tgt, s, x, y);
    b.vx = Math.cos(ang) * b.speed;
    b.vy = Math.sin(ang) * b.speed;
    b.small = true;
    tw.state.bullets.push(b);
    FX.muzzle(x, y, ang, tw.def.color);
    NB.Audio.sfx('shootSwarm', 90);
  }

  /* ---------- 开火 ---------- */
  E.Tower.prototype.fire = function (t, target, s) {
    var st = this.state;
    var ang = this.ang;
    var mx = this.x + Math.cos(ang) * (this.w ? this.w : C.CELL * 0.42);
    var my = this.y + Math.sin(ang) * (this.w ? this.w : C.CELL * 0.42);

    switch (this.kind) {
      case 'bullet':
        st.bullets.push(new E.Bullet(st, this, target, s, mx, my));
        FX.muzzle(mx, my, ang, this.def.color);
        NB.Audio.sfx(this.def.sfx, 55);
        break;

      case 'beam': {
        /* 轨道炮：瞬发贯穿直线 */
        var maxD = s.range;
        var dx = Math.cos(ang), dy = Math.sin(ang);
        var hitList = [];
        var bestT = maxD;
        for (var i = 0; i < st.enemies.length; i++) {
          var e = st.enemies[i];
          if (!e.alive) continue;
          var rx = e.x - this.x, ry = e.y - this.y;
          var proj = rx * dx + ry * dy;
          if (proj < 0 || proj > bestT) continue;
          var perp2 = rx * rx + ry * ry - proj * proj;
          var rad = e.w * 0.62;
          if (perp2 > rad * rad) continue;
          bestT = proj;
          hitList.push({ e: e, t: proj });
        }
        hitList.sort(function (a, b) { return a.t - b.t; });
        var pierced = 0;
        for (var k = 0; k < hitList.length && pierced < (s.pierce || 1); k++) {
          var tg = hitList[k].e;
          var dd = tg.damage(s.dmg, this);
          this.damageDone += dd;
          if (!tg.alive) this.kills++;
          FX.hitBurst(tg.x, tg.y, this.def.color, 10);
          pierced++;
        }
        var ex = this.x + dx * bestT, ey = this.y + dy * bestT;
        FX.beam(this.x, this.y, ex, ey, { color: this.def.color, width: 5, life: 0.2 });
        FX.line(this.x, this.y, ex, ey, { color: '#ffffff', width: 1.6, life: 0.16 });
        FX.spark(this.x, this.y, {
          ang: ang, spread: 0.3, n: 8, c1: this.def.color, c2: '#ffffff',
          spMin: 140, spMax: 380, lifeMin: 0.1, lifeMax: 0.28, drag: 0.86
        });
        if (st.shake) st.shake(3.2);
        NB.Audio.play(this.def.sfx);
        break;
      }

      case 'tesla': {
        /* 电弧链：跳跃 */
        var cur = target;
        var dmg = s.dmg;
        var chain = s.chain || 3;
        var hit = {};
        var px = this.x, py = this.y;
        var jumps = 0;
        while (cur && jumps < chain) {
          if (hit[cur.uid]) break;
          hit[cur.uid] = 1;
          FX.line(px, py, cur.x, cur.y, {
            color: this.def.color, width: 2.6, life: 0.16, jag: 8, seg: 8
          });
          FX.line(px, py, cur.x, cur.y, {
            color: '#ffffff', width: 1, life: 0.12, jag: 5, seg: 6, alpha: 0.8
          });
          var d2 = cur.damage(dmg, this);
          this.damageDone += d2;
          if (!cur.alive) this.kills++;
          px = cur.x; py = cur.y;
          dmg *= (s.chainFall || 0.78);
          jumps++;
          /* 找下一个最近的未命中敌人 */
          var next = null, nd = s.range * 0.85;
          for (var j = 0; j < st.enemies.length; j++) {
            var c2 = st.enemies[j];
            if (!c2.alive || hit[c2.uid]) continue;
            var ddx = c2.x - px, ddy = c2.y - py;
            var dd2 = ddx * ddx + ddy * ddy;
            if (dd2 < nd * nd) { nd = dd2; next = c2; }
          }
          cur = next;
        }
        FX.glow(this.x, this.y, { size: 26, life: 0.16, color: this.def.color });
        NB.Audio.play(this.def.sfx);
        break;
      }

      case 'arc': {
        /* 扇形持续伤害 */
        var hits = 0;
        var half = s.cone || 1.0;
        for (var a2 = 0; a2 < st.enemies.length; a2++) {
          var ea = st.enemies[a2];
          if (!ea.alive) continue;
          var rx2 = ea.x - this.x, ry2 = ea.y - this.y;
          var dist2 = Math.sqrt(rx2 * rx2 + ry2 * ry2);
          if (dist2 > s.range) continue;
          var aa = Math.atan2(ry2, rx2);
          if (Math.abs(U.angDiff(ang, aa)) > half) continue;
          var dm = ea.damage(s.dmg, this);
          this.damageDone += dm;
          if (!ea.alive) this.kills++;
          hits++;
          if (hits < 6) FX.hitBurst(ea.x, ea.y, this.def.color, 3);
        }
        /* 视觉：短锥形光束 */
        var len = s.range * 0.62;
        var spread = half;
        for (var sgn = -1; sgn <= 1; sgn += 2) {
          var ea2 = ang + spread * sgn * 0.8;
          FX.line(this.x + Math.cos(ang) * 12, this.y + Math.sin(ang) * 12,
            this.x + Math.cos(ea2) * len, this.y + Math.sin(ea2) * len,
            { color: this.def.color, width: 2.2, life: 0.11, alpha: 0.75 });
        }
        FX.glow(this.x + Math.cos(ang) * 14, this.y + Math.sin(ang) * 14, {
          size: 20, life: 0.1, color: '#fff3cf'
        });
        NB.Audio.sfx(this.def.sfx, 70);
        break;
      }

      case 'missile': {
        st.bullets.push(new E.Bullet(st, this, target, s, mx, my));
        FX.muzzle(mx, my, ang, this.def.color);
        FX.smoke(mx, my, { n: 3, c1: '#5a6478', c2: '#0d1220', sp: 30, lifeMin: 0.25, lifeMax: 0.5, sizeMin: 3, sizeMax: 7 });
        NB.Audio.sfx(this.def.sfx, 90);
        break;
      }

      case 'sniper': {
        /* 狙击：高速重弹 + 制退冲击 */
        st.bullets.push(new E.Bullet(st, this, target, s, mx, my));
        FX.muzzle(mx, my, ang, this.def.color);
        FX.ring(mx, my, { r0: 2, r1: 16, life: 0.2, color: this.def.color, width: 1.8 });
        NB.Audio.sfx(this.def.sfx, 80);
        break;
      }

      case 'hover': {
        /* 浮游炮台：普通弹丸（移动中射速减半在 update 里处理） */
        st.bullets.push(new E.Bullet(st, this, target, s, mx, my));
        FX.muzzle(mx, my, ang, this.def.color);
        NB.Audio.sfx(this.def.sfx, 50);
        break;
      }

      case 'scatter': {
        /* 熔渣散射：扇形内瞬发全覆盖 */
        var half = (s.cone || 2.6) * 0.5;
        var rr = s.range * s.range;
        var hitCnt = 0, lineCnt = 0;
        for (var sci = 0; sci < st.enemies.length; sci++) {
          var sce = st.enemies[sci];
          if (!sce.alive) continue;
          var scx = sce.x - this.x, scy = sce.y - this.y;
          if (scx * scx + scy * scy > rr) continue;
          if (Math.abs(U.angDiff(this.ang, Math.atan2(scy, scx))) > half) continue;
          var scd = sce.damage(s.dmg, this);
          this.damageDone += scd;
          if (!sce.alive) this.kills++;
          hitCnt++;
          if (lineCnt < 8) {
            lineCnt++;
            FX.line(this.x, this.y, sce.x, sce.y, {
              color: this.def.color, width: 2.2, life: 0.15
            });
          }
        }
        FX.muzzle(mx, my, ang, this.def.color);
        FX.ring(mx, my, { r0: 2, r1: 20, life: 0.2, color: this.def.color, width: 1.6 });
        if (hitCnt) st.shake(2);
        NB.Audio.sfx(this.def.sfx, 80);
        break;
      }

      case 'orbital': {
        /* 轨道轰炸：延迟落点，全图射程；飞行期间敌人可能离开，需要预判 */
        var delay = s.delay || 1.4;
        st.strikes.push({
          x: target.x, y: target.y, t: delay,
          dmg: s.dmg, blast: s.blast, blastDmg: s.blastDmg,
          color: this.def.color, src: this
        });
        /* 落点警示环（随延迟收缩） */
        FX.ring(target.x, target.y, {
          r0: s.blast, r1: 4, life: delay, color: this.def.color, width: 2.2
        });
        FX.glow(target.x, target.y, { size: 18, life: 0.2, color: this.def.color });
        NB.Audio.sfx(this.def.sfx, 90);
        break;
      }

      case 'dfm': {
        /* 东风导弹：轨道校准后落点锁定当前目标，飞行期不可改瞄 -> 百分百命中 */
        var dDelay = s.delay || 3.4;
        /* 可见发射：弹头从发射井升起，倒计时走完才引爆 */
        this.launchT = 1;
        st.strikes.push({
          x: target.x, y: target.y, t: dDelay, locked: target,
          dmg: s.dmg, blast: s.blast, blastDmg: s.blastDmg,
          color: this.def.color, src: this, ballistic: 1
        });
        FX.ring(target.x, target.y, { r0: s.blast, r1: 6, life: dDelay, color: this.def.color, width: 3 });
        FX.ring(target.x, target.y, { r0: 6, r1: s.blast * 1.1, life: dDelay * 0.5, color: '#ffffff', width: 1.2 });
        FX.glow(target.x, target.y, { size: 30, life: 0.3, color: this.def.color });
        FX.spark(this.x, this.y, {
          n: 14, c1: '#ffffff', c2: this.def.color,
          spMin: 120, spMax: 320, lifeMin: 0.3, lifeMax: 0.7,
          sizeMin: 2, sizeMax: 5, ang: Math.atan2(target.y - this.y, target.x - this.x)
        });
        st.shake(4);
        this.launchFlash = 0.45;
        NB.Audio.play('explodeSmall');
        break;
      }

      case 'gustav': {
        /* 古斯塔夫炮：长校准后瞬发贯穿光束，穿透多目标 */
        var gDelay = s.delay || 1.15;
        st.strikes.push({
          x: this.x, y: this.y, t: gDelay, from: this, aim: { x: target.x, y: target.y },
          dmg: s.dmg, pierce: s.pierce, armorPen: s.armorPen,
          blast: s.blast, blastDmg: s.blastDmg,
          color: this.def.color, src: this, beam: 1
        });
        FX.ring(this.x, this.y, { r0: 46, r1: 8, life: gDelay, color: this.def.color, width: 2.4 });
        NB.Audio.sfx(this.def.sfx, 140);
        break;
      }

      case 'torpedo': {
        /* 巡飞弹：高速弹丸 + 轻微追踪 */
        var tp = new E.Bullet(st, this, target, s, mx, my);
        tp.speed = s.speed || 30;
        tp.turn = 3.2;          /* 转向速率 rad/s，Bullet.update 内做角度插值 */
        tp.homing = 1;
        tp.pierce = s.pierce || 0;
        st.bullets.push(tp);
        FX.muzzle(mx, my, ang, this.def.color);
        FX.spark(mx, my, { n: 4, c1: '#ffffff', c2: this.def.color, spMin: 30, spMax: 90, lifeMin: 0.15, lifeMax: 0.35, sizeMin: 1, sizeMax: 2.6 });
        NB.Audio.sfx(this.def.sfx, 60);
        break;
      }

      case 'lance': {
        /* 镭射光矛：蓄能越久越粗、越疼 */
        var rampP = U.clamp((this.rampT || 0) / (s.ramp || 2), 0, 1);
        var ldmg = s.dmg * (1 + rampP * 1.6);
        var ld = target.damage(ldmg, this, { armorPen: s.armorPen });
        this.damageDone += ld;
        if (!target.alive) this.kills++;
        FX.line(mx, my, target.x, target.y, {
          color: this.def.color, width: 1.6 + rampP * 4.2, life: 0.12
        });
        FX.glow(mx, my, { size: 10 + rampP * 12, life: 0.1, color: this.def.color });
        FX.hitBurst(target.x, target.y, this.def.color, 4 + Math.round(rampP * 5));
        if (Math.random() < 0.5) {
          FX.line(mx, my, target.x, target.y, {
            color: '#ffffff', width: 0.8 + rampP * 1.4, life: 0.08, jag: 3, seg: 5, alpha: 0.75
          });
        }
        this.rampT = 0;
        NB.Audio.sfx(this.def.sfx, 70);
        break;
      }
    }
    void st;
  };

  /* ============================================================
     弹丸
     ============================================================ */
  E.Bullet = function (state, tower, target, s, x, y) {
    this.state = state;
    this.tower = tower;
    this.target = target;
    this.dmg = s.dmg;
    this.speed = s.speed || 0;
    this.blast = s.blast || 0;
    this.blastDmg = s.blastDmg || 0.6;
    this.color = tower.def.color;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.alive = true;
    this.life = 3.2;
    this.size = tower.type === 'missile' ? 5.4 : (tower.type === 'sniper' ? 4.2 : 3.4);
    this.trail = [];
    this.ang = tower.ang;
    this.homing = tower.type === 'missile';
    this.turn = this.homing ? 6.5 : 0;
    /* 曳光粒子：跟随弹体，命中/消亡时自动消失 */
    this.tracer = FX.tracer(x, y, {
      life: 0.5, width: (tower.type === 'missile' || tower.type === 'sniper') ? 2.8 : 2.2,
      color: tower.type === 'missile' ? '#ffd76a' : tower.def.color,
      color2: '#ffffff'
    });
    this.tracerAcc = 0;
    var d = U.dist(x, y, target.x, target.y);
    if (d < 1) { this.vx = Math.cos(tower.ang) * this.speed; this.vy = Math.sin(tower.ang) * this.speed; }
    else { this.vx = (target.x - x) / d * this.speed; this.vy = (target.y - y) / d * this.speed; }
  };

  E.Bullet.prototype.update = function (dt) {
    this.life -= dt;
    if (this.life <= 0) { this.expire(); return false; }

    /* 曳光跟随：每帧推入位置，弹体消亡时粒子自然淡出 */
    if (this.tracer && this.tracer.on) {
      this.tracer.x = this.x; this.tracer.y = this.y;
      this.tracerAcc += dt;
      if (this.tracerAcc > 0.012) {
        this.tracerAcc = 0;
        FX.tracerPush(this.tracer, this.x, this.y);
      }
    }

    if (this.homing && this.target && this.target.alive) {
      var want = Math.atan2(this.target.y - this.y, this.target.x - this.x);
      var cur = Math.atan2(this.vy, this.vx);
      var na = cur + U.angDiff(cur, want) * Math.min(1, dt * this.turn);
      this.vx = Math.cos(na) * this.speed;
      this.vy = Math.sin(na) * this.speed;
    }
    this.ang = Math.atan2(this.vy, this.vx);
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    /* 轨迹记录 */
    this.trail.push(this.x, this.y);
    if (this.trail.length > 12) this.trail.splice(0, 2);

    /* 出界 */
    if (this.x < -40 || this.y < -40 || this.x > NB.Path.WIDTH + 40 || this.y > NB.Path.HEIGHT + 40) {
      this.alive = false; return false;
    }

    /* 命中判定 */
    var tg = this.target;
    if (tg && tg.alive) {
      var r = tg.w * 0.55;
      if (U.dist2(this.x, this.y, tg.x, tg.y) <= r * r) {
        this.hit(tg);
        return false;
      }
    } else if (!this.homing) {
      /* 目标已死：检查是否撞到别的敌人 */
      var es = this.state.enemies;
      for (var i = 0; i < es.length; i++) {
        var e = es[i];
        if (!e.alive) continue;
        var rr = e.w * 0.55;
        if (U.dist2(this.x, this.y, e.x, e.y) <= rr * rr) { this.hit(e); return false; }
      }
    } else {
      /* 追踪弹失去目标：继续飞向最后位置，超时自毁 */
      this.target = null;
    }
    return true;
  };

  E.Bullet.prototype.hit = function (e) {
    var st = this.state;
    var dm = e.damage(this.dmg, this.tower);
    this.tower.damageDone += dm;
    if (!e.alive) this.tower.kills++;
    FX.hitBurst(e.x, e.y, this.color, 7);

    if (this.blast > 0) {
      FX.explode(this.x, this.y, {
        scale: this.blast / C.CELL, color: this.color, c2: '#ffd76a',
        n: 14, smoke: 4, shards: 6
      });
      if (st.shake) st.shake(2.4);
      NB.Audio.sfx('explodeSmall', 60);
      var r2 = this.blast * this.blast;
      for (var i = 0; i < st.enemies.length; i++) {
        var o = st.enemies[i];
        if (!o.alive || o === e) continue;
        var dd = U.dist2(this.x, this.y, o.x, o.y);
        if (dd > r2) continue;
        var falloff = 1 - 0.45 * (Math.sqrt(dd) / this.blast);
        var d2 = o.damage(this.dmg * this.blastDmg * falloff, this.tower);
        this.tower.damageDone += d2;
        if (!o.alive) this.tower.kills++;
      }
    }
    this.alive = false;
  };

  E.Bullet.prototype.expire = function () {
    if (this.blast > 0) {
      FX.explode(this.x, this.y, { scale: 0.8, color: this.color, n: 8, smoke: 2, shards: 3 });
    }
    this.alive = false;
  };

  E.Bullet.prototype.render = function (ctx) {
    var i;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* 轨迹 */
    if (this.trail.length >= 4) {
      ctx.strokeStyle = U.rgba(this.color, 0.5);
      ctx.lineWidth = this.size * 0.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(this.trail[0], this.trail[1]);
      for (i = 2; i < this.trail.length; i += 2) ctx.lineTo(this.trail[i], this.trail[i + 1]);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
    }
    ctx.translate(this.x, this.y);
    ctx.rotate(this.ang);
    if (this.homing) {
      /* 导弹外形 */
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.moveTo(this.size * 1.5, 0);
      ctx.lineTo(-this.size, this.size * 0.7);
      ctx.lineTo(-this.size * 0.4, 0);
      ctx.lineTo(-this.size, -this.size * 0.7);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(this.size * 0.3, 0, this.size * 0.34, 0, U.TAU); ctx.fill();
      /* 尾焰 */
      ctx.fillStyle = flameGrad(ctx, this.size);
      ctx.beginPath();
      ctx.moveTo(-this.size, -this.size * 0.45);
      ctx.lineTo(-this.size * 3.2, 0);
      ctx.lineTo(-this.size, this.size * 0.45);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = this.color;
      ctx.beginPath(); ctx.arc(0, 0, this.size, 0, U.TAU); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, this.size * 0.48, 0, U.TAU); ctx.fill();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  };

})(window);
