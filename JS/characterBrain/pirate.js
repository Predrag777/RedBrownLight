// =====================================================================
//  PIRATE BRAIN — Aggressive Bully AI
//  Fall Guys-style physics-based collision chaos
//  High aggression, rams leaders, uses others as shields,
//  pushes victims into Red Light violations
// =====================================================================

// Pirate personality constants
const PIRATE = {
  // Aggression
  AGGRO_RADIUS: 25,        // detection range for targets
  RAM_SPEED_BONUS: 1.4,    // speed multiplier when charging
  CHARGE_COOLDOWN: 2.5,    // seconds between charges
  CHARGE_DURATION: 0.8,    // how long a charge lasts

  // Push physics
  PUSH_FORCE: 35,          // lateral push force on collision
  PUSH_FORWARD: 15,        // forward momentum transferred
  BUMP_RADIUS: 3.5,        // collision radius
  KNOCKBACK_SELF: 8,       // self-knockback on collision

  // Targeting
  LEADER_BIAS: 0.7,        // prefer targeting leaders vs nearest
  PLAYER_BIAS: 0.35,       // extra chance to target player specifically
  RED_PUSH_BIAS: 0.5,      // chance to specifically push during red transition
  SHIELD_SEEK_DIST: 12,    // distance to seek a "shield" bot

  // Movement personality
  CRUISE_SPEED_RATIO: 0.55, // maintain ~55% max speed normally
  LATERAL_AGGRO: 40,        // lateral speed when charging
  WOBBLE_AMP: 3,            // random lateral wobble amplitude
  WOBBLE_FREQ: 2.5,         // wobble frequency

  // Stunts
  STUN_DURATION: 0.4,       // self-stun after ramming
};

/**
 * PirateBrain — decides movement & targeting for pirate-type AI bots.
 * Attaches to an AIEntity and drives its position/speed each frame.
 */
export class PirateBrain {
  constructor(entity) {
    this.e = entity;            // the AIEntity this brain controls
    this.aggression = 0.5 + Math.random() * 0.5;  // 0.5–1.0 personality variance
    this.target = null;         // current target {x, z, speed, isPlayer}
    this.targetIdx = -1;
    this.chargeTmr = 0;         // cooldown timer
    this.charging = false;
    this.chargeDur = 0;
    this.chargeDir = { x: 0, z: 0 }; // normalized charge direction
    this.stunTmr = 0;
    this.wobblePhase = Math.random() * Math.PI * 2;
    this.cruiseHold = 0;        // simulated "hold" for targetSpeed calc
    this.shieldTarget = null;   // bot to hide behind
    this.lastRedPush = false;   // track if we did a red-light push this cycle
  }

