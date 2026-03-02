// =====================================================================
//  SPACESUIT BRAIN — The Cautious One
//  Slow, conservative runner that avoids risk and brakes early.
// =====================================================================

export class SpacesuitBrain {
	constructor(entity) {
		this.e = entity;
		this.accT = 0;
		this.willFail = false;
		this.decided = false;
		this.wasStopped = true;
	}

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

			const safeSpd = this._safeSpeed(cfg.TURN_DURATION + cfg.GRACE, cfg);
			const safeCap = Math.min(safeSpd * 0.6, 30);

			if (danger <= 0.5) {
				this.accT += dt * 0.6;
				const target = Math.min(targetSpeedFn(this.accT), safeCap);
				e.speed = lerpFn(e.speed || 0, target, dt * (cfg.ACCEL_LERP * 0.7));
			} else {
				e.speed = this._brakeStep(e.speed || 0, cfg, dt, 1.1);
			}

		} else if (isTurning) {
			this.decided = true;
			this.willFail = false;
			this.accT = 0;
			e.speed = this._brakeStep(e.speed || 0, cfg, dt, 1.0);

		} else {
			e.speed = this._brakeStep(e.speed || 0, cfg, dt, 1.0);
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
