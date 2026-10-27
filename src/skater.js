// 기본 도형으로 만든 로우폴리 스케이터와 보드. 관절 위치를 매 프레임 계산해 자세를 바꾼다.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();

// 두 점 사이에 길이 1짜리 기둥 메시를 늘려 끼운다(허벅지·정강이용)
function setLimb(mesh, a, b) {
  _d.subVectors(b, a);
  const len = _d.length();
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, _d.divideScalar(len || 1));
  mesh.scale.set(1, len, 1);
}

// 두 관절 사이 무릎 위치(무릎은 몸 앞쪽 +x로 굽힌다)
function knee(hip, ankle, len, out) {
  const d = hip.distanceTo(ankle);
  const bend = Math.sqrt(Math.max(0, len * len - (d / 2) * (d / 2)));
  return out.copy(hip).add(ankle).multiplyScalar(0.5).add(new THREE.Vector3(bend, 0, 0));
}

export class Skater {
  constructor(tex) {
    const L = (o) => new THREE.MeshLambertMaterial(o);
    const mat = {
      hoodie: L({ map: tex.hoodie }),
      hoodieDark: L({ color: 0x6f7175 }),
      jeans: L({ map: tex.denim }),
      skin: L({ color: 0xc8987a }),
      hair: L({ color: 0x3a2a1e }),
      shoe: L({ color: 0x8b6a49 }),
      sole: L({ color: 0xe5e0d4 }),
      beanie: L({ color: 0x2d3a2e }),
      grip: L({ color: 0x1c1c1c }),
      wood: L({ color: 0xb4875a }),
      truck: new THREE.MeshPhongMaterial({ color: 0x9a9da1, shininess: 80 }),
      wheel: L({ color: 0xe0d2a8 }),
      eye: new THREE.MeshBasicMaterial({ color: 0x1a1a1a }),
    };
    const mesh = (geo, m) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; return o; };

    this.root = new THREE.Group();   // 발 아래 지면 위치, -z가 앞
    this.root.scale.setScalar(1.1);
    this.spin = new THREE.Group();   // 360 회전용
    this.root.add(this.spin);

