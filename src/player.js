// 플레이어 상태 머신: ride(주행) / air(공중) / grind(그라인드) / bail(넘어짐)
import { LANES } from './world.js';

const G = 28;
const JUMP_V = 10.5;
const HALF_X = 0.28, HALF_Z = 0.4, BODY_H = 1.55;

const TRICKS = {
  kick: { name: 'Kickflip', dur: 0.36, pts: 300, slot: 'flip' },
  shove: { name: '360 Shove-it', dur: 0.4, pts: 250, slot: 'flip' },
  spin: { name: '360', dur: 0.5, pts: 500, slot: 'spin' },
};

const GRIND_NAMES = {
  rail: [['Boardslide', Math.PI / 2, 0], ['50-50', 0, 0], ['Lipslide', -Math.PI / 2, 0]],
  handrail: [['Boardslide', Math.PI / 2, 0], ['50-50', 0, 0], ['Feeble', 0.35, 0.12]],
  ledge: [['Tailslide', 1.2, 0.08], ['5-0 Grind', 0, 0.16], ['Nosegrind', 0, -0.16], ['Crooked', -0.35, -0.1]],
  bench: [['50-50', 0, 0], ['Tailslide', 1.2, 0.08], ['Smith Grind', 0.2, 0.1]],
};

const lerpAngle = (a, b, t) => a + (b - a) * t;

export class Player {
  constructor(skater, world, audio, events) {
    this.skater = skater;
    this.world = world;
    this.audio = audio;
    this.events = events; // { combo, bank, lost, crash, floater }
    this.near = { solids: [], grinds: [] };
    this.reset();
  }

  reset() {
    this.lane = 1;
    this.x = 0; this.y = 0; this.z = -4;
    this.vy = 0;
    this.speed = 12;
    this.dist = 0;
    this.state = 'ride';
    this.flip = null; this.spinT = null;
    this.lastTrickEnd = -1;
    this.airTime = 0;
    this.grind = null;
    this.combo = [];
    this.comboPts = 0;
    this.bailT = 0;
    this.brake = 0;
    this.time = 0;
    this.yaw = 0; this.pitch = 0;
    const s = this.skater;
    s.root.rotation.set(0, 0, 0);
    s.spin.rotation.set(0, 0, 0);
    s.board.rotation.set(0, 0, 0);
    s.board.position.set(0, 0.1, 0);
    s.body.rotation.set(0, 0, 0);
    s.body.position.set(0, 0.12, 0);
    s.setPose('ride');
  }

  input(ev) {
    if (this.state === 'bail') return;
    if (ev === 'left' || ev === 'right') {
      const nl = Math.max(0, Math.min(2, this.lane + (ev === 'left' ? -1 : 1)));
      if (nl === this.lane) return;
      this.lane = nl;
      if (this.state === 'grind') this.leaveGrind(4.5);
      return;
    }
    if (ev === 'jump') {
      if (this.state === 'ride') this.jump(JUMP_V);
      else if (this.state === 'grind') { this.leaveGrind(JUMP_V * 0.75); this.audio.pop(); }
      else if (this.state === 'air') this.startTrick('spin');
      return;
    }
    if (ev === 'brake') { this.brake = 0.8; return; }
    if (this.state === 'air' && TRICKS[ev]) this.startTrick(ev);
  }

  jump(v) {
    this.state = 'air';
    this.vy = v;
    this.airTime = 0;
    this.skater.setPose('air');
    this.audio.pop();
  }

