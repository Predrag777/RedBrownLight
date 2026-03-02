// =====================================================================
//  PIRATE BRAIN — Aggressive Bully AI  (fully self-contained)
//  Fall Guys-style physics-based collision chaos
//  Handles ALL movement, push physics, stun, red-light braking,
//  targeting, charging, and collision resolution.
// =====================================================================

// Pirate personality constants
const PIRATE = {
  // Aggression
  AGGRO_RADIUS: 25,
  RAM_SPEED_BONUS: 1.4,
  CHARGE_COOLDOWN: 2.5,
  CHARGE_DURATION: 0.8,

  // Push physics
  PUSH_FORCE: 35,
  PUSH_FORWARD: 15,
  BUMP_RADIUS: 3.5,
  KNOCKBACK_SELF: 8,

  // Targeting
  LEADER_BIAS: 0.7,
  PLAYER_BIAS: 0.35,
  RED_PUSH_BIAS: 0.5,
  SHIELD_SEEK_DIST: 12,

  // Movement personality
  CRUISE_SPEED_RATIO: 0.55,
  LATERAL_AGGRO: 40,
  WOBBLE_AMP: 3,
  WOBBLE_FREQ: 2.5,

  // Stunts
  STUN_DURATION: 0.4,
};

/**
 * PirateBrain — fully self-contained brain for pirate-type AI bots.
 * Handles push velocity, stun, movement, red-light braking, targeting,
 * charging, lateral movement, and collision resolution.
 */
export class PirateBrain {
  constructor(entity) {
    this.e = entity;
    this.aggression = 0.5 + Math.random() * 0.5;
    this.target = null;
    this.targetIdx = -1;
    this.chargeTmr = 0;
    this.charging = false;
    this.chargeDur = 0;
    this.chargeDir = { x: 0, z: 0 };
    this.brainStunTmr = 0;           // brain's own stun (after ramming)
    this.wobblePhase = Math.random() * Math.PI * 2;
    this.cruiseHold = 0;
    this.shieldTarget = null;
    this.lastRedPush = false;
  }