  /**
   * Main update — called every frame.
   * @param {number} dt
   * @param {object} light — LightSystem
   * @param {object} player — Player
   * @param {Array} allAI — all AIEntity array
   * @param {number} myIdx — this bot's index in allAI
   * @param {object} cfg — CFG constants
   * @param {Function} targetSpeedFn — targetSpeed(hold) function
   * @param {Function} clampFn
   * @param {Function} lerpFn
   */
  update(dt, light, player, allAI, myIdx, cfg, targetSpeedFn, clampFn, lerpFn) {
    const e = this.e;

    // --- Stun ---
    if (this.stunTmr > 0) {
      this.stunTmr -= dt;
      e.speed = Math.max(0, (e.speed || 0) - 60 * dt);
      return;
    }

    // --- Blasted check ---
    if (e.blasted) return;

    this.wobblePhase += dt * PIRATE.WOBBLE_FREQ;
    this.chargeTmr = Math.max(0, this.chargeTmr - dt);

    // === TARGETING ===
    this._pickTarget(player, allAI, myIdx, light);

    // === MOVEMENT DECISION ===
    const isBrown = light.isBrown || light.isTurning;
    const isRed = light.isRed;

    if (isBrown) {
      // Accelerate — cruise at medium speed, faster when charging
      if (this.charging) {
        this.cruiseHold += dt * 1.8;
      } else {
        // Cruise at medium speed
        const targetHold = 0.6 + this.aggression * 0.3; // 0.6–0.9
        this.cruiseHold = lerpFn(this.cruiseHold, targetHold, dt * 3);
      }
      const desiredSpd = targetSpeedFn(this.cruiseHold) * (this.charging ? PIRATE.RAM_SPEED_BONUS : 1);
      e.speed = lerpFn(e.speed || 0, desiredSpd, dt * cfg.ACCEL_LERP);
    } else {
      // RED LIGHT — brake hard, but…
      this.cruiseHold = 0;

      // Dirty trick: if we have a target nearby during turning/early red, give them a last push
      if (light.isTurning && this.target && !this.lastRedPush && Math.random() < PIRATE.RED_PUSH_BIAS * this.aggression) {
        this.lastRedPush = true;
        // Don't brake immediately — keep some speed for one last bump
        e.speed = lerpFn(e.speed || 0, 15, dt * 4);
      } else {
        // Actually brake
        e.speed = Math.max(0, (e.speed || 0) - cfg.BASE_DECEL * 0.8 * dt);
      }

      if (isBrown) this.lastRedPush = false;
    }

    // === LATERAL MOVEMENT ===
    let latSpd = 0;

    if (this.charging && this.target) {
      // Charge toward target laterally
      const dx = this.target.x - e.x;
      latSpd = Math.sign(dx) * PIRATE.LATERAL_AGGRO * this.aggression;

      this.chargeDur -= dt;
      if (this.chargeDur <= 0) {
        this.charging = false;
        this.stunTmr = PIRATE.STUN_DURATION * 0.5; // small recovery
      }
    } else if (this.shieldTarget && isBrown) {
      // Drift toward shield bot
      const dx = this.shieldTarget.x - e.x;
      if (Math.abs(dx) > 2) latSpd = Math.sign(dx) * cfg.LATERAL_SPEED * 0.6;
    } else {
      // Random wobble + slight drift toward center
      latSpd = Math.sin(this.wobblePhase) * PIRATE.WOBBLE_AMP;
      if (Math.abs(e.x) > cfg.FIELD_W * 0.3) latSpd -= Math.sign(e.x) * 5;
    }

    // Apply forward + lateral
    e.z += (e.speed || 0) * dt;
    e.x += latSpd * dt;
    e.x = clampFn(e.x, -cfg.FIELD_W / 2 + 2, cfg.FIELD_W / 2 - 2);
    e.z = clampFn(e.z, 0, cfg.FIELD_L);

    // === INITIATE CHARGE ===
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

    // Chance to target player specifically
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

    // Find leader or nearest
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

      // Score: prefer leaders (higher z) and closer bots
      const leaderScore = (a.z / 500) * PIRATE.LEADER_BIAS;
      const proxScore = (1 - dist / (PIRATE.AGGRO_RADIUS * 2)) * (1 - PIRATE.LEADER_BIAS);
      const score = leaderScore + proxScore;

      if (score > bestScore) {
        bestScore = score;
        bestTarget = a;
        bestIdx = i;
      }
    }

    // Also consider player as target with leader bias
    if (!player.blasted) {
      const dx = player.x - e.x;
      const dz = player.z - e.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < PIRATE.AGGRO_RADIUS * 2) {
        const leaderScore = (player.z / 500) * PIRATE.LEADER_BIAS * 1.2; // player is extra juicy
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
      if (i === myIdx || (allAI[i].blasted)) continue;
      const a = allAI[i];
      const dx = a.x - e.x, dz = a.z - e.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Shield = someone slightly ahead and close
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

    // Push force scales with speed and aggression
    const spd = e.speed || 0;
    const force = PIRATE.PUSH_FORCE * (0.5 + 0.5 * this.aggression) * (spd / 50);
    const fwdForce = PIRATE.PUSH_FORWARD * (spd / 50);

    // Apply to other
    const pushX = nx * force;
    const pushZ = nz * Math.abs(fwdForce);

    // Self knockback
    e.x -= nx * PIRATE.KNOCKBACK_SELF * 0.3;
    e.speed = Math.max(0, spd - PIRATE.KNOCKBACK_SELF);

    // Self stun
    if (this.charging) {
      this.charging = false;
      this.stunTmr = PIRATE.STUN_DURATION;
    }

    return { x: pushX, z: pushZ, force };
  }
}
