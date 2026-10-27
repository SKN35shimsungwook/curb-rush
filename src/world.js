// 구역이 바뀌며 끝없이 이어지는 코스: 도로(차가 다님) → 광장(계단) → 내리막 공원길 → 터널 → 다시 도로.
// 40m 단위 구간(청크)을 앞쪽에 만들고 지나간 구간은 지운다. 정적 메시는 재질별로 합쳐서 그리기 호출을 줄인다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CHUNK = 40;
const CURB = 0.17;
const STAIR_S0 = 14, STAIR_S1 = 20, STAIR_DROP = 2.4, STAIR_STEPS = 8;
const HALF = { street: 10.8, plaza: 11, park: 4.7, tunnel: 3.6 };   // 탈 수 있는 반폭
const SLOPE = { street: 0.025, park: 0.07, plaza: 0, tunnel: 0.02 }; // 1m당 내려가는 높이

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => Math.floor(rand(a, b + 1));

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

// 자동차 부품 배치(정적 배치·움직이는 차 공용). add(geo, mat, x, y, z, rx, ry, rz)
function carParts(add, m, mat, x, y, z, flip) {
  const f = flip ? -1 : 1; // 앞쪽이 -z면 1
  add(new THREE.BoxGeometry(1.8, 0.62, 4.2), mat, x, y + 0.62, z);
  add(new THREE.BoxGeometry(1.6, 0.5, 2.1), m.glass, x, y + 1.18, z + 0.25 * f);
  add(new THREE.BoxGeometry(1.64, 0.07, 1.9), mat, x, y + 1.45, z + 0.25 * f);
  for (const dz of [-1.35, 1.35]) for (const dx of [-0.82, 0.82]) {
    add(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12), m.tire, x + dx, y + 0.33, z + dz, 0, 0, Math.PI / 2);
  }
  for (const dz of [-1, 1]) add(new THREE.BoxGeometry(1.84, 0.18, 0.12), m.darkMetal, x, y + 0.42, z + dz * 2.1);
  for (const dx of [-0.6, 0.6]) {
    add(new THREE.BoxGeometry(0.34, 0.14, 0.04), m.headlight, x + dx, y + 0.74, z - 2.11 * f);
    add(new THREE.BoxGeometry(0.3, 0.14, 0.04), m.taillight, x + dx, y + 0.74, z + 2.11 * f);
  }
}

