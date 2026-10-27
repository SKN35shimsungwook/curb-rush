// 무한히 이어지는 도시 거리. 40m 단위 구간(청크)을 앞쪽에 계속 만들고 지나간 구간은 지운다.
// 구간마다 정적 메시를 재질별로 합쳐서 그리기 호출 수를 줄인다(모바일 대응).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CHUNK = 40;
export const LANES = [-3.5, 0, 3.5];
const ROAD = 6;      // 차도 반폭
const WALK = 11;     // 인도 바깥 끝
const CURB = 0.17;   // 연석 높이

const STAIR_S0 = 12, STAIR_S1 = 18, STAIR_DROP = 2.4, STAIR_STEPS = 8;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 박스 UV를 실제 크기 기준으로 늘려서 텍스처가 늘어나지 않고 반복되게 한다.
function uvBox(w, h, d, tile = 1, tileY = tile) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0] / tile, uv.getY(k) * dims[f][1] / tileY);
    }
  }
  return g;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

class Batch {
  constructor() { this.map = new Map(); }
  add(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    _q.setFromEuler(_e.set(rx, ry, rz));
    this.addMatrix(geo, mat, _m.compose(_p.set(x, y, z), _q, _s));
  }
  addMatrix(geo, mat, matrix) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    g.applyMatrix4(matrix);
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(g);
  }
  build(group, cast) {
    for (const [mat, list] of this.map) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = cast;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }
}

function stripesTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8b81e'; ctx.fillRect(0, 0, 128, 32);
  ctx.fillStyle = '#1b1b1b';
  for (let x = -32; x < 160; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 32); ctx.lineTo(x + 16, 0); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 16, 32); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class World {
  constructor(scene, tex) {
    this.scene = scene;
    const L = (o) => new THREE.MeshLambertMaterial(o);
    const P = (o) => new THREE.MeshPhongMaterial(o);
    this.m = {
      road: L({ map: tex.asphalt }),
      walk: L({ map: tex.sidewalk }),
      curb: L({ map: tex.concreteDark }),
      concrete: L({ map: tex.concrete }),
      grass: L({ map: tex.grass }),
      leaf: L({ map: tex.foliage, flatShading: true }),
      trunk: L({ color: 0x4a3b2c }),
      paint: L({ color: 0xdcdad2 }),
      warn: L({ color: 0xd9a91c }),
      metal: P({ color: 0x55585c, shininess: 60, specular: 0x555555 }),
      darkMetal: P({ color: 0x2c2e30, shininess: 40, specular: 0x333333 }),
      rail: P({ color: 0x3b3e42, shininess: 120, specular: 0xaaaaaa }),
      glass: P({ color: 0x1d2730, shininess: 120, specular: 0x8a9aab }),
      tire: L({ color: 0x181818 }),
      wood: L({ color: 0x7b5b3b }),
      bin: L({ color: 0x334a3c }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xfff2c0 }),
      headlight: new THREE.MeshBasicMaterial({ color: 0xe9e7da }),
      taillight: new THREE.MeshBasicMaterial({ color: 0x7d1714 }),
      redLight: new THREE.MeshBasicMaterial({ color: 0xc42a1f }),
      greenLight: new THREE.MeshBasicMaterial({ color: 0x2f8f4a }),
      barrier: L({ map: stripesTexture() }),
      roof: L({ color: 0x5b5a57 }),
      facades: tex.facades.map((t) => L({ map: t })),
      stores: tex.stores.map((t) => L({ map: t })),
      cars: [0x8a2f2b, 0x3d4f7a, 0xb3b6b9, 0xd6d3cc, 0x2b2d30, 0x5e6b52, 0x7a6a4f].map((c) => P({ color: c, shininess: 90, specular: 0x666666 })),
    };
    this.chunks = [];
    this.reset();
  }

  reset() {
    for (const c of this.chunks) this.disposeChunk(c);
    this.chunks = [];
    this.next = 0;
    this.h = 0;
    this.lastStairs = 0;
  }

  update(playerZ) {
    while (-this.next * CHUNK > playerZ - 240) this.spawn();
    while (this.chunks.length && this.chunks[0].zBottom > playerZ + 40) this.disposeChunk(this.chunks.shift());
  }

  disposeChunk(c) {
    this.scene.remove(c.group);
    c.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }

  chunkAt(z) {
    for (const c of this.chunks) if (z <= c.zTop && z > c.zBottom) return c;
    return null;
  }

  // 바닥 높이(장애물 제외). stairs=true면 계단 위
  groundAt(z) {
    const c = this.chunkAt(z);
    if (!c) return { y: this.chunks.length ? this.chunks[0].h0 : 0, stairs: false };
    return this.heightIn(c, c.zTop - z);
  }

  heightIn(c, s) {
    if (c.type !== 'stairs' || s < STAIR_S0) return { y: c.h0, stairs: false };
    if (s > STAIR_S1) return { y: c.h1, stairs: false };
    return { y: c.h0 - STAIR_DROP * (s - STAIR_S0) / (STAIR_S1 - STAIR_S0), stairs: true };
  }

  // 플레이어 근처의 충돌체·그라인드 대상
  nearby(z, out) {
    out.solids.length = 0; out.grinds.length = 0;
    for (const c of this.chunks) {
      if (c.zBottom > z + 12 || c.zTop < z - 12) continue;
      for (const s of c.solids) out.solids.push(s);
      for (const g of c.grinds) out.grinds.push(g);
    }
    return out;
  }

  spawn() {
    const i = this.next++;
    const zTop = -i * CHUNK;
    const stairs = i >= 3 && i - this.lastStairs >= 3 && Math.random() < 0.45;
    const c = {
      i, zTop, zBottom: zTop - CHUNK, type: stairs ? 'stairs' : 'flat',
      h0: this.h, h1: this.h, solids: [], grinds: [], group: new THREE.Group(),
    };
    if (stairs) {
      c.h1 = c.h0 - STAIR_DROP;
      this.h = c.h1;
      this.lastStairs = i;
    }
    const ground = new Batch(), props = new Batch();
    const z = (s) => zTop - s;
    const hAt = (s) => this.heightIn(c, s).y;

    if (stairs) {
      this.groundStrip(ground, c, 0, STAIR_S0, c.h0);
      this.groundStrip(ground, c, STAIR_S1, CHUNK, c.h1);
      this.buildStairs(ground, props, c);
    } else {
      this.groundStrip(ground, c, 0, CHUNK, c.h0);
      if (i > 0 && Math.random() < 0.35) this.crosswalk(ground, props, c, 3);
    }

    // 가로등
    for (const s of [6, 26]) for (const side of [-1, 1]) this.streetlight(props, side * 10.4, hAt(s) + CURB, z(s), side);

    // 화단과 나무
    for (const side of [-1, 1]) {
      if (Math.random() < 0.6) {
        const s = stairs ? rand(24, 34) : rand(10, 32);
        this.planter(props, side * 8.6, hAt(s) + CURB, z(s));
      }
    }

    // 길가 주차 차량(장식)
    for (const side of [-1, 1]) {
      let s = rand(2, 10);
      while (s < CHUNK - 4) {
        const free = !stairs || s > STAIR_S1 + 3 || s + 4.4 < STAIR_S0 - 1;
        if (free && Math.random() < 0.55) {
          this.car(props, side * 4.95, hAt(s), z(s + 2.1), pick(this.m.cars), Math.random() < 0.5 ? 0 : Math.PI);
        }
        s += rand(6, 10);
      }
    }

    this.buildings(ground, c);
    if (i >= 2) this.obstacles(props, c);

    ground.build(c.group, false);
    props.build(c.group, true);
    this.scene.add(c.group);
    this.chunks.push(c);
  }

  groundStrip(b, c, s0, s1, h) {
    const len = s1 - s0, zc = c.zTop - (s0 + s1) / 2;
    b.add(uvBox(ROAD * 2, 3, len, 4), this.m.road, 0, h - 1.5, zc);
    for (const side of [-1, 1]) {
      b.add(uvBox(WALK - ROAD - 0.25, 3, len, 2), this.m.walk, side * (ROAD + 0.25 + (WALK - ROAD - 0.25) / 2), h + CURB - 1.5, zc);
      b.add(uvBox(0.25, 3, len, 1), this.m.curb, side * (ROAD + 0.125), h + CURB - 1.5, zc);
    }
    // 차선 점선
    for (let s = s0 + 1.5; s < s1 - 2; s += 6) {
      for (const x of [-1.75, 1.75]) b.add(new THREE.BoxGeometry(0.13, 0.02, 2.6), this.m.paint, x, h + 0.006, c.zTop - s - 1.3);
    }
  }

  crosswalk(ground, props, c, s) {
    for (let x = -5.4; x <= 5.41; x += 1.2) ground.add(new THREE.BoxGeometry(0.62, 0.02, 3.6), this.m.paint, x, c.h0 + 0.008, c.zTop - s - 1.8);
    for (const side of [-1, 1]) {
      const x = side * 6.8, y = c.h0 + CURB, zz = c.zTop - s + 0.6;
      props.add(new THREE.CylinderGeometry(0.08, 0.1, 4.4, 8), this.m.darkMetal, x, y + 2.2, zz);
      props.add(new THREE.BoxGeometry(0.34, 0.95, 0.3), this.m.darkMetal, x, y + 3.9, zz);
      props.add(new THREE.SphereGeometry(0.09, 8, 6), this.m.redLight, x, y + 4.18, zz - 0.16);
      props.add(new THREE.SphereGeometry(0.09, 8, 6), this.m.greenLight, x, y + 3.62, zz - 0.16);
    }
  }

  streetlight(b, x, y, zz, side) {
    b.add(new THREE.CylinderGeometry(0.07, 0.11, 6.5, 8), this.m.darkMetal, x, y + 3.25, zz);
    b.add(new THREE.BoxGeometry(1.7, 0.08, 0.08), this.m.darkMetal, x - side * 0.85, y + 6.45, zz);
    b.add(new THREE.BoxGeometry(0.55, 0.14, 0.3), this.m.lamp, x - side * 1.6, y + 6.36, zz);
  }

  planter(b, x, y, zz) {
    b.add(uvBox(2.2, 0.6, 2.2, 1), this.m.concrete, x, y + 0.3, zz);
    b.add(new THREE.BoxGeometry(2.0, 0.04, 2.0), this.m.grass, x, y + 0.6, zz);
    b.add(new THREE.CylinderGeometry(0.11, 0.16, 2.6, 6), this.m.trunk, x, y + 1.9, zz);
    b.add(new THREE.IcosahedronGeometry(1.35, 1), this.m.leaf, x, y + 3.6, zz, rand(0, 3), rand(0, 3), 0);
    b.add(new THREE.IcosahedronGeometry(0.95, 1), this.m.leaf, x + rand(-0.5, 0.5), y + 4.5, zz + rand(-0.5, 0.5), rand(0, 3), 0, 0);
  }

  car(b, x, y, zz, mat, ry = 0) {
    const f = ry === 0 ? 1 : -1; // 차 앞쪽 방향(-z 기준)
    b.add(new THREE.BoxGeometry(1.8, 0.62, 4.2), mat, x, y + 0.62, zz);
    b.add(new THREE.BoxGeometry(1.6, 0.5, 2.1), this.m.glass, x, y + 1.18, zz + 0.25 * f);
    b.add(new THREE.BoxGeometry(1.64, 0.07, 1.9), mat, x, y + 1.45, zz + 0.25 * f);
    for (const dz of [-1.35, 1.35]) for (const dx of [-0.82, 0.82]) {
      b.add(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12), this.m.tire, x + dx, y + 0.33, zz + dz, 0, 0, Math.PI / 2);
    }
    for (const dz of [-1, 1]) b.add(new THREE.BoxGeometry(1.84, 0.18, 0.12), this.m.darkMetal, x, y + 0.42, zz + dz * 2.1);
    for (const dx of [-0.6, 0.6]) {
      b.add(new THREE.BoxGeometry(0.34, 0.14, 0.04), this.m.headlight, x + dx, y + 0.74, zz - 2.11 * f);
      b.add(new THREE.BoxGeometry(0.3, 0.14, 0.04), this.m.taillight, x + dx, y + 0.74, zz + 2.11 * f);
    }
  }

  buildings(b, c) {
    for (const side of [-1, 1]) {
      let s = 0;
      while (s < CHUNK - 0.01) {
        let len = Math.min(rand(9, 18), CHUNK - s);
        if (CHUNK - s - len < 5) len = CHUNK - s;
        const hs = this.heightIn(c, s).y, he = this.heightIn(c, s + len).y;
        const bottom = Math.min(hs, he) - 2, gfTop = Math.max(hs, he) + 4.4;
        const depth = 10, x = side * (WALK + 1 + depth / 2), zz = c.zTop - s - len / 2;
        b.add(uvBox(depth, gfTop - bottom, len, 8, gfTop - bottom), pick(this.m.stores), x, (gfTop + bottom) / 2, zz);
        const floors = Math.floor(rand(2, 11));
        const upper = floors * 3.2;
        b.add(uvBox(depth, upper, len, 3.2), pick(this.m.facades), x, gfTop + upper / 2, zz);
        b.add(new THREE.BoxGeometry(depth + 0.3, 0.35, len + 0.1), this.m.roof, x, gfTop + upper + 0.17, zz);
        b.add(uvBox(depth + 0.2, 0.3, len + 0.05, 1), this.m.concrete, x, gfTop + 0.15, zz);
        s += len;
      }
      // 먼 배경 빌딩(시차용)
      const hgt = rand(30, 70);
      b.add(uvBox(16, hgt, 20, 3.2), pick(this.m.facades), side * rand(48, 70), c.h1 - 10 + hgt / 2, c.zTop - rand(5, 35));
    }
  }

  buildStairs(ground, props, c) {
    const depth = (STAIR_S1 - STAIR_S0) / STAIR_STEPS;
    const base = c.h1 - 3;
    for (let k = 0; k < STAIR_STEPS; k++) {
      const top = c.h0 - STAIR_DROP * (k + 1) / STAIR_STEPS;
      const s = STAIR_S0 + (k + 0.5) * depth;
      ground.add(uvBox(WALK * 2, top - base, depth, 2), this.m.concrete, 0, (top + base) / 2, c.zTop - s);
    }
    // 계단 시작을 알리는 노란 경고선
    ground.add(new THREE.BoxGeometry(ROAD * 2, 0.02, 0.35), this.m.warn, 0, c.h0 + 0.01, c.zTop - STAIR_S0 + 0.2);
    // 계단 난간: 1~2개 차선에
    const lanes = [...LANES].sort(() => Math.random() - 0.5).slice(0, Math.random() < 0.5 ? 1 : 2);
    const slope = STAIR_DROP / (STAIR_S1 - STAIR_S0);
    const sA = STAIR_S0 - 0.8, sB = STAIR_S1 + 0.8;
    const yA = c.h0 + 0.95 + 0.8 * slope, yB = c.h1 + 0.95 - 0.8 * slope;
    for (const x of lanes) {
      const a = new THREE.Vector3(x, yA, c.zTop - sA), bb = new THREE.Vector3(x, yB, c.zTop - sB);
      const dir = bb.clone().sub(a), len = dir.length();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      const mid = a.clone().add(bb).multiplyScalar(0.5);
      props.addMatrix(new THREE.CylinderGeometry(0.045, 0.045, len, 8), this.m.rail, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
      for (const s of [sA + 0.2, (sA + sB) / 2, sB - 0.2]) {
        const ry = yA + (yB - yA) * (s - sA) / (sB - sA);
        const gy = this.heightIn(c, s).y;
        props.add(new THREE.BoxGeometry(0.06, ry - gy, 0.06), this.m.rail, x, (ry + gy) / 2, c.zTop - s);
      }
      c.grinds.push({ kind: 'handrail', x, zStart: c.zTop - sA, zEnd: c.zTop - sB, yStart: yA, yEnd: yB, blocking: true, half: 0.6 });
    }
    // 계단 아래쪽에 장애물 한 줄
    if (Math.random() < 0.6) this.placeRow(props, c, rand(30, 34), c.h1, true);
  }

  obstacles(b, c) {
    if (c.type === 'stairs') return;
    const diff = Math.min(1, c.i / 40);
    let s = rand(4, 8);
    while (s < CHUNK - 3) {
      const used = this.placeRow(b, c, s, c.h0, false, diff);
      s += used + rand(15 - 6 * diff, 21 - 6 * diff);
    }
  }

  // 한 줄 배치. 최소 한 차선은 비워 둔다. 사용한 길이를 돌려준다.
  placeRow(b, c, s, h, smallOnly, diff = 0.3) {
    const kinds = smallOnly ? ['trash', 'barrier', 'bench'] : ['car', 'car', 'bench', 'trash', 'barrier', 'ledge', 'ledge', 'rail', 'rail'];
    const kind = pick(kinds);
    const order = [0, 1, 2].sort(() => Math.random() - 0.5);
    let used = this.place(b, c, s, LANES[order[0]], kind, h);
    if (!smallOnly && Math.random() < 0.15 + 0.35 * diff) {
      used = Math.max(used, this.place(b, c, s, LANES[order[1]], pick(['trash', 'barrier', 'car']), h));
    }
    return used;
  }

  place(b, c, s, x, kind, h) {
    const z = (ss) => c.zTop - ss;
    const box = (hx, z0, z1, top) => c.solids.push({ minX: x - hx, maxX: x + hx, minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), top, kind });
    switch (kind) {
      case 'car': {
        const zz = z(s + 2.1), f = Math.random() < 0.5 ? 0 : Math.PI;
        this.car(b, x, h, zz, pick(this.m.cars), f);
        box(0.92, zz - 2.15, zz + 2.15, h + 0.93);
        const cz = zz + 0.25 * (f === 0 ? 1 : -1);
        box(0.82, cz - 1.05, cz + 1.05, h + 1.48);
        return 4.2;
      }
      case 'bench': {
        const len = 2.4, zz = z(s + len / 2);
        b.add(new THREE.BoxGeometry(0.62, 0.1, len), this.m.wood, x, h + 0.46, zz);
        for (const d of [-1, 1]) b.add(new THREE.BoxGeometry(0.5, 0.42, 0.1), this.m.darkMetal, x, h + 0.21, zz + d * (len / 2 - 0.2));
        box(0.31, z(s), z(s + len), h + 0.51);
        c.grinds.push({ kind: 'bench', x, zStart: z(s), zEnd: z(s + len), yStart: h + 0.51, yEnd: h + 0.51, blocking: false, half: 0.7 });
        return len;
      }
      case 'trash': {
        const zz = z(s + 0.4);
        b.add(new THREE.CylinderGeometry(0.34, 0.29, 0.95, 10), this.m.bin, x, h + 0.475, zz);
        b.add(new THREE.CylinderGeometry(0.37, 0.37, 0.06, 10), this.m.darkMetal, x, h + 0.97, zz);
        box(0.36, zz - 0.36, zz + 0.36, h + 1.0);
        return 0.8;
      }
      case 'barrier': {
        const zz = z(s + 0.2);
        b.add(new THREE.BoxGeometry(1.9, 0.28, 0.12), this.m.barrier, x, h + 0.86, zz);
        b.add(new THREE.BoxGeometry(1.9, 0.18, 0.1), this.m.barrier, x, h + 0.45, zz);
        for (const d of [-0.85, 0.85]) b.add(new THREE.BoxGeometry(0.08, 1.0, 0.4), this.m.darkMetal, x + d, h + 0.5, zz);
        box(0.95, zz - 0.2, zz + 0.2, h + 1.0);
        return 0.4;
      }
      case 'ledge': {
        const len = rand(7, 10), zz = z(s + len / 2);
        b.add(uvBox(0.8, 0.55, len, 1), this.m.concrete, x, h + 0.275, zz);
        b.add(new THREE.BoxGeometry(0.84, 0.04, len), this.m.metal, x, h + 0.57, zz);
        box(0.42, z(s), z(s + len), h + 0.59);
        c.grinds.push({ kind: 'ledge', x, zStart: z(s), zEnd: z(s + len), yStart: h + 0.59, yEnd: h + 0.59, blocking: false, half: 0.75 });
        return len;
      }
      case 'rail': {
        const len = rand(7, 10), zz = z(s + len / 2), ry = h + 0.5;
        b.add(new THREE.CylinderGeometry(0.045, 0.045, len, 8), this.m.rail, x, ry, zz, Math.PI / 2, 0, 0);
        for (const d of [0.3, len / 2, len - 0.3]) b.add(new THREE.BoxGeometry(0.06, 0.5, 0.06), this.m.rail, x, h + 0.25, z(s + d));
        c.grinds.push({ kind: 'rail', x, zStart: z(s), zEnd: z(s + len), yStart: ry, yEnd: ry, blocking: true, half: 0.6 });
        return len;
      }
    }
    return 1;
  }
}