  startTrick(key) {
    const t = TRICKS[key];
    if (t.slot === 'flip' && !this.flip) this.flip = { key, t: 0, ...t };
    else if (t.slot === 'spin' && !this.spinT) this.spinT = { key, t: 0, ...t };
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

  leaveGrind(vy) {
    const g = this.grind;
    const secs = g.time;
    this.addCombo(g.name, Math.round(100 + secs * 350));
    this.grind = null;
    this.audio.grind(false);
    this.state = 'air';
    this.vy = vy;
    this.airTime = 0;
    this.skater.setPose('air');
  }

  crash(reason) {
    if (this.state === 'bail') return;
    this.state = 'bail';
    this.bailT = 0;
    this.audio.grind(false);
    this.audio.crash();
    this.events.lost();
    this.events.crash(reason);
  }

  update(dt) {
    this.time += dt;
    const s = this.skater;

    if (this.state === 'bail') {
      this.bailT += dt;
      this.speed = Math.max(0, this.speed - 18 * dt);
      this.z -= this.speed * dt;
      const ground = this.world.groundAt(this.z).y;
      this.vy -= G * dt;
      this.y = Math.max(ground, this.y + this.vy * dt);
      const k = Math.min(1, this.bailT * 3);
      s.body.rotation.x = lerpAngle(0, -1.45, k);
      s.body.position.y = 0.12 - 0.1 * k;
      s.board.position.z -= (6 - this.bailT * 4) * dt;
      s.board.position.x += 1.2 * dt;
      s.board.rotation.z += dt * 9 * (1 - k * 0.6);
      s.board.position.y = Math.max(0.03, s.board.position.y - dt * 0.4);
      s.update(dt);
      this.place();
      this.audio.roll(false, 0);
      return;
    }

    // 속도: 갈수록 빨라지고, 감속 입력이 있으면 잠깐 느려진다
    const target = Math.min(24, 12 + this.dist * 0.008);
    this.brake = Math.max(0, this.brake - dt);
    const goal = this.brake > 0 ? Math.max(7, target * 0.55) : target;
    this.speed += (goal - this.speed) * Math.min(1, dt * (this.brake > 0 ? 3 : 0.8));

    const prevY = this.y;
    this.z -= this.speed * dt;
    this.dist += this.speed * dt;
    const tx = LANES[this.lane];
    if (this.state !== 'grind') this.x += (tx - this.x) * Math.min(1, dt * 11);

    const ground = this.world.groundAt(this.z);
    const near = this.world.nearby(this.z, this.near);

    // 지지면 찾기 + 충돌
    let support = ground.y, onStairs = ground.stairs;
    const tol = this.state === 'ride' ? 0.22 : 0.06;
    for (const o of near.solids) {
      if (this.x + HALF_X < o.minX || this.x - HALF_X > o.maxX || this.z + HALF_Z < o.minZ || this.z - HALF_Z > o.maxZ) continue;
      if (o.top <= Math.max(prevY, this.y) + tol) {
        if (o.top > support) { support = o.top; onStairs = false; }
      } else if (this.state !== 'grind') {
        return this.crash(o.kind === 'car' ? '차에 부딪혔다' : '장애물에 부딪혔다');
      }
    }

    if (this.state === 'grind') {
      const g = this.grind.g;
      this.grind.time += dt;
      this.x = g.x;
      if (this.z < g.zEnd) {
        this.leaveGrind(2.2);
      } else {
        this.y = this.railY(g, this.z);
        this.events.combo([...this.combo, this.grind.name], this.comboPts + Math.round(100 + this.grind.time * 350));
      }
    } else {
      // 난간·레일 몸통 충돌. 공중에서 올라가는 중이면 봐준다(레일 위로 올라타는 중)
      const margin = this.state === 'ride' ? 0.12 : 0.3;
      for (const g of near.grinds) {
        if (!g.blocking || Math.abs(this.x - g.x) > 0.32) continue;
        if (this.z > g.zStart || this.z < g.zEnd) continue;
        if (this.state === 'air' && this.vy > 0) continue;
        const ry = this.railY(g, this.z);
        if (ry > this.y + margin && ry < this.y + BODY_H) return this.crash('난간에 걸렸다');
      }
    }

    if (this.state === 'air') {
      this.airTime += dt;
      this.vy -= G * dt;
      this.y += this.vy * dt;
      this.updateTricks(dt);

      // 그라인드 진입
      if (this.vy < 0) {
        for (const g of near.grinds) {
          if (Math.abs(this.x - g.x) > g.half || this.z > g.zStart || this.z < g.zEnd + 0.8) continue;
          // 레일 위 0.9m 안에서 내려오는 중이면 레일로 끌어당긴다(자동 그라인드)
          const ry = this.railY(g, this.z);
          const touching = prevY >= ry - 0.18 && this.y <= ry + 0.05;
          const magnet = this.y > ry && this.y - ry < 0.9;
          if (touching || magnet) {
            if (this.flip || this.spinT) {
              if (touching) return this.crash('트릭 도중 레일에 걸렸다');
              continue;
            }
            const [name, yaw, pitch] = pickGrind(g.kind);
            this.grind = { g, name, yaw, pitch, time: 0 };
            this.state = 'grind';
            this.y = ry;
            this.vy = 0;
            this.skater.setPose('grind');
            this.audio.land();
            this.audio.grind(true);
            this.events.vibrate(15);
            break;
          }
        }
      }

      if (this.state === 'air' && this.y <= support) {
        if (onStairs) return this.crash('계단 위에 떨어졌다');
        if (this.flip) return this.crash('보드를 못 잡았다');
        if (this.spinT && this.spinT.t / this.spinT.dur < 0.85) return this.crash('회전이 덜 됐다');
        this.spinT = null;
        this.y = support;
        this.vy = 0;
        this.state = 'ride';
        this.land();
      }
    } else if (this.state === 'ride') {
      if (support < this.y - 0.08) {
        // 턱이나 차 지붕에서 떨어짐
        this.state = 'air';
        this.vy = 0;
        this.airTime = 0;
        this.skater.setPose('air');
      } else {
        if (onStairs) return this.crash('계단을 굴러 내려갔다');
        this.y = support;
      }
    }

    this.animate(dt);
    this.place();
    this.audio.roll(this.state === 'ride', this.speed);
  }

  updateTricks(dt) {
    for (const slot of ['flip', 'spinT']) {
      const t = this[slot];
      if (!t) continue;
      t.t += dt;
      if (t.t >= t.dur) {
        this.addCombo(t.name, t.pts);
        this.lastTrickEnd = this.time;
        this[slot] = null;
        if (slot === 'flip') { this.skater.board.rotation.z = 0; this.skater.board.rotation.y = 0; }
        else this.skater.spin.rotation.y = 0;
      }
    }
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

  animate(dt) {
    const s = this.skater;
    s.update(dt);
    // 차선 이동 시 몸 기울기
    const dx = LANES[this.lane] - this.x;
    s.root.rotation.z += (Math.max(-0.35, Math.min(0.35, -dx * 0.25)) - s.root.rotation.z) * Math.min(1, dt * 10);

    if (this.flip) {
      const p = this.flip.t / this.flip.dur;
      if (this.flip.key === 'kick') s.board.rotation.z = p * Math.PI * 2;
      else s.board.rotation.y = p * Math.PI * 2;
      s.board.position.y = 0.1 + Math.sin(p * Math.PI) * 0.22;
    } else {
      s.board.position.y = 0.1;
    }
    if (this.spinT) s.spin.rotation.y = (this.spinT.t / this.spinT.dur) * Math.PI * 2;

    // 그라인드 자세(보드 방향)
    const gy = this.grind ? this.grind.yaw : 0, gp = this.grind ? this.grind.pitch : 0;
    this.yaw += (gy - this.yaw) * Math.min(1, dt * 16);
    this.pitch += (gp - this.pitch) * Math.min(1, dt * 16);
    s.root.rotation.y = this.yaw;
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
