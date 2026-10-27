// 캔버스로 그리는 텍스처 모음. 외부 이미지 없이 2000년대 초반 3D 게임 느낌의 콘크리트·아스팔트·건물 외벽을 만든다.
import * as THREE from 'three';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function grain(ctx, w, h, amount) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function blotches(ctx, w, h, count, color, maxR, alpha) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = Math.random() * alpha;
    ctx.beginPath();
    ctx.ellipse(Math.random() * w, Math.random() * h, Math.random() * maxR + 4, Math.random() * maxR + 4, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function cracks(ctx, w, h, count, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    let x = Math.random() * w, y = Math.random() * h;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

function toTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function asphalt() {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#3c3d3f'; ctx.fillRect(0, 0, 512, 512);
  blotches(ctx, 512, 512, 60, '#2a2b2d', 50, 0.35);
  blotches(ctx, 512, 512, 40, '#55565a', 30, 0.2);
  grain(ctx, 512, 512, 46);
  cracks(ctx, 512, 512, 8, 'rgba(20,20,20,.6)');
  return toTexture(c);
}

function sidewalk() {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#8f8c86'; ctx.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const v = 130 + Math.random() * 18;
    ctx.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
    ctx.fillRect(x * 128 + 2, y * 128 + 2, 124, 124);
  }
  blotches(ctx, 512, 512, 50, '#5d5a55', 26, 0.3);
  grain(ctx, 512, 512, 34);
  ctx.strokeStyle = 'rgba(40,40,40,.55)'; ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * 128, 0); ctx.lineTo(i * 128, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 128); ctx.lineTo(512, i * 128); ctx.stroke();
  }
  cracks(ctx, 512, 512, 5, 'rgba(50,50,50,.5)');
  return toTexture(c);
}

function concrete(base = '#9a978f') {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
  blotches(ctx, 256, 256, 30, '#6a675f', 22, 0.28);
  blotches(ctx, 256, 256, 20, '#b8b5ad', 16, 0.2);
  grain(ctx, 256, 256, 30);
  // 아래쪽 물때
  const g = ctx.createLinearGradient(0, 180, 0, 256);
  g.addColorStop(0, 'rgba(40,38,34,0)'); g.addColorStop(1, 'rgba(40,38,34,.35)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  return toTexture(c);
}

function grass() {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#5b6b3c'; ctx.fillRect(0, 0, 256, 256);
  blotches(ctx, 256, 256, 80, '#44522b', 14, 0.5);
  blotches(ctx, 256, 256, 60, '#7d8a52', 10, 0.35);
  grain(ctx, 256, 256, 40);
  return toTexture(c);
}

function foliage() {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#56683a'; ctx.fillRect(0, 0, 128, 128);
  blotches(ctx, 128, 128, 90, '#3a4a24', 8, 0.6);
  blotches(ctx, 128, 128, 60, '#7f9154', 6, 0.5);
  grain(ctx, 128, 128, 30);
  return toTexture(c);
}

function denim() {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#44597a'; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  for (let i = -128; i < 128; i += 3) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 128, 128); ctx.stroke(); }
  blotches(ctx, 128, 128, 20, '#7c93b3', 18, 0.25);
  grain(ctx, 128, 128, 26);
  return toTexture(c);
}

function fabric(base) {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = base; ctx.fillRect(0, 0, 128, 128);
  blotches(ctx, 128, 128, 25, '#000', 20, 0.08);
  grain(ctx, 128, 128, 18);
  return toTexture(c);
}

// 건물 위층 한 칸(창문 1개 × 1층). 박스 UV를 월드 크기 기준으로 반복시켜 쓴다.
function facade(wall, frame) {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = wall; ctx.fillRect(0, 0, 128, 128);
  grain(ctx, 128, 128, 22);
  // 층 띠
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(0, 118, 128, 10);
  ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(0, 116, 128, 2);
  // 창틀과 유리
  ctx.fillStyle = frame; ctx.fillRect(22, 22, 84, 80);
  const g = ctx.createLinearGradient(26, 26, 102, 98);
  g.addColorStop(0, '#9fb3c4'); g.addColorStop(0.45, '#4d6273'); g.addColorStop(0.55, '#7b90a2'); g.addColorStop(1, '#2f3d4a');
  ctx.fillStyle = g; ctx.fillRect(26, 26, 76, 72);
  ctx.fillStyle = frame; ctx.fillRect(62, 26, 4, 72);
  // 창턱
  ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(18, 102, 92, 4);
  return toTexture(c);
}

// 1층 상가: 셔터 또는 유리 진열창
function storefront(kind) {
  const [c, ctx] = makeCanvas(256, 128);
  ctx.fillStyle = '#5a5853'; ctx.fillRect(0, 0, 256, 128);
  grain(ctx, 256, 128, 20);
  if (kind === 0) {
    ctx.fillStyle = '#8c8f92'; ctx.fillRect(20, 24, 216, 104);
    for (let y = 26; y < 128; y += 6) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(20, y, 216, 2); }
    blotches(ctx, 256, 128, 6, '#333', 20, 0.25);
  } else {
    const g = ctx.createLinearGradient(0, 24, 0, 128);
    g.addColorStop(0, '#2c3a44'); g.addColorStop(1, '#5c6f7c');
    ctx.fillStyle = g; ctx.fillRect(14, 24, 228, 104);
    ctx.fillStyle = '#2a2a2a';
    for (let x = 14; x <= 242; x += 57) ctx.fillRect(x, 24, 4, 104);
    ctx.fillStyle = ['#7a2e2a', '#2f5a3a', '#2d3f6b'][Math.floor(Math.random() * 3)];
    ctx.fillRect(10, 4, 236, 16);
  }
  return toTexture(c);
}

function skyGradient() {
  const [c, ctx] = makeCanvas(4, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#7f9fbd'); g.addColorStop(0.55, '#b9c7d2'); g.addColorStop(1, '#d9dcd9');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function blobShadow() {
  const [c, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createTextures() {
  const walls = [['#c9c1b2', '#3b3b3b'], ['#a39a8c', '#2d2d2d'], ['#b8b0a2', '#5a5048'], ['#8e8b86', '#2a2a2a'], ['#c4b9a6', '#6b5e4e'], ['#9fa4a6', '#30363a']];
  return {
    asphalt: asphalt(),
    sidewalk: sidewalk(),
    concrete: concrete(),
    concreteDark: concrete('#7d7a73'),
    grass: grass(),
    foliage: foliage(),
    denim: denim(),
    hoodie: fabric('#8d8f93'),
    facades: walls.map(([w, f]) => facade(w, f)),
    stores: [storefront(0), storefront(1), storefront(1)],
    sky: skyGradient(),
    blob: blobShadow(),
  };
}