    // 보드
    this.board = new THREE.Group();
    this.board.position.y = 0.1;
    const deck = mesh(new THREE.BoxGeometry(0.22, 0.024, 0.62), [mat.wood, mat.wood, mat.grip, mat.wood, mat.wood, mat.wood]);
    this.board.add(deck);
    for (const d of [-1, 1]) {
      const tail = mesh(new THREE.BoxGeometry(0.22, 0.024, 0.16), [mat.wood, mat.wood, mat.grip, mat.wood, mat.wood, mat.wood]);
      tail.position.set(0, 0.025, d * 0.37);
      tail.rotation.x = d * 0.35;
      this.board.add(tail);
      const truck = mesh(new THREE.BoxGeometry(0.17, 0.045, 0.05), mat.truck);
      truck.position.set(0, -0.035, d * 0.24);
      this.board.add(truck);
      for (const s of [-1, 1]) {
        const w = mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.032, 10), mat.wheel);
        w.rotation.z = Math.PI / 2;
        w.position.set(s * 0.1, -0.062, d * 0.24);
        this.board.add(w);
      }
    }
    this.spin.add(this.board);

    // 몸통(옆으로 서서 +x를 바라봄, 왼발이 앞 -z)
    this.body = new THREE.Group();
    this.body.position.y = 0.12;
    this.spin.add(this.body);

    const unit = (w, d) => new THREE.BoxGeometry(w, 1, d);
    this.thighs = [mesh(unit(0.17, 0.17), mat.jeans), mesh(unit(0.17, 0.17), mat.jeans)];
    this.shins = [mesh(unit(0.15, 0.15), mat.jeans), mesh(unit(0.15, 0.15), mat.jeans)];
    this.shoes = [0, 1].map(() => {
      const g = new THREE.Group();
      const upper = mesh(new THREE.BoxGeometry(0.29, 0.09, 0.12), mat.shoe);
      upper.position.set(0.03, 0.03, 0);
      const sole = mesh(new THREE.BoxGeometry(0.3, 0.03, 0.125), mat.sole);
      sole.position.set(0.03, -0.025, 0);
      g.add(upper, sole);
      return g;
    });
    this.body.add(...this.thighs, ...this.shins, ...this.shoes);

    // 상체: 골반에 붙은 그룹
    this.torso = new THREE.Group();
    const chest = mesh(new THREE.BoxGeometry(0.27, 0.56, 0.44), mat.hoodie);
    chest.position.y = 0.3;
    const pocket = mesh(new THREE.BoxGeometry(0.02, 0.13, 0.26), mat.hoodieDark);
    pocket.position.set(0.14, 0.14, 0);
    const hood = mesh(new THREE.BoxGeometry(0.16, 0.16, 0.3), mat.hoodie);
    hood.position.set(-0.13, 0.56, 0);
    hood.rotation.z = 0.3;
    const waist = mesh(new THREE.BoxGeometry(0.29, 0.06, 0.46), mat.hoodieDark);
    waist.position.y = 0.04;
    this.torso.add(chest, pocket, hood, waist);

    // 머리: 앞(-z)을 본다
    this.head = new THREE.Group();
    this.head.position.y = 0.72;
    const neck = mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8), mat.skin);
    neck.position.y = -0.1;
    const skull = mesh(new THREE.SphereGeometry(0.12, 12, 10), mat.skin);
    skull.scale.set(1, 1.12, 1.02);
    const cap = mesh(new THREE.SphereGeometry(0.128, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), mat.beanie);
    cap.position.y = 0.025;
    const fold = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 12), mat.beanie);
    fold.position.y = 0.035;
    const nose = mesh(new THREE.BoxGeometry(0.03, 0.05, 0.04), mat.skin);
    nose.position.set(0, -0.01, -0.125);
    const eyes = [-0.045, 0.045].map((x) => { const e = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.018, 0.01), mat.eye); e.position.set(x, 0.025, -0.115); return e; });
    const hairBack = mesh(new THREE.BoxGeometry(0.2, 0.06, 0.06), mat.hair);
    hairBack.position.set(0, -0.03, 0.1);
    this.head.add(neck, skull, cap, fold, nose, ...eyes, hairBack);
    this.head.rotation.y = Math.PI / 2;
    this.torso.add(this.head);

    // 팔: 어깨 → 팔꿈치 → 손
    this.arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0, 0.52, side * 0.25);
      const upper = mesh(new THREE.BoxGeometry(0.13, 0.32, 0.13), mat.hoodie);
      upper.position.y = -0.15;
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      const fore = mesh(new THREE.BoxGeometry(0.12, 0.27, 0.12), mat.hoodie);
      fore.position.y = -0.13;
      const hand = mesh(new THREE.SphereGeometry(0.055, 8, 6), mat.skin);
      hand.position.y = -0.3;
      elbow.add(fore, hand);
      shoulder.add(upper, elbow);
      this.torso.add(shoulder);
      return { side, shoulder, elbow };
    });
    this.body.add(this.torso);

    // 자세 값(목표값으로 부드럽게 따라감)
    this.pose = { crouch: 0.25, arms: 0.35, lean: 0.12, tuck: 0, push: 0 };
    this.pushPhase = 0;
    this.target = { ...this.pose };
    this.time = 0;
    this._hip = [new THREE.Vector3(), new THREE.Vector3()];
    this._ankle = [new THREE.Vector3(), new THREE.Vector3()];
    this._knee = [new THREE.Vector3(), new THREE.Vector3()];
    this.apply();
  }

  setPose(name) {
    const P = {
      ride: { crouch: 0.25, arms: 0.35, lean: 0.12, tuck: 0 },
      prep: { crouch: 0.75, arms: 0.5, lean: 0.25, tuck: 0 },
      air: { crouch: 0.6, arms: 0.7, lean: 0.2, tuck: 0.12 },
      grind: { crouch: 0.4, arms: 1.0, lean: 0.05, tuck: 0 },
      land: { crouch: 0.95, arms: 0.55, lean: 0.3, tuck: 0 },
      stumble: { crouch: 0.9, arms: 1.1, lean: -0.15, tuck: 0 },
    }[name];
    Object.assign(this.target, P);
  }

  // 뒷발로 땅을 차서 미는 동작(0~1)
  setPush(w) { this.target.push = w; }

  update(dt) {
    this.time += dt;
    const k = Math.min(1, dt * 14);
    for (const key in this.pose) this.pose[key] += ((this.target[key] ?? 0) - this.pose[key]) * k;
    if (this.pose.push > 0.02) this.pushPhase = (this.pushPhase + dt * 1.6) % 1;
    else this.pushPhase = 0;
    this.apply();
  }

  apply() {
    const { crouch, arms, lean, tuck } = this.pose;
    const push = this.pose.push || 0;
    const hipY = 0.9 - 0.25 * crouch * (1 - push * 0.5);
    const feetZ = [-0.2, 0.19];
    // 미는 발 궤적: 땅에 대고 뒤로 긁은 뒤 들어서 앞으로 가져온다
    const t = this.pushPhase || 0;
    let pz, py;
    if (t < 0.55) { pz = -0.05 + 0.55 * (t / 0.55); py = -0.11; }
    else { const u = (t - 0.55) / 0.45; pz = 0.5 - 0.55 * u; py = -0.11 + 0.2 * Math.sin(u * Math.PI); }
    for (let i = 0; i < 2; i++) {
      this._hip[i].set(-0.03, hipY, i === 0 ? -0.1 : 0.1);
      this._ankle[i].set(0, 0.075 + tuck, feetZ[i]);
      if (i === 1 && push > 0) {
        this._ankle[i].x += (-0.24 - this._ankle[i].x) * push;
        this._ankle[i].y += (py - this._ankle[i].y) * push;
        this._ankle[i].z += (pz - this._ankle[i].z) * push;
      }
      knee(this._hip[i], this._ankle[i], 0.46, this._knee[i]);
      setLimb(this.thighs[i], this._hip[i], this._knee[i]);
      setLimb(this.shins[i], this._knee[i], this._ankle[i]);
      this.shoes[i].position.copy(this._ankle[i]);
    }
    this.torso.position.set(-0.03, hipY - 0.04, 0);
    this.torso.rotation.z = -lean;
    const breathe = Math.sin(this.time * 2.2) * 0.04;
    for (const a of this.arms) {
      const raise = 0.35 + arms * 1.55 + breathe;
      a.shoulder.rotation.x = -a.side * raise;
      a.shoulder.rotation.z = 0.15 + arms * 0.1;
      a.elbow.rotation.x = -a.side * (0.25 + 0.2 * (1 - arms));
    }
  }
}
