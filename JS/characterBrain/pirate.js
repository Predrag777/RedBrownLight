// =====================================================================
//  PIRATE BRAIN — AI that behaves exactly like the player
//  Runs forward (accelerates during brown & turning, brakes on red).
//  90% chance to make a mistake and not stop in time → destroyed → respawns.
// =====================================================================

export class PirateBrain {
  constructor(entity) {
    this.e = entity;
    this.accT = 0;            // acceleration hold timer (same as player)
    this.willFail = false;    // decided per cycle: mistake this round?
    this.decided = false;     // has the decision been made this cycle?
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

    const isBrown   = light.isBrown;
    const isTurning = light.isTurning;

    if (isBrown) {
      // ---- BROWN: accelerate forward (same as player holding W) ----
      this.decided = false;
      this.accT += dt;
      e.speed = lerpFn(e.speed || 0, targetSpeedFn(this.accT), dt * cfg.ACCEL_LERP);

    } else if (isTurning) {
      // ---- TURNING: decide once — 90% will keep running (mistake) ----
      if (!this.decided) {
        this.decided = true;
        this.willFail = Math.random() < 0.90;
      }

      if (this.willFail) {
        // MISTAKE — keeps accelerating, won't brake in time
        this.accT += dt;
        e.speed = lerpFn(e.speed || 0, targetSpeedFn(this.accT), dt * cfg.ACCEL_LERP);
      } else {
        // SMART — releases "W" immediately, friction braking like player
        this.accT = 0;
        if (e.speed > 0) {
          const friction = 1 - ((e.speed || 0) / cfg.MAX_SPEED) * 0.6;
          e.speed = Math.max(0, (e.speed || 0) - cfg.BASE_DECEL * Math.max(friction, 0.2) * dt);
        }
      }

    } else {
      // ---- RED: always release + brake (same as player releasing W) ----
      this.accT = 0;
      if (e.speed > 0) {
        const friction = 1 - ((e.speed || 0) / cfg.MAX_SPEED) * 0.6;
        e.speed = Math.max(0, (e.speed || 0) - cfg.BASE_DECEL * Math.max(friction, 0.2) * dt);
      }
    }

    // Forward only
    e.z += (e.speed || 0) * dt;
    e.x = clampFn(e.x, -cfg.FIELD_W / 2 + 2, cfg.FIELD_W / 2 - 2);
    e.z = clampFn(e.z, 0, cfg.FIELD_L);
  }

  resolveCollision(other, isOtherPlayer) {
    return null;
  }
}
