// =====================================================================
//  MY PLAYER — Movement & physics logic for the human-controlled player
//  Extracted from game.js Player class
// =====================================================================

// These are passed in from game.js via constructor/update
// so the module stays self-contained.

export class Player {
  constructor(cfg, lerpFn, clampFn, targetSpeedFn, speedTierFn) {
    this._cfg = cfg;
    this._lerp = lerpFn;
    this._clamp = clampFn;
    this._targetSpeed = targetSpeedFn;
    this._speedTier = speedTierFn;

    this.x = 0;
    this.z = 0;
    this.speed = 0;
    this.latSpd = 0;
    this.accT = 0;
    this.blasted = false;
    this.stunTmr = 0;
  }

  update(dt, input, light) {
    const cfg = this._cfg;
    const lerp = this._lerp;
    const clamp = this._clamp;
    const targetSpeed = this._targetSpeed;

    // Stunned or blasted — decelerate and skip input
    if (this.blasted || this.stunTmr > 0) {
      this.stunTmr -= dt;
      this.speed = Math.max(0, this.speed - 60 * dt);
      this.accT = 0;
      return;
    }

    // Forward acceleration — only during brown or turning phase
    const canAccel = input.fwd && (light.isBrown || light.isTurning);
    if (canAccel) {
      this.accT += dt;
      this.speed = lerp(this.speed, targetSpeed(this.accT), dt * cfg.ACCEL_LERP);
    } else {
      this.accT = 0;
      if (this.speed > 0) {
        const friction = 1 - (this.speed / cfg.MAX_SPEED) * 0.6;
        this.speed = Math.max(0, this.speed - cfg.BASE_DECEL * Math.max(friction, 0.2) * dt);
      }
    }

    // Lateral movement
    this.latSpd = 0;
    if (input.left)  this.latSpd =  cfg.LATERAL_SPEED;
    if (input.right) this.latSpd = -cfg.LATERAL_SPEED;

    // Apply movement
    this.z += this.speed * dt;
    this.x += this.latSpd * dt;

    // Clamp to field bounds
    this.x = clamp(this.x, -cfg.FIELD_W / 2 + 2, cfg.FIELD_W / 2 - 2);
    this.z = clamp(this.z, 0, cfg.FIELD_L);
  }

  get progress() { return this.z / this._cfg.FIELD_L; }
  get tier()     { return this._speedTier(this.speed); }

  blast() {
    this.blasted = true;
    this.speed = 0;
    this.accT = 0;
  }

  reset() {
    this.z = 0;
    this.x = 0;
    this.speed = 0;
    this.accT = 0;
    this.blasted = false;
    this.stunTmr = 0;
  }
}
