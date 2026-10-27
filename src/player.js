// 자유 주행 스케이터. 방향(heading)을 직접 틀고, 밀어서 가속하고, 경사에서 저절로 빨라진다.
// 상태: ride(주행) / air(공중) / grind(그라인드) / bail(넘어짐 → 잠시 뒤 그 자리에서 다시 시작)
// heading 0 = -z(코스 앞쪽), 양수 = 오른쪽(+x)
import { solidTop } from './world.js';

const G = 26;
const JUMP_V = 9.6;
const HX = 0.3, HZ = 0.42, BODY_H = 1.5;
const MAX_SPEED = 24, PUSH_SPEED = 13;

const FLIPS = {
  kick: { name: 'Kickflip', dur: 0.34, pts: 300 },
  shove: { name: '360 Shove-it', dur: 0.38, pts: 250 },
  tre: { name: '360 Flip', dur: 0.44, pts: 600 },
};

const GRIND_NAMES = {
  rail: [['Boardslide', Math.PI / 2, 0], ['50-50', 0, 0], ['Lipslide', -Math.PI / 2, 0]],
  handrail: [['Boardslide', Math.PI / 2, 0], ['50-50', 0, 0], ['Feeble', 0.35, 0.12]],
  ledge: [['Tailslide', 1.2, 0.08], ['5-0 Grind', 0, 0.16], ['Nosegrind', 0, -0.16], ['Crooked', -0.35, -0.1]],
  bench: [['50-50', 0, 0], ['Tailslide', 1.2, 0.08], ['Smith Grind', 0.2, 0.1]],
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Player {
  constructor(skater, world, audio, events) {
    this.skater = skater;
    this.world = world;
    this.audio = audio;
    this.events = events; // { combo, bank, lost, bail, bump, vibrate }
    this.near = { solids: [], grinds: [] };
    this.ctl = { steer: 0, push: false, brake: false };
    this.reset();
  }

  reset() {
    this.x = 0; this.z = -4;
    this.y = this.world.groundAt(this.z).y;
    this.vy = 0;
    this.heading = 0;
    this.travel = 0;     // 공중에서 실제로 날아가는 방향
    this.speed = 5;
    this.progress = 0;   // 코스 앞쪽으로 간 최대 거리
    this.state = 'ride';
    this.flip = null;
    this.spin = 0;
    this.lastTrickEnd = -1;
    this.airTime = 0;
    this.grind = null;
    this.grindSteer = 0;
    this.combo = [];
    this.comboPts = 0;
    this.bailT = 0;
    this.bumpT = 0;
    this.time = 0;
    this.yaw = 0; this.pitch = 0;
    this.resetSkater();
  }

  resetSkater() {
    const s = this.skater;
    s.root.rotation.set(0, 0, 0, 'YXZ');
    s.spin.rotation.set(0, 0, 0);
    s.board.rotation.set(0, 0, 0);
    s.board.position.set(0, 0.1, 0);
    s.body.rotation.set(0, 0, 0);
    s.body.position.set(0, 0.12, 0);
    s.setPose('ride');
  }

  // 넘어진 자리 근처에서 다시 시작
  respawn() {
    const g = this.world.groundAt(this.z);
    this.x = clamp(this.x, -g.half + 1, g.half - 1);
    this.world.nearby(this.z, this.near);
    const blocked = () => this.near.solids.some((o) => this.x + 0.6 > o.minX && this.x - 0.6 < o.maxX && this.z + 2 > o.minZ && this.z - 2 < o.maxZ);
    for (const tryX of [this.x, 0, -3, 3, -6, 6]) {
      this.x = clamp(tryX, -g.half + 1, g.half - 1);
      if (!blocked()) break;
    }
    this.y = g.y;
    this.vy = 0;
    this.heading = 0; this.travel = 0;
    this.speed = 4;
    this.state = 'ride';
    this.flip = null; this.spin = 0;
    this.grind = null;
    this.resetSkater();
  }

  action(ev) {
    if (this.state === 'bail') return;
    if (ev === 'ollie') {
      if (this.state === 'ride') this.jump(JUMP_V);
      else if (this.state === 'grind') { this.leaveGrind(JUMP_V * 0.8, 0); this.audio.pop(); }
      return;
    }
    if (this.state !== 'air' || !FLIPS[ev]) return;
    // Z·X를 거의 동시에 누르면 360 플립
    if (this.flip && this.flip.t < 0.12 && this.flip.key !== ev && this.flip.key !== 'tre') {
      this.flip = { key: 'tre', t: this.flip.t, ...FLIPS.tre };
    } else if (!this.flip) {
      this.flip = { key: ev, t: 0, ...FLIPS[ev] };
    }
  }

  jump(v) {
    this.state = 'air';
    this.vy = v;
    this.airTime = 0;
    this.travel = this.heading;
    this.spin = 0;
    this.skater.setPose('air');
    this.audio.pop();
  }

  addCombo(name, pts) {
    this.combo.push(name);
    this.comboPts += pts;
    this.events.combo(this.combo, this.comboPts);
  }

  railY(g, z) {
    const t = (g.zStart - z) / (g.zStart - g.zEnd);
    return g.yStart + (g.yEnd - g.yStart) * t;
  }

  leaveGrind(vy, side) {
    const g = this.grind;
    this.addCombo(g.name, Math.round(100 + g.time * 350));
    this.grind = null;
    this.audio.grind(false);
    this.state = 'air';
    this.vy = vy;
    this.airTime = 0;
    this.heading = this.travel = side * 0.45;
    this.spin = 0;
    this.skater.setPose('air');
  }

  bail(reason) {
    if (this.state === 'bail') return;
    this.state = 'bail';
    this.bailT = 0;
    this.grind = null;
    this.flip = null;
    this.audio.grind(false);
    this.audio.crash();
    this.combo = []; this.comboPts = 0;
    this.events.lost();
    this.events.bail(reason);
  }

  // 부딪힘: 넘어지지 않고 밀려나며 속도만 잃는다
  bump(hard) {
    if (this.bumpT > 0) return;
    this.bumpT = 0.35;
    this.speed *= hard ? 0.3 : 0.75;
    this.audio.land();
    this.skater.setPose('stumble');
    setTimeout(() => { if (this.state === 'ride') this.skater.setPose('ride'); }, 300);
    this.events.bump(hard);
  }

  update(dt) {
    this.time += dt;
    this.bumpT = Math.max(0, this.bumpT - dt);
    const s = this.skater;

    if (this.state === 'bail') return this.updateBail(dt);

    const ctl = this.ctl;
    const ground = this.world.groundAt(this.z);

    // ----- 방향과 속도 -----
    if (this.state === 'ride') {
      const turn = (2.5 - 0.045 * this.speed) * ctl.steer;
      this.heading = wrap(this.heading + turn * dt);
      this.travel = this.heading;
      let acc = 9.8 * ground.slope * Math.cos(this.heading) * 1.6;
      const pushing = ctl.push && this.speed < PUSH_SPEED;
      if (pushing) acc += 7;
      if (ctl.brake) acc -= 10;
      acc -= 0.25 + 0.0018 * this.speed * this.speed;
      if (ground.stairs) acc -= 4;
      this.speed = clamp(this.speed + acc * dt, 0, MAX_SPEED);
      s.setPush(pushing ? 1 : 0);
    } else if (this.state === 'air') {
      this.spin += ctl.steer * 5.2 * dt;
      s.setPush(0);
    } else if (this.state === 'grind') {
      const g = this.grind.g;
      const slope = (g.yStart - g.yEnd) / (g.zStart - g.zEnd);
      this.speed = clamp(this.speed + (9.8 * slope * 0.8 - 1.2) * dt, 0, MAX_SPEED);
      this.heading += (0 - this.heading) * Math.min(1, dt * 10);
      this.travel = 0;
      // 방향키를 세게 누르고 있으면 옆으로 내려온다
      this.grindSteer = Math.abs(ctl.steer) > 0.6 ? this.grindSteer + dt : 0;
      s.setPush(0);
    }

    const prevY = this.y;
    const fx = Math.sin(this.travel), fz = -Math.cos(this.travel);
    this.x += fx * this.speed * dt;
    this.z += fz * this.speed * dt;
    this.progress = Math.max(this.progress, -4 - this.z);

    // ----- 벽(탈 수 있는 폭) -----
    if (this.state !== 'grind') {
      const lim = ground.half - HX;
      if (Math.abs(this.x) > lim) {
        const side = Math.sign(this.x);
        this.x = side * lim;
        const into = fx * side; // 벽 쪽으로 향하는 정도(0~1)
        if (into > 0) {
          if (into > 0.55 && this.speed > 9) this.bump(true);
          else this.speed *= 0.985;
          if (this.state === 'ride') this.heading = wrap(this.heading - side * into * 0.9);
          this.travel = this.state === 'ride' ? this.heading : this.travel - side * into * 0.9;
        }
      }
    }

    // ----- 지지면·충돌 -----
    const near = this.world.nearby(this.z, this.near);
    let support = ground.y, onStairs = ground.stairs;
    const tol = this.state === 'ride' ? 0.24 : 0.08;
    for (const o of near.solids) {
      if (this.x + HX < o.minX || this.x - HX > o.maxX || this.z + HZ < o.minZ || this.z - HZ > o.maxZ) continue;
      const top = solidTop(o, this.z);
      if (top <= Math.max(prevY, this.y) + tol) {
        if (top > support) { support = top; onStairs = false; }
        continue;
      }
      if (this.state === 'grind' || top < this.y + 0.05) continue;
      if (o.moving) return this.bail('차에 치였다');
      // 세워진 차는 정면으로 빠르게 박을 때만 넘어진다. 옆으로 스치면 밀려나기만 한다
      if (o.hard && this.speed > 8 && Math.abs(Math.cos(this.travel)) > 0.7 && this.headOn(o)) return this.bail('차에 부딪혔다');
      this.pushOut(o);
    }

    if (this.state === 'grind') {
      const g = this.grind.g;
      this.grind.time += dt;
      this.x += (g.x - this.x) * Math.min(1, dt * 20);
      if (this.z < g.zEnd) this.leaveGrind(2.2, 0);
      else if (this.speed < 1.5) this.leaveGrind(1.5, Math.sign(ctl.steer) || 1);
      else if (this.grindSteer > 0.2) this.leaveGrind(3.5, Math.sign(ctl.steer));
      else {
        this.y = this.railY(g, this.z);
        this.events.combo([...this.combo, this.grind.name], this.comboPts + Math.round(100 + this.grind.time * 350));
      }
    } else if (this.state === 'ride') {
      // 레일 몸통에 옆으로 부딪히면 밀려난다
      for (const g of near.grinds) {
        if (!g.blocking || Math.abs(this.x - g.x) > HX || this.z > g.zStart || this.z < g.zEnd) continue;
        const ry = this.railY(g, this.z);
        if (ry > this.y + 0.15 && ry < this.y + BODY_H) {
          this.x = g.x + Math.sign(this.x - g.x || 1) * (HX + 0.02);
          this.bump(false);
        }
      }
    }

    if (this.state === 'air') {
      this.airTime += dt;
      this.vy -= G * dt;
      this.y += this.vy * dt;
      this.updateFlip(dt);
      if (this.vy < 0 && this.tryGrind(near, prevY)) { /* 그라인드 시작 */ }
      else if (this.y <= support) this.touchDown(support, onStairs);
    } else if (this.state === 'ride') {
      if (support < this.y - 0.3) {
        // 턱·차 지붕·계단 끝에서 떨어짐
        this.state = 'air';
        this.vy = 0;
        this.airTime = 0;
        this.spin = 0;
        this.skater.setPose('air');
      } else {
        this.y += (support - this.y) * Math.min(1, dt * 25);
        if (onStairs) this.y += Math.sin(this.time * 60) * 0.015;
      }
    }

    this.animate(dt, ground);
    this.place();
    this.audio.roll(this.state === 'ride', this.speed);
  }

  headOn(o) {
    const l = this.x + HX - o.minX, r = o.maxX - (this.x - HX);
    const f = this.z + HZ - o.minZ, b = o.maxZ - (this.z - HZ);
    return Math.min(f, b) < Math.min(l, r);
  }

  pushOut(o) {
    const l = this.x + HX - o.minX, r = o.maxX - (this.x - HX);
    const f = this.z + HZ - o.minZ, b = o.maxZ - (this.z - HZ);
    const m = Math.min(l, r, f, b);
    if (m === l) this.x -= l; else if (m === r) this.x += r;
    else if (m === f) this.z -= f; else this.z += b;
    const headOn = m === f || m === b;
    this.bump(headOn && this.speed > 5);
    if (headOn && this.state === 'ride') this.speed = Math.min(this.speed, 3);
  }

  tryGrind(near, prevY) {
    if (Math.cos(this.travel) < 0.7) return false;
    for (const g of near.grinds) {
      if (Math.abs(this.x - g.x) > g.half || this.z > g.zStart || this.z < g.zEnd + 0.6) continue;
      const ry = this.railY(g, this.z);
      const touching = prevY >= ry - 0.2 && this.y <= ry + 0.05;
      const magnet = this.y > ry && this.y - ry < 0.9;
      if (!touching && !magnet) continue;
      if (this.flip) {
        if (!touching) continue;
        if (this.flip.t / this.flip.dur < 0.65) { this.bail('트릭 도중 레일에 걸렸다'); return true; }
        this.finishFlip(true);
      }
      if (!this.settleSpin()) { this.bail('회전이 덜 됐다'); return true; }
      const [name, yaw, pitch] = pickGrind(g.kind);
      this.grind = { g, name, yaw, pitch, time: 0 };
      this.state = 'grind';
      this.grindSteer = 0;
      this.y = ry;
      this.vy = 0;
      this.skater.setPose('grind');
      this.audio.land();
      this.audio.grind(true);
      this.events.vibrate(15);
      return true;
    }
    return false;
  }

  // 공중 회전 정산: 180도 단위에서 45도 안쪽이면 성공.
  // 90도도 안 돌았으면 그냥 바로 세워 준다(방향키를 누른 채 점프해도 안 넘어지게)
  settleSpin() {
    const k = Math.round(this.spin / Math.PI);
    const err = Math.abs(this.spin - k * Math.PI);
    if (err > 0.8) {
      if (Math.abs(this.spin) > 1.6) return false;
      this.spin = 0;
      this.skater.spin.rotation.y = 0;
      this.speed *= 0.85;
      return true;
    }
    if (k !== 0) this.addCombo(`${Math.abs(k) * 180}`, Math.abs(k) * 180);
    this.spin = 0;
    this.skater.spin.rotation.y = 0;
    return true;
  }

  finishFlip(sketchy) {
    const f = this.flip;
    this.addCombo(sketchy ? `Sketchy ${f.name}` : f.name, sketchy ? Math.round(f.pts / 2) : f.pts);
    this.lastTrickEnd = this.time;
    this.flip = null;
    this.skater.board.rotation.set(0, 0, 0);
  }

  touchDown(support, onStairs) {
    if (this.flip) {
      if (this.flip.t / this.flip.dur < 0.65) return this.bail('보드를 못 잡았다');
      this.finishFlip(true);
    }
    if (!this.settleSpin()) return this.bail('회전이 덜 됐다');
    this.y = support;
    this.vy = 0;
    this.state = 'ride';
    this.heading = this.travel;
    if (onStairs) this.speed *= 0.75;
    this.land();
  }

  updateFlip(dt) {
    const f = this.flip;
    if (!f) return;
    f.t += dt;
    if (f.t >= f.dur) this.finishFlip(false);
  }

  land() {
    this.audio.land();
    this.skater.setPose('land');
    setTimeout(() => { if (this.state === 'ride') this.skater.setPose('ride'); }, 160);
    if (this.combo.length === 0) {
      if (this.airTime > 0.35) this.events.bank(['Ollie'], 50, 1, false);
      return;
    }
    const perfect = this.time - this.lastTrickEnd < 0.14;
    const mult = this.combo.length;
    let total = this.comboPts * mult;
    if (perfect) total = Math.round(total * 1.5);
    this.events.bank(this.combo, total, mult, perfect);
    this.combo = [];
    this.comboPts = 0;
  }

  updateBail(dt) {
    const s = this.skater;
    this.bailT += dt;
    this.speed = Math.max(0, this.speed - 16 * dt);
    this.x += Math.sin(this.travel) * this.speed * dt;
    this.z -= Math.cos(this.travel) * this.speed * dt;
    const g = this.world.groundAt(this.z);
    this.x = clamp(this.x, -g.half + HX, g.half - HX);
    this.vy -= G * dt;
    this.y = Math.max(g.y, this.y + this.vy * dt);
    const k = Math.min(1, this.bailT * 3);
    s.body.rotation.x = -1.45 * k;
    s.body.position.y = 0.12 - 0.1 * k;
    s.board.position.z -= Math.max(0, 6 - this.bailT * 5) * dt;
    s.board.position.x += 1.2 * dt;
    s.board.rotation.z += dt * 9 * (1 - k * 0.6);
    s.board.position.y = Math.max(0.03, s.board.position.y - dt * 0.4);
    s.update(dt);
    this.place();
    this.audio.roll(false, 0);
    if (this.bailT > 1.6) this.respawn();
  }

  animate(dt, ground) {
    const s = this.skater;
    s.update(dt);
    const air = this.state === 'air';
    // 회전 방향으로 몸 기울이기
    const lean = this.state === 'ride' ? clamp(-this.ctl.steer * this.speed * 0.022, -0.32, 0.32) : 0;
    s.root.rotation.z += (lean - s.root.rotation.z) * Math.min(1, dt * 8);

    if (this.flip) {
      const p = this.flip.t / this.flip.dur;
      const k = this.flip.key;
      s.board.rotation.z = k === 'shove' ? 0 : p * Math.PI * 2;
      s.board.rotation.y = k === 'kick' ? 0 : p * Math.PI * 2;
      s.board.position.y = 0.1 + Math.sin(p * Math.PI) * 0.22;
    } else {
      s.board.position.y = 0.1;
    }
    s.spin.rotation.y = air ? -this.spin : s.spin.rotation.y * (1 - Math.min(1, dt * 12));

    const gy = this.grind ? this.grind.yaw : 0, gp = this.grind ? this.grind.pitch : 0;
    this.yaw += (gy - this.yaw) * Math.min(1, dt * 16);
    const slopePitch = this.state === 'ride' ? -Math.atan(ground.slope * Math.cos(this.heading)) : 0;
    this.pitch += (gp + slopePitch - this.pitch) * Math.min(1, dt * 12);
    s.root.rotation.y = -(air ? this.travel : this.heading) + this.yaw;
    s.root.rotation.x = this.pitch;
  }

  place() {
    this.skater.root.position.set(this.x, this.y, this.z);
  }
}

function pickGrind(kind) {
  const list = GRIND_NAMES[kind] || GRIND_NAMES.rail;
  return list[Math.floor(Math.random() * list.length)];
}
