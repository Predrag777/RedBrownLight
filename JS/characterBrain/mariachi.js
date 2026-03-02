// =====================================================================
//  MARIACHI BRAIN — The Dancer
//  Alternates between burst and coast, with erratic side-to-side movement.
// =====================================================================

export class MariachiBrain {
	constructor(entity) {
		this.e = entity;
		this.accT = 0;
		this.willFail = false;
		this.decided = false;
		this.wasStopped = true;
		this.danceTimer = 0;
		this.failBurstTmr = 0;
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
			this.failBurstTmr = 0;

			if (this.wasStopped) {
				this.accT = 0;
				this.wasStopped = false;
			}

			this.danceTimer += dt;
			const dancePhase = this.danceTimer % 3;

			if (dancePhase < 1.5) {
				this.accT += dt;
				const target = Math.min(targetSpeedFn(this.accT), 50);
				e.speed = lerpFn(e.speed || 0, target, dt * cfg.ACCEL_LERP);
			} else {
				e.speed = this._brakeStep(e.speed || 0, cfg, dt, 0.3);
			}

			e.x += (Math.random() - 0.5) * 3 * dt;

		} else if (isTurning) {
			if (!this.decided) {
				this.decided = true;
				this.willFail = Math.random() < 0.2;
				this.failBurstTmr = this.willFail ? 0.2 : 0;
			}

			if (this.failBurstTmr > 0) {
				this.failBurstTmr -= dt;
				this.accT += dt;
				const target = Math.min(targetSpeedFn(this.accT), 50);
				e.speed = lerpFn(e.speed || 0, target, dt * (cfg.ACCEL_LERP * 1.1));
			} else {
				this.accT = 0;
				e.speed = this._brakeStep(e.speed || 0, cfg, dt, 1.0);
			}

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