export function solidTop(o, z) {
  if (o.topEnd === undefined) return o.top;
  return o.top + (o.topEnd - o.top) * (o.maxZ - z) / (o.maxZ - o.minZ);
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
      tunnel: L({ map: tex.concreteDark, color: 0x8a8a8a }),
      brick: L({ color: 0x7a4b3a }),
      grass: L({ map: tex.grass }),
      leaf: L({ map: tex.foliage, flatShading: true }),
      trunk: L({ color: 0x4a3b2c }),
      paint: L({ color: 0xdcdad2 }),
      warn: L({ color: 0xd9a91c }),
      metal: P({ color: 0x55585c, shininess: 60, specular: 0x555555 }),
      darkMetal: P({ color: 0x2c2e30, shininess: 40, specular: 0x333333 }),
      rail: P({ color: 0x3b3e42, shininess: 120, specular: 0xaaaaaa }),
      greenRail: P({ color: 0x2f5a44, shininess: 80, specular: 0x557766 }),
      glass: P({ color: 0x1d2730, shininess: 120, specular: 0x8a9aab }),
      tire: L({ color: 0x181818 }),
      wood: L({ color: 0x7b5b3b }),
      bin: L({ color: 0x334a3c }),
      hydrant: L({ color: 0x9c2b22 }),
      newsbox: L({ color: 0x2d4f8a }),
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
    // 움직이는 차 원본(색마다 하나, clone으로 재사용)
    this.carTemplates = this.m.cars.map((mat) => {
      const g = new THREE.Group();
      carParts((geo, mt, x, y, z, rx = 0, ry = 0, rz = 0) => {
        const o = new THREE.Mesh(geo, mt);
        o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true;
        g.add(o);
      }, this.m, mat, 0, 0, 0, false);
      return g;
    });
    this.chunks = [];
    this.cars = [];
    this.reset();
  }

  reset() {
    for (const c of this.chunks) this.disposeChunk(c);
    for (const car of this.cars) this.scene.remove(car.group);
    this.chunks = [];
    this.cars = [];
    this.next = 0;
    this.h = 0;
    this.half = HALF.street;
    this.queue = [['street', 'flat'], ['street', 'flat'], ['street', 'slope']];
    this.trafficT = 0;
  }

  // ---------- 조회 ----------
  chunkAt(z) {
    for (const c of this.chunks) if (z <= c.zTop && z > c.zBottom) return c;
    return null;
  }

  groundAt(z) {
    const c = this.chunkAt(z);
    if (!c) return { y: this.chunks.length ? this.chunks[0].h0 : 0, stairs: false, slope: 0, half: HALF.street };
    const r = this.heightIn(c, c.zTop - z);
    r.half = c.half;
    return r;
  }

  heightIn(c, s) {
    if (c.kind === 'slope') return { y: c.h0 + (c.h1 - c.h0) * s / CHUNK, stairs: false, slope: (c.h0 - c.h1) / CHUNK };
    if (c.kind !== 'stairs' || s < STAIR_S0) return { y: c.h0, stairs: false, slope: 0 };
    if (s > STAIR_S1) return { y: c.h1, stairs: false, slope: 0 };
    return { y: c.h0 - STAIR_DROP * (s - STAIR_S0) / (STAIR_S1 - STAIR_S0), stairs: true, slope: STAIR_DROP / (STAIR_S1 - STAIR_S0) };
  }

  nearby(z, out) {
    out.solids.length = 0; out.grinds.length = 0;
    for (const c of this.chunks) {
      if (c.zBottom > z + 12 || c.zTop < z - 12) continue;
      for (const s of c.solids) out.solids.push(s);
      for (const g of c.grinds) out.grinds.push(g);
    }
    for (const car of this.cars) if (Math.abs(car.z - z) < 14) out.solids.push(car.solid);
    return out;
  }

  // ---------- 갱신 ----------
  update(dt, player) {
    const pz = player.z;
    while (-this.next * CHUNK > pz - 240) this.spawn();
    while (this.chunks.length && this.chunks[0].zBottom > pz + 40) this.disposeChunk(this.chunks.shift());
    this.updateTraffic(dt, pz);
  }

  disposeChunk(c) {
    this.scene.remove(c.group);
    c.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }

  // 도로 구역에만 차가 다닌다. 반대 차선(x<0)은 플레이어 쪽으로, 같은 방향 차선은 앞으로 간다.
  updateTraffic(dt, pz) {
    this.trafficT -= dt;
    if (this.trafficT <= 0 && this.cars.length < 7) {
      this.trafficT = rand(0.6, 1.6);
      const z = pz - rand(60, 160);
      const c = this.chunkAt(z);
      if (c && c.zone === 'street') {
        const oncoming = Math.random() < 0.55;
        const x = oncoming ? -2.4 : 2.4;
        const clear = this.cars.every((o) => o.x !== x || Math.abs(o.z - z) > 14);
        if (clear) {
          const group = pick(this.carTemplates).clone();
          if (!oncoming) group.rotation.y = 0; else group.rotation.y = Math.PI;
          const car = { group, x, z, dir: oncoming ? 1 : -1, speed: oncoming ? rand(8, 11) : rand(5, 8), solid: { kind: 'car', hard: true, moving: true, minX: x - 0.92, maxX: x + 0.92, minZ: 0, maxZ: 0, top: 0 } };
          this.cars.push(car);
          this.scene.add(group);
        }
      }
    }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      const nz = car.z + car.dir * car.speed * dt;
      const c = this.chunkAt(nz + car.dir * 3);
      if (c && c.zone === 'street') car.z = nz;
      const y = this.groundAt(car.z).y;
      car.group.position.set(car.x, y, car.z);
      const s = car.solid;
      s.minZ = car.z - 2.15; s.maxZ = car.z + 2.15; s.top = y + 1.48;
      if (car.z > pz + 25 || car.z < pz - 230) {
        this.scene.remove(car.group);
        this.cars.splice(i, 1);
      }
    }
  }

  nextZone() {
    if (!this.queue.length) {
      const q = [];
      q.push(['plaza', 'flat']);
      for (let i = randInt(1, 2); i > 0; i--) q.push(['plaza', 'stairs'], ['plaza', 'flat']);
      for (let i = randInt(2, 4); i > 0; i--) q.push(['park', 'slope']);
      if (Math.random() < 0.6) q.push(['tunnel', 'slope']);
      q.push(['street', 'flat']);
      for (let i = randInt(1, 3); i > 0; i--) q.push(['street', Math.random() < 0.5 ? 'slope' : 'flat']);
      this.queue = q;
    }
    return this.queue.shift();
  }

  spawn() {
    const i = this.next++;
    const zTop = -i * CHUNK;
    const [zone, kind] = this.nextZone();
    const c = {
      i, zTop, zBottom: zTop - CHUNK, zone, kind, half: HALF[zone],
      h0: this.h, h1: this.h, solids: [], grinds: [], group: new THREE.Group(),
    };
    if (kind === 'slope') c.h1 = c.h0 - SLOPE[zone] * CHUNK;
    if (kind === 'stairs') c.h1 = c.h0 - STAIR_DROP;
    this.h = c.h1;
    const prevHalf = this.half;
    this.half = c.half;

    const ground = new Batch(), props = new Batch();
    if (zone === 'street') this.buildStreet(ground, props, c);
    else if (zone === 'plaza') this.buildPlaza(ground, props, c);
    else if (zone === 'park') this.buildPark(ground, props, c);
    else this.buildTunnel(ground, props, c);

    // 넓은 구역에서 좁은 구역으로 들어갈 때 입구 양옆을 막는다(문기둥과 담)
    if (c.half < prevHalf - 0.5) this.entrance(props, c, prevHalf);

    ground.build(c.group, false);
    props.build(c.group, true);
    this.scene.add(c.group);
    this.chunks.push(c);
  }

  // ---------- 공용 조각 ----------
  // s0~s1 구간에 바닥 높이를 따라가는(경사면이면 기울어진) 판을 깐다
  strip(b, mat, c, x, width, s0, s1, top, thick = 3, tile = 2) {
    const ya = this.heightIn(c, s0).y + top, yb = this.heightIn(c, s1).y + top;
    const len = s1 - s0;
    const ang = Math.atan2(ya - yb, len);
    b.add(uvBox(width, thick, len / Math.cos(ang), tile), mat, x, (ya + yb) / 2 - thick / 2, c.zTop - (s0 + s1) / 2, -ang, 0, 0);
  }

  // 경사를 따라 비스듬히 놓인 턱(충돌체+그라인드)
  slopedLedge(b, c, x, s0, s1, width, height, mat, kind = 'ledge') {
    this.strip(b, mat, c, x, width, s0, s1, height, height + 0.6, 1);
    const ya = this.heightIn(c, s0).y + height, yb = this.heightIn(c, s1).y + height;
    c.solids.push({ kind, minX: x - width / 2, maxX: x + width / 2, minZ: c.zTop - s1, maxZ: c.zTop - s0, top: ya, topEnd: yb });
    c.grinds.push({ kind, x, zStart: c.zTop - s0, zEnd: c.zTop - s1, yStart: ya + 0.02, yEnd: yb + 0.02, blocking: false, half: Math.max(0.5, width / 2 + 0.3) });
  }

  // 경사를 따라가는 난간(그라인드 전용, 기둥은 충돌체)
  rail(b, c, x, s0, s1, height, mat = this.m.rail, kind = 'rail') {
    const ya = this.heightIn(c, s0).y + height, yb = this.heightIn(c, s1).y + height;
    const a = new THREE.Vector3(x, ya, c.zTop - s0), e = new THREE.Vector3(x, yb, c.zTop - s1);
    const dir = e.clone().sub(a), len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    b.addMatrix(new THREE.CylinderGeometry(0.045, 0.045, len, 8), mat, new THREE.Matrix4().compose(a.clone().add(e).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    for (const s of [s0 + 0.15, (s0 + s1) / 2, s1 - 0.15]) {
      const ry = ya + (yb - ya) * (s - s0) / (s1 - s0), gy = this.heightIn(c, s).y;
      b.add(new THREE.BoxGeometry(0.06, ry - gy, 0.06), mat, x, (ry + gy) / 2, c.zTop - s);
      c.solids.push({ kind: 'post', minX: x - 0.05, maxX: x + 0.05, minZ: c.zTop - s - 0.05, maxZ: c.zTop - s + 0.05, top: ry });
    }
    c.grinds.push({ kind, x, zStart: c.zTop - s0, zEnd: c.zTop - s1, yStart: ya, yEnd: yb, blocking: true, half: 0.6 });
  }

  bench(b, c, x, s, base) {
    const len = 2.4, zz = c.zTop - s - len / 2;
    b.add(new THREE.BoxGeometry(0.62, 0.1, len), this.m.wood, x, base + 0.46, zz);
    for (const d of [-1, 1]) b.add(new THREE.BoxGeometry(0.5, 0.42, 0.1), this.m.darkMetal, x, base + 0.21, zz + d * (len / 2 - 0.2));
    c.solids.push({ kind: 'bench', minX: x - 0.31, maxX: x + 0.31, minZ: zz - len / 2, maxZ: zz + len / 2, top: base + 0.51 });
    c.grinds.push({ kind: 'bench', x, zStart: zz + len / 2, zEnd: zz - len / 2, yStart: base + 0.51, yEnd: base + 0.51, blocking: false, half: 0.6 });
    return len;
  }

  smallProp(b, c, x, s, base, kind) {
    const zz = c.zTop - s;
    const box = (hx, hz, top) => c.solids.push({ kind, minX: x - hx, maxX: x + hx, minZ: zz - hz, maxZ: zz + hz, top });
    if (kind === 'trash') {
      b.add(new THREE.CylinderGeometry(0.34, 0.29, 0.95, 10), this.m.bin, x, base + 0.475, zz);
      b.add(new THREE.CylinderGeometry(0.37, 0.37, 0.06, 10), this.m.darkMetal, x, base + 0.97, zz);
      box(0.36, 0.36, base + 1.0);
    } else if (kind === 'hydrant') {
      b.add(new THREE.CylinderGeometry(0.15, 0.18, 0.7, 8), this.m.hydrant, x, base + 0.35, zz);
      b.add(new THREE.SphereGeometry(0.16, 8, 6), this.m.hydrant, x, base + 0.72, zz);
      box(0.2, 0.2, base + 0.85);
    } else if (kind === 'newsbox') {
      b.add(new THREE.BoxGeometry(0.5, 1.05, 0.45), this.m.newsbox, x, base + 0.52, zz);
      box(0.26, 0.24, base + 1.05);
    } else if (kind === 'barrier') {
      b.add(new THREE.BoxGeometry(1.9, 0.28, 0.12), this.m.barrier, x, base + 0.86, zz);
      b.add(new THREE.BoxGeometry(1.9, 0.18, 0.1), this.m.barrier, x, base + 0.45, zz);
      for (const d of [-0.85, 0.85]) b.add(new THREE.BoxGeometry(0.08, 1.0, 0.4), this.m.darkMetal, x + d, base + 0.5, zz);
      box(0.95, 0.2, base + 1.0);
    }
    return 0.8;
  }

  // 화단 턱: 위에 잔디와 나무, 양쪽 모서리가 그라인드 턱
  planter(b, c, x, s, len, width, base, tree = true) {
    const zz = c.zTop - s - len / 2, h = 0.55;
    b.add(uvBox(width, h, len, 1), this.m.concrete, x, base + h / 2, zz);
    b.add(new THREE.BoxGeometry(width - 0.3, 0.04, len - 0.3), this.m.grass, x, base + h + 0.01, zz);
    if (tree) {
      b.add(new THREE.CylinderGeometry(0.11, 0.16, 2.6, 6), this.m.trunk, x, base + h + 1.3, zz);
      b.add(new THREE.IcosahedronGeometry(1.3, 1), this.m.leaf, x, base + h + 3.0, zz, rand(0, 3), rand(0, 3), 0);
      b.add(new THREE.IcosahedronGeometry(0.9, 1), this.m.leaf, x + rand(-0.4, 0.4), base + h + 3.9, zz + rand(-0.4, 0.4), rand(0, 3), 0, 0);
    }
    c.solids.push({ kind: 'planter', minX: x - width / 2, maxX: x + width / 2, minZ: zz - len / 2, maxZ: zz + len / 2, top: base + h });
    for (const d of [-1, 1]) {
      c.grinds.push({ kind: 'ledge', x: x + d * (width / 2 - 0.12), zStart: zz + len / 2, zEnd: zz - len / 2, yStart: base + h, yEnd: base + h, blocking: false, half: 0.35 });
    }
  }

  tree(b, x, y, z, size = 1) {
    b.add(new THREE.CylinderGeometry(0.12 * size, 0.18 * size, 3 * size, 6), this.m.trunk, x, y + 1.5 * size, z);
    b.add(new THREE.IcosahedronGeometry(1.6 * size, 1), this.m.leaf, x, y + 3.6 * size, z, rand(0, 3), rand(0, 3), 0);
    b.add(new THREE.IcosahedronGeometry(1.1 * size, 1), this.m.leaf, x + rand(-0.6, 0.6), y + 4.7 * size, z + rand(-0.6, 0.6), rand(0, 3), 0, 0);
  }

  streetlight(b, x, y, zz, side) {
    b.add(new THREE.CylinderGeometry(0.07, 0.11, 6.5, 8), this.m.darkMetal, x, y + 3.25, zz);
    b.add(new THREE.BoxGeometry(1.7, 0.08, 0.08), this.m.darkMetal, x - side * 0.85, y + 6.45, zz);
    b.add(new THREE.BoxGeometry(0.55, 0.14, 0.3), this.m.lamp, x - side * 1.6, y + 6.36, zz);
  }

  buildings(b, c, inner, plain = false) {
    for (const side of [-1, 1]) {
      let s = 0;
      while (s < CHUNK - 0.01) {
        let len = Math.min(rand(9, 18), CHUNK - s);
        if (CHUNK - s - len < 5) len = CHUNK - s;
        const hs = this.heightIn(c, s).y, he = this.heightIn(c, s + len).y;
        const bottom = Math.min(hs, he) - 2, gfTop = Math.max(hs, he) + 4.4;
        const depth = 10, x = side * (inner + depth / 2), zz = c.zTop - s - len / 2;
        b.add(uvBox(depth, gfTop - bottom, len, 8, gfTop - bottom), plain ? pick(this.m.facades) : pick(this.m.stores), x, (gfTop + bottom) / 2, zz);
        const upper = Math.floor(rand(2, 11)) * 3.2;
        b.add(uvBox(depth, upper, len, 3.2), pick(this.m.facades), x, gfTop + upper / 2, zz);
        b.add(new THREE.BoxGeometry(depth + 0.3, 0.35, len + 0.1), this.m.roof, x, gfTop + upper + 0.17, zz);
        b.add(uvBox(depth + 0.2, 0.3, len + 0.05, 1), this.m.concrete, x, gfTop + 0.15, zz);
        s += len;
      }
    }
  }

  skyline(b, c) {
    for (const side of [-1, 1]) {
      const hgt = rand(30, 70);
      b.add(uvBox(16, hgt, 20, 3.2), pick(this.m.facades), side * rand(48, 70), c.h1 - 10 + hgt / 2, c.zTop - rand(5, 35));
    }
  }

  entrance(b, c, prevHalf) {
    const y = c.h0, w = Math.max(prevHalf, 12) + 1 - c.half;
    for (const side of [-1, 1]) {
      const x = side * (c.half + w / 2);
      const isTunnel = c.zone === 'tunnel';
      b.add(uvBox(w, isTunnel ? 7 : 1.3, 0.6, 1), isTunnel ? this.m.tunnel : this.m.brick, x, y + (isTunnel ? 3.5 : 0.65), c.zTop - 0.3);
      if (!isTunnel) {
        b.add(uvBox(0.7, 2.6, 0.7, 1), this.m.brick, side * (c.half + 0.35), y + 1.3, c.zTop - 0.3);
        b.add(new THREE.BoxGeometry(0.85, 0.12, 0.85), this.m.concrete, side * (c.half + 0.35), y + 2.66, c.zTop - 0.3);
        for (let k = 0; k < w; k += 0.25) b.add(new THREE.BoxGeometry(0.035, 1.2, 0.035), this.m.darkMetal, side * (c.half + 0.8 + k), y + 1.9, c.zTop - 0.3);
      }
      c.solids.push({ kind: 'wall', minX: Math.min(x - w / 2, x + w / 2), maxX: Math.max(x - w / 2, x + w / 2), minZ: c.zTop - 0.6, maxZ: c.zTop, top: y + 4 });
    }
  }

  // ---------- 구역별 ----------
  buildStreet(ground, props, c) {
    const hAt = (s) => this.heightIn(c, s).y;
    this.strip(ground, this.m.road, c, 0, 12, 0, CHUNK, 0, 3, 4);
    for (const side of [-1, 1]) {
      this.strip(ground, this.m.walk, c, side * 8.62, 4.75, 0, CHUNK, CURB);
      this.strip(ground, this.m.curb, c, side * 6.12, 0.25, 0, CHUNK, CURB, 3, 1);
    }
    const ang = Math.atan2(hAt(0) - hAt(CHUNK), CHUNK);
    for (let s = 1.5; s < CHUNK - 2; s += 6) {
      ground.add(new THREE.BoxGeometry(0.13, 0.02, 2.6), this.m.paint, 0, hAt(s + 1.3) + 0.006, c.zTop - s - 1.3, -ang, 0, 0);
    }
    if (c.kind === 'flat' && Math.random() < 0.5) {
      for (let x = -5.4; x <= 5.41; x += 1.2) ground.add(new THREE.BoxGeometry(0.62, 0.02, 3.6), this.m.paint, x, c.h0 + 0.008, c.zTop - 4.8);
      for (const side of [-1, 1]) {
        const x = side * 6.8, y = c.h0 + CURB, zz = c.zTop - 2.4;
        props.add(new THREE.CylinderGeometry(0.08, 0.1, 4.4, 8), this.m.darkMetal, x, y + 2.2, zz);
        props.add(new THREE.BoxGeometry(0.34, 0.95, 0.3), this.m.darkMetal, x, y + 3.9, zz);
        props.add(new THREE.SphereGeometry(0.09, 8, 6), this.m.redLight, x, y + 4.18, zz - 0.16);
        props.add(new THREE.SphereGeometry(0.09, 8, 6), this.m.greenLight, x, y + 3.62, zz - 0.16);
        c.solids.push({ kind: 'post', minX: x - 0.12, maxX: x + 0.12, minZ: zz - 0.12, maxZ: zz + 0.12, top: y + 5 });
      }
    }
    for (const s of [8, 28]) for (const side of [-1, 1]) {
      const x = side * 10.4, y = hAt(s) + CURB;
      this.streetlight(props, x, y, c.zTop - s, side);
      c.solids.push({ kind: 'post', minX: x - 0.12, maxX: x + 0.12, minZ: c.zTop - s - 0.12, maxZ: c.zTop - s + 0.12, top: y + 7 });
    }

    // 길가 주차 차량
    for (const side of [-1, 1]) {
      let s = rand(2, 10);
      while (s < CHUNK - 4.4) {
        if (Math.random() < 0.5) {
          const zz = c.zTop - s - 2.1, x = side * 4.95, y = hAt(s + 2.1);
          carParts((g, mt, ...a) => props.add(g, mt, ...a), this.m, pick(this.m.cars), x, y, zz, Math.random() < 0.5);
          c.solids.push({ kind: 'car', hard: true, minX: x - 0.92, maxX: x + 0.92, minZ: zz - 2.15, maxZ: zz + 2.15, top: y + 1.48 });
        }
        s += rand(6, 11);
      }
    }

    // 인도 위 소품: 벤치, 화단 턱, 자전거 거치대 레일, 쓰레기통 등
    for (const side of [-1, 1]) {
      let s = rand(2, 6);
      while (s < CHUNK - 6) {
        const base = hAt(s) + CURB;
        const kind = pick(['bench', 'planter', 'planter', 'rack', 'trash', 'hydrant', 'newsbox', 'none']);
        let used = 1;
        if (kind === 'bench') used = this.bench(props, c, side * 9.9, s, base);
        else if (kind === 'planter') { used = rand(5, 8); this.planter(props, c, side * 8.6, s, used, 1.4, base); }
        else if (kind === 'rack') { used = rand(4, 6); this.rail(props, c, side * 7.4, s, s + used, 0.5 + CURB); }
        else if (kind !== 'none') used = this.smallProp(props, c, side * pick([6.7, 7.2]), s, base, kind);
        s += used + rand(3, 8);
      }
    }
    this.buildings(ground, c, 11.5);
    this.skyline(ground, c);
  }

  buildPlaza(ground, props, c) {
    const stairs = c.kind === 'stairs';
    const W = 23.4;
    if (stairs) {
      this.strip(ground, this.m.walk, c, 0, W, 0, STAIR_S0, 0);
      this.strip(ground, this.m.walk, c, 0, W, STAIR_S1, CHUNK, 0);
      const depth = (STAIR_S1 - STAIR_S0) / STAIR_STEPS, base = c.h1 - 3;
      for (let k = 0; k < STAIR_STEPS; k++) {
        const top = c.h0 - STAIR_DROP * (k + 1) / STAIR_STEPS;
        ground.add(uvBox(W, top - base, depth, 2), this.m.concrete, 0, (top + base) / 2, c.zTop - STAIR_S0 - (k + 0.5) * depth);
      }
      ground.add(new THREE.BoxGeometry(W, 0.02, 0.35), this.m.warn, 0, c.h0 + 0.01, c.zTop - STAIR_S0 + 0.2);
      // 계단 난간과 허바(계단 옆 비스듬한 턱)
      const xs = [-7, -3.5, 0, 3.5, 7].sort(() => Math.random() - 0.5);
      const slope = STAIR_DROP / (STAIR_S1 - STAIR_S0);
      for (const x of xs.slice(0, randInt(1, 2))) this.stairRail(props, c, x, slope);
      if (Math.random() < 0.7) {
        const x = xs[2];
        const s0 = STAIR_S0 - 0.2, s1 = STAIR_S1 + 0.2;
        const ya = c.h0 + 0.6, yb = c.h1 + 0.6;
        const len = s1 - s0, ang = Math.atan2(ya - yb, len);
        props.add(uvBox(0.9, 1.6, len / Math.cos(ang), 1), this.m.concrete, x, (ya + yb) / 2 - 0.8, c.zTop - (s0 + s1) / 2, -ang, 0, 0);
        c.solids.push({ kind: 'ledge', minX: x - 0.45, maxX: x + 0.45, minZ: c.zTop - s1, maxZ: c.zTop - s0, top: ya, topEnd: yb });
        c.grinds.push({ kind: 'ledge', x, zStart: c.zTop - s0, zEnd: c.zTop - s1, yStart: ya + 0.02, yEnd: yb + 0.02, blocking: false, half: 0.75 });
      }
    } else {
      this.strip(ground, this.m.walk, c, 0, W, 0, CHUNK, 0);
    }

    // 평평한 부분에 화단·벤치·턱 배치
    const spots = stairs ? [[2, 11], [STAIR_S1 + 2, CHUNK - 2]] : [[3, CHUNK - 3]];
    for (const [a, bnd] of spots) {
      let s = a + rand(0, 2);
      while (s < bnd - 3) {
        const x = rand(-8, 8);
        const kind = pick(['planter', 'planter', 'bench', 'ledge', 'rail', 'trash']);
        let used = 1;
        const base = this.heightIn(c, s).y;
        if (kind === 'planter') { used = Math.min(rand(5, 8), bnd - s); this.planter(props, c, x, s, used, rand(1.6, 2.4), base, Math.random() < 0.6); }
        else if (kind === 'bench') used = this.bench(props, c, x, s, base);
        else if (kind === 'ledge') { used = Math.min(rand(6, 9), bnd - s); this.slopedLedge(props, c, x, s, s + used, 0.8, 0.5, this.m.concrete); }
        else if (kind === 'rail') { used = Math.min(rand(6, 9), bnd - s); this.rail(props, c, x, s, s + used, 0.55); }
        else used = this.smallProp(props, c, x, s, base, 'trash');
        s += used + rand(3, 6);
      }
    }
    for (const side of [-1, 1]) for (const s of [5, 25]) {
      const y = this.heightIn(c, s).y;
      this.streetlight(props, side * 11.2, y, c.zTop - s, side);
    }
    this.buildings(ground, c, 11.7, true);
    this.skyline(ground, c);
  }

  stairRail(b, c, x, slope) {
    const sA = STAIR_S0 - 0.8, sB = STAIR_S1 + 0.8;
    const yA = c.h0 + 0.95 + 0.8 * slope, yB = c.h1 + 0.95 - 0.8 * slope;
    const a = new THREE.Vector3(x, yA, c.zTop - sA), e = new THREE.Vector3(x, yB, c.zTop - sB);
    const dir = e.clone().sub(a), len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    b.addMatrix(new THREE.CylinderGeometry(0.045, 0.045, len, 8), this.m.rail, new THREE.Matrix4().compose(a.clone().add(e).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    for (const s of [sA + 0.2, (sA + sB) / 2, sB - 0.2]) {
      const ry = yA + (yB - yA) * (s - sA) / (sB - sA), gy = this.heightIn(c, s).y;
      b.add(new THREE.BoxGeometry(0.06, ry - gy, 0.06), this.m.rail, x, (ry + gy) / 2, c.zTop - s);
      c.solids.push({ kind: 'post', minX: x - 0.05, maxX: x + 0.05, minZ: c.zTop - s - 0.05, maxZ: c.zTop - s + 0.05, top: ry });
    }
    c.grinds.push({ kind: 'handrail', x, zStart: c.zTop - sA, zEnd: c.zTop - sB, yStart: yA, yEnd: yB, blocking: true, half: 0.6 });
  }

  buildPark(ground, props, c) {
    this.strip(ground, this.m.concrete, c, 0, 9.4, 0, CHUNK, 0, 3, 3);
    for (const side of [-1, 1]) {
      // 길 양옆 긴 턱(그라인드용)과 그 너머 잔디 언덕
      this.slopedLedge(props, c, side * 4.4, 0, CHUNK, 0.6, 0.45, this.m.concrete);
      this.strip(ground, this.m.grass, c, side * 11, 12.6, 0, CHUNK, 0.5);
      this.strip(ground, this.m.grass, c, side * 22, 10, 0, CHUNK, 2.2);
      for (let s = rand(2, 6); s < CHUNK; s += rand(5, 9)) {
        this.tree(ground, side * rand(6.5, 14), this.heightIn(c, s).y + 0.5, c.zTop - s, rand(0.9, 1.3));
      }
      for (const s of [10, 30]) this.streetlight(props, side * 5.3, this.heightIn(c, s).y + 0.5, c.zTop - s, side);
      // 철제 울타리
      const ya = c.h0 + 1.5, yb = c.h1 + 1.5, ang = Math.atan2(ya - yb, CHUNK);
      props.add(new THREE.BoxGeometry(0.05, 0.05, CHUNK / Math.cos(ang)), this.m.darkMetal, side * 5.8, (ya + yb) / 2, c.zTop - CHUNK / 2, -ang, 0, 0);
      for (let s = 0; s < CHUNK; s += 0.5) {
        const y = this.heightIn(c, s).y;
        props.add(new THREE.BoxGeometry(0.03, 1.0, 0.03), this.m.darkMetal, side * 5.8, y + 1.0, c.zTop - s);
      }
    }
    // 길 위: 내리막 난간, 벤치, 쓰레기통
    let s = rand(3, 8);
    while (s < CHUNK - 4) {
      const kind = pick(['rail', 'rail', 'bench', 'trash', 'ledge']);
      const x = pick([-2.6, -1.2, 0, 1.2, 2.6]);
      let used = 1;
      if (kind === 'rail') { used = Math.min(rand(8, 12), CHUNK - s - 1); this.rail(props, c, x, s, s + used, 0.6, this.m.greenRail); }
      else if (kind === 'ledge') { used = Math.min(rand(6, 9), CHUNK - s - 1); this.slopedLedge(props, c, x, s, s + used, 0.7, 0.45, this.m.concrete); }
      else if (kind === 'bench') used = this.bench(props, c, x, s, this.heightIn(c, s).y);
      else used = this.smallProp(props, c, x, s, this.heightIn(c, s).y, 'trash');
      s += used + rand(5, 10);
    }
  }

  buildTunnel(ground, props, c) {
    this.strip(ground, this.m.tunnel, c, 0, 8, 0, CHUNK, 0, 3, 2);
    for (const side of [-1, 1]) {
      this.strip(ground, this.m.tunnel, c, side * 4.6, 2, 0, CHUNK, 5.2, 8, 2);
      this.strip(ground, this.m.grass, c, side * 20, 30, 0, CHUNK, 6.5, 2, 3);
      for (let s = 4; s < CHUNK; s += 8) {
        props.add(new THREE.BoxGeometry(0.1, 0.18, 0.9), this.m.lamp, side * 3.56, this.heightIn(c, s).y + 3.6, c.zTop - s);
      }
      c.solids.push({ kind: 'wall', minX: side > 0 ? 3.6 : -5.6, maxX: side > 0 ? 5.6 : -3.6, minZ: c.zBottom, maxZ: c.zTop, top: c.h0 + 6 });
    }
    this.strip(ground, this.m.tunnel, c, 0, 11.2, 0, CHUNK, 5.6, 0.5, 2);
    this.strip(ground, this.m.grass, c, 0, 11.2, 0, CHUNK, 6.5, 1, 3);
    if (Math.random() < 0.6) {
      const s = rand(12, 28);
      this.smallProp(props, c, pick([-1.8, 0, 1.8]), s, this.heightIn(c, s).y, 'barrier');
    }
  }
}
