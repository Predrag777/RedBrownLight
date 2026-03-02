// =====================================================================
//  RAPPER BRAIN — The Showoff
//  High-risk sprinter that chases top speed and often fails to brake.
// =====================================================================

export class RapperBrain {
	constructor(entity) {
		this.e = entity;
		this.accT = 0;
		this.willFail = false;
		this.decided = false;
		this.wasStopped = true;
	}

	_brakeStep(speed, cfg, dt, mult = 1) {
		const friction = 1 - ((speed || 0) / cfg.MAX_SPEED) * 0.6;
		const decel = cfg.BASE_DECEL * Math.max(friction, 0.2) * mult;
		return Math.max(0, (speed || 0) - decel * dt);
	}

	update(dt, light, player, allAI, myIdx, cfg, targetSpeedFn, clampFn, lerpFn) {
		const e = this.e;
		if (e.blasted) return;

		if (Math.abs(e.vx) > 0.1 || Math.abs(e.vz) > 0.1) {
			e.x += e.vx * dt;
			e.z += e.vz * dt;
			e.vx *= (1 - cfg.PUSH_RECOVERY * dt);
			e.vz *= (1 - cfg.PUSH_RECOVERY * dt);
		}

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

			if (danger <= 0.9) {
				this.accT += dt * 1.3;
				const target = Math.min(targetSpeedFn(this.accT), 80);
				e.speed = lerpFn(e.speed || 0, target, dt * (cfg.ACCEL_LERP * 1.4));
			} else {
				e.speed = this._brakeStep(e.speed || 0, cfg, dt, 0.9);
			}

		} else if (isTurning) {
			if (!this.decided) {
				this.decided = true;
				this.willFail = Math.random() < 0.4;
			}

			if (this.willFail) {
				e.speed = Math.max(0, e.speed || 0);
			} else {
				this.accT = 0;
				e.speed = this._brakeStep(e.speed || 0, cfg, dt, 1.0);
			}

		} else {
			if (this.willFail && (e.speed || 0) > cfg.VEL_THRESHOLD) {
				e.speed = this._brakeStep(e.speed || 0, cfg, dt, 1.2);
			} else {
				e.speed = this._brakeStep(e.speed || 0, cfg, dt, 1.0);
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
