// =====================================================================
//  PIRATE BRAIN — Predictive runner AI
//  Estimates remaining brown-light time and plans speed accordingly.
//  Calculates safe max speed based on braking physics.
//  25% chance per cycle to misjudge and not brake properly.
// =====================================================================

export class PirateBrain {
  constructor(entity) {
    this.e = entity;
    this.accT = 0;
    this.willFail = false;
    this.decided = false;
    this.wasStopped = true;
  }

  /** Simulate braking from `speed` down to VEL_THRESHOLD, return time needed */
  _brakeTime(speed, cfg) {
    let s = Math.max(0, speed || 0);
    let t = 0;
    const step = 0.02;
    const maxT = 8;

    while (s > cfg.VEL_THRESHOLD && t < maxT) {
      const friction = 1 - (s / cfg.MAX_SPEED) * 0.6;
      const decel = cfg.BASE_DECEL * Math.max(friction, 0.2);
      s = Math.max(0, s - decel * step);
      t += step;
    }
    return t;
  }

  /** Binary-search for the max speed brakeable within `window` seconds */
  _safeSpeed(window, cfg) {
    let lo = 0;
    let hi = cfg.MAX_SPEED;

    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) * 0.5;
      if (this._brakeTime(mid, cfg) <= window) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  update(dt, light, player, allAI, myIdx, cfg, targetSpeedFn, clampFn, lerpFn) {
    const e = this.e;
    if (e.blasted) return;

    // --- Push velocity decay ---
    if (Math.abs(e.vx) > 0.1 || Math.abs(e.vz) > 0.1) {
      e.x += e.vx * dt;
      e.z += e.vz * dt;
      e.vx *= (1 - cfg.PUSH_RECOVERY * dt);
      e.vz *= (1 - cfg.PUSH_RECOVERY * dt);
    }

    // --- Stun ---
    if (e.stunTmr > 0) {
      e.stunTmr -= dt;
      e.speed = Math.max(0, (e.speed || 0) - 60 * dt);
      this.accT = 0;
      return;
    }

    const isBrown = !!light.isBrown;
    const isTurning = !!light.isTurning;

    if (isBrown) {
      this.decided = false;

      if (this.wasStopped) {
        this.accT = 0;
        this.wasStopped = false;
      }

      const sh = Math.max(0.7, 1 - (light.cycle || 0) * 0.015);
      const brownMin = cfg.BROWN_MIN * sh;
      const elapsed = light.timer || 0;
      const danger = clampFn(elapsed / brownMin, 0, 1);

      const brakeWindow = cfg.TURN_DURATION + cfg.GRACE;
      const safeSpd = this._safeSpeed(brakeWindow, cfg);

      if (danger < 0.7) {
        this.accT += dt;
        const target = Math.min(targetSpeedFn(this.accT), safeSpd);
        e.speed = lerpFn(e.speed || 0, target, dt * cfg.ACCEL_LERP);
      } else if (danger < 1.0) {
        this.accT += dt * 0.3;
        const target = safeSpd * 0.8;
        e.speed = lerpFn(e.speed || 0, target, dt * cfg.ACCEL_LERP);
      } else {
        const softCap = safeSpd * 0.6;
        if ((e.speed || 0) > softCap) {
          e.speed = Math.max(0, (e.speed || 0) - cfg.BASE_DECEL * 0.3 * dt);
        } else {
          this.accT += dt * 0.15;
          const target = Math.min(targetSpeedFn(this.accT), softCap);
          e.speed = lerpFn(e.speed || 0, target, dt * (cfg.ACCEL_LERP * 0.5));
        }
      }

    } else if (isTurning) {
      if (!this.decided) {
        this.decided = true;
        this.willFail = Math.random() < 0.25;
      }

      if (!this.willFail) {
        this.accT = 0;
        if ((e.speed || 0) > 0) {
          const friction = 1 - ((e.speed || 0) / cfg.MAX_SPEED) * 0.6;
          const decel = cfg.BASE_DECEL * Math.max(friction, 0.2);
          e.speed = Math.max(0, (e.speed || 0) - decel * dt);
        }
      } else {
        const failTarget = cfg.VEL_THRESHOLD + 2;
        e.speed = lerpFn(e.speed || 0, failTarget, dt * 2.5);
      }

    } else {
      if (this.willFail && (e.speed || 0) > cfg.VEL_THRESHOLD) {
        const friction = 1 - ((e.speed || 0) / cfg.MAX_SPEED) * 0.6;
        const decel = cfg.BASE_DECEL * Math.max(friction, 0.2) * 1.5;
        e.speed = Math.max(0, (e.speed || 0) - decel * dt);
      } else {
        const friction = 1 - ((e.speed || 0) / cfg.MAX_SPEED) * 0.6;
        const decel = cfg.BASE_DECEL * Math.max(friction, 0.2);
        e.speed = Math.max(0, (e.speed || 0) - decel * dt);
      }
      this.accT = 0;
      this.wasStopped = true;
    }

    e.z += (e.speed || 0) * dt;
    e.x = clampFn(e.x, -cfg.FIELD_W / 2 + 2, cfg.FIELD_W / 2 - 2);
    e.z = clampFn(e.z, 0, cfg.FIELD_L);
  }

  resolveCollision(other, isOtherPlayer) {
    return null;
  }
}