  /**
   * Main update — called every frame from AIEntity.update().
   * This brain manages EVERYTHING: push decay, stun, movement, braking.
   */
  update(dt, light, player, allAI, myIdx, cfg, targetSpeedFn, clampFn, lerpFn) {
    const e = this.e;

    // --- Blasted check ---
    if (e.blasted) return;

    // --- Push velocity decay (moved from AIEntity) ---
    if (Math.abs(e.vx) > 0.1 || Math.abs(e.vz) > 0.1) {
      e.x += e.vx * dt;
      e.z += e.vz * dt;
      e.vx *= (1 - cfg.PUSH_RECOVERY * dt);
      e.vz *= (1 - cfg.PUSH_RECOVERY * dt);
    }

    // --- Entity-level stun (from applyPush) ---
    if (e.stunTmr > 0) {
      e.stunTmr -= dt;
      e.speed = Math.max(0, (e.speed || 0) - 60 * dt);
      return;
    }

    // --- Brain-level stun (from ramming) ---
    if (this.brainStunTmr > 0) {
      this.brainStunTmr -= dt;
      e.speed = Math.max(0, (e.speed || 0) - 60 * dt);
      return;
    }

    this.wobblePhase += dt * PIRATE.WOBBLE_FREQ;
    this.chargeTmr = Math.max(0, this.chargeTmr - dt);

    // === TARGETING ===
    this._pickTarget(player, allAI, myIdx, light);

    // === MOVEMENT DECISION ===
    const isBrown   = light.isBrown;
    const isTurning = light.isTurning;
    const isRed     = light.isRed;

    if (isBrown) {
      // GREEN PHASE — accelerate, cruise, charge
      this.lastRedPush = false;     // reset dirty-trick flag

      if (this.charging) {
        this.cruiseHold += dt * 1.8;
      } else {
        const targetHold = 0.6 + this.aggression * 0.3;
        this.cruiseHold = lerpFn(this.cruiseHold, targetHold, dt * 3);
      }
      const desiredSpd = targetSpeedFn(this.cruiseHold)
                       * (this.charging ? PIRATE.RAM_SPEED_BONUS : 1);
      e.speed = lerpFn(e.speed || 0, desiredSpd, dt * cfg.ACCEL_LERP);

    } else if (isTurning) {
      // TURNING PHASE — Granny is rotating.  Start braking early!
      // Dirty trick: one last push if a target is close
      if (this.target && !this.lastRedPush
          && Math.random() < PIRATE.RED_PUSH_BIAS * this.aggression * dt) {
        this.lastRedPush = true;
        // Keep some speed for one last bump
        e.speed = lerpFn(e.speed || 0, 15, dt * 4);
      } else {
        // Aggressive braking during turning so we're safe by the time red hits
        this.cruiseHold = 0;
        e.speed = Math.max(0, (e.speed || 0) - cfg.BASE_DECEL * 2.5 * dt);
      }

    } else {
      // RED PHASE — full stop, must be below VEL_THRESHOLD
      this.cruiseHold = 0;
      // Emergency brake: very aggressive decel
      e.speed = Math.max(0, (e.speed || 0) - cfg.BASE_DECEL * 3.0 * dt);
    }

    // === LATERAL MOVEMENT ===
    let latSpd = 0;

    // Only allow lateral movement during brown (not turning/red)
    if (isBrown) {
      if (this.charging && this.target) {
        const dx = this.target.x - e.x;
        latSpd = Math.sign(dx) * PIRATE.LATERAL_AGGRO * this.aggression;

        this.chargeDur -= dt;
        if (this.chargeDur <= 0) {
          this.charging = false;
          this.brainStunTmr = PIRATE.STUN_DURATION * 0.5;
        }
      } else if (this.shieldTarget) {
        const dx = this.shieldTarget.x - e.x;
        if (Math.abs(dx) > 2) latSpd = Math.sign(dx) * cfg.LATERAL_SPEED * 0.6;
      } else {
        latSpd = Math.sin(this.wobblePhase) * PIRATE.WOBBLE_AMP;
        if (Math.abs(e.x) > cfg.FIELD_W * 0.3) latSpd -= Math.sign(e.x) * 5;
      }
    }

    // Apply forward + lateral
    e.z += (e.speed || 0) * dt;
    e.x += latSpd * dt;
    e.x = clampFn(e.x, -cfg.FIELD_W / 2 + 2, cfg.FIELD_W / 2 - 2);
    e.z = clampFn(e.z, 0, cfg.FIELD_L);

    // === INITIATE CHARGE (only during brown) ===
    if (!this.charging && this.chargeTmr <= 0 && isBrown && this.target) {
      const dx = this.target.x - e.x;
      const dz = this.target.z - e.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < PIRATE.AGGRO_RADIUS && dist > PIRATE.BUMP_RADIUS) {
        this.charging = true;
        this.chargeDur = PIRATE.CHARGE_DURATION;
        this.chargeTmr = PIRATE.CHARGE_COOLDOWN * (0.8 + Math.random() * 0.4);
        this.chargeDir = { x: dx / dist, z: dz / dist };
      }
    }
  }

  /**
   * Pick a target — prefers leaders and the player.
   */
  _pickTarget(player, allAI, myIdx, light) {
    const e = this.e;

    if (!player.blasted && Math.random() < PIRATE.PLAYER_BIAS * this.aggression) {
      const dx = player.x - e.x;
      const dz = player.z - e.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < PIRATE.AGGRO_RADIUS * 1.5) {
        this.target = { x: player.x, z: player.z, speed: player.speed, isPlayer: true };
        this.targetIdx = -1;
        this._pickShield(allAI, myIdx);
        return;
      }
    }

    let bestScore = -Infinity;
    let bestTarget = null;
    let bestIdx = -1;

    for (let i = 0; i < allAI.length; i++) {
      if (i === myIdx) continue;
      const a = allAI[i];
      if (a.blasted) continue;

      const dx = a.x - e.x;
      const dz = a.z - e.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > PIRATE.AGGRO_RADIUS * 2) continue;

      const leaderScore = (a.z / 500) * PIRATE.LEADER_BIAS;
      const proxScore = (1 - dist / (PIRATE.AGGRO_RADIUS * 2)) * (1 - PIRATE.LEADER_BIAS);
      const score = leaderScore + proxScore;

      if (score > bestScore) {
        bestScore = score;
        bestTarget = a;
        bestIdx = i;
      }
    }

    if (!player.blasted) {
      const dx = player.x - e.x;
      const dz = player.z - e.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < PIRATE.AGGRO_RADIUS * 2) {
        const leaderScore = (player.z / 500) * PIRATE.LEADER_BIAS * 1.2;
        const proxScore = (1 - dist / (PIRATE.AGGRO_RADIUS * 2)) * (1 - PIRATE.LEADER_BIAS);
        const score = leaderScore + proxScore;
        if (score > bestScore) {
          bestTarget = { x: player.x, z: player.z, speed: player.speed, isPlayer: true };
          bestIdx = -1;
        }
      }
    }

    if (bestTarget) {
      this.target = bestTarget.isPlayer
        ? bestTarget
        : { x: bestTarget.x, z: bestTarget.z, speed: bestTarget.speed || 0, isPlayer: false };
      this.targetIdx = bestIdx;
    } else {
      this.target = null;
      this.targetIdx = -1;
    }

    this._pickShield(allAI, myIdx);
  }

  /**
   * Pick a bot to use as a "shield" — stay behind them so they get blasted first.
   */
  _pickShield(allAI, myIdx) {
    const e = this.e;
    let bestShield = null, bestDist = Infinity;

    for (let i = 0; i < allAI.length; i++) {
      if (i === myIdx || allAI[i].blasted) continue;
      const a = allAI[i];
      const dx = a.x - e.x, dz = a.z - e.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dz > 2 && dz < PIRATE.SHIELD_SEEK_DIST && dist < PIRATE.SHIELD_SEEK_DIST && dist < bestDist) {
        bestDist = dist;
        bestShield = a;
      }
    }
    this.shieldTarget = bestShield;
  }

  /**
   * Handle collision with another entity — called from collision system.
   * Returns push vector applied to the OTHER entity.
   */
  resolveCollision(other, isOtherPlayer) {
    const e = this.e;
    const dx = other.x - e.x;
    const dz = other.z - e.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.01) return null;

    const nx = dx / dist, nz = dz / dist;

    const spd = e.speed || 0;
    const force = PIRATE.PUSH_FORCE * (0.5 + 0.5 * this.aggression) * (spd / 50);
    const fwdForce = PIRATE.PUSH_FORWARD * (spd / 50);

    const pushX = nx * force;
    const pushZ = nz * Math.abs(fwdForce);

    // Self knockback
    e.x -= nx * PIRATE.KNOCKBACK_SELF * 0.3;
    e.speed = Math.max(0, spd - PIRATE.KNOCKBACK_SELF);

    // Self stun
    if (this.charging) {
      this.charging = false;
      this.brainStunTmr = PIRATE.STUN_DURATION;
    }

    return { x: pushX, z: pushZ, force };
  }
}
