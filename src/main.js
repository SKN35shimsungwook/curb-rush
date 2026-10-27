import * as THREE from 'three';
import { createTextures } from './textures.js';
import { World } from './world.js';
import { Skater } from './skater.js';
import { Player } from './player.js';
import { Audio } from './audio.js';
import { bindInput } from './input.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;

// ---------- 렌더러·장면 ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const FOG = 0xc9cfd2;
scene.fog = new THREE.Fog(FOG, 45, 190);
scene.background = new THREE.Color(FOG);

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);

const tex = createTextures();
const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 16, 12), new THREE.MeshBasicMaterial({ map: tex.sky, side: THREE.BackSide, fog: false, depthWrite: false }));
sky.renderOrder = -1;
scene.add(sky);

scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x5a5650, 1.35));
const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 18, bottom: -18, near: 1, far: 80 });
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);

// ---------- 게임 객체 ----------
const world = new World(scene, tex);
const skater = new Skater(tex);
scene.add(skater.root);
const audio = new Audio();

let score = 0, best = 0, mode = 'menu', overTimer = null;
try { best = Number(localStorage.getItem('curbrush-best')) || 0; } catch { /* 저장소 차단 */ }

const comboEl = $('combo');
let comboFade = null;
function showCombo(names, pts, mult) {
  clearTimeout(comboFade);
  comboEl.classList.remove('fade');
  $('combo-points').textContent = mult > 1 ? `${pts.toLocaleString()} × ${mult}` : pts.toLocaleString();
  $('combo-name').textContent = names.join(' + ');
}
function hideCombo(delay) {
  clearTimeout(comboFade);
  comboFade = setTimeout(() => comboEl.classList.add('fade'), delay);
}

const _v = new THREE.Vector3();
function floater(text, gold = false, dy = 0) {
  _v.set(player.x, player.y + 2.1, player.z).project(camera);
  const el = document.createElement('div');
  el.className = 'floater' + (gold ? ' gold' : '');
  el.textContent = text;
  el.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
  el.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight + dy}px`;
  $('floaters').appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

const vibrate = (ms) => {
  if (!isTouch || navigator.userActivation?.hasBeenActive === false) return;
  try { navigator.vibrate?.(ms); } catch { /* 미지원 */ }
};

const player = new Player(skater, world, audio, {
  combo: (names, pts) => showCombo(names, pts, names.length),
  bank: (names, total, mult, perfect) => {
    score += total;
    showCombo(names, total, 1);
    hideCombo(900);
    floater(`+${total.toLocaleString()}`, total >= 1000);
    if (perfect) floater('PERFECT', true, -34);
    if (total >= 300) audio.ding();
    vibrate(12);
  },
  lost: () => { $('combo-points').textContent = 'BAIL'; hideCombo(700); },
  crash: (reason) => {
    vibrate([60, 40, 120]);
    const f = $('flash');
    f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
    overTimer = setTimeout(() => gameOver(reason), 1300);
  },
  vibrate,
});

// ---------- 흐름 ----------
function startRun() {
  audio.init();
  clearTimeout(overTimer);
  world.reset();
  player.reset();
  world.update(player.z);
  score = 0;
  mode = 'play';
  $('start').classList.add('hidden');
  $('over').classList.add('hidden');
  $('hud').classList.remove('hidden');
  document.body.classList.add('playing');
  comboEl.classList.add('fade');
  snapCamera();
}

function gameOver(reason) {
  mode = 'over';
  const total = Math.floor(score + player.dist);
  if (total > best) {
    best = total;
    try { localStorage.setItem('curbrush-best', String(best)); } catch { /* 저장소 차단 */ }
  }
  $('over-reason').textContent = reason;
  $('final-score').textContent = total.toLocaleString();
  $('best-score').textContent = best.toLocaleString();
  $('over').classList.remove('hidden');
}

$('start-btn').addEventListener('click', startRun);
$('restart-btn').addEventListener('click', startRun);
$('sound-btn').addEventListener('click', (e) => {
  audio.init();
  e.currentTarget.classList.toggle('off', !audio.toggle());
});

bindInput(canvas, (ev, src) => {
  if (mode !== 'play') {
    if (mode === 'menu' && src === 'key' && ev === 'up') startRun();
    return;
  }
  const inAir = player.state === 'air';
  const map = {
    left: 'left', right: 'right', up: 'jump', down: 'brake',
    z: 'kick', x: 'shove', c: 'spin',
    swipeLeft: inAir ? 'kick' : 'left',
    swipeRight: inAir ? 'shove' : 'right',
  };
  player.input(map[ev]);
});

// ---------- 카메라 ----------
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function cameraGoal(out, look) {
  out.set(player.x * 0.55, player.y + 2.6, player.z + 5.4);
  look.set(player.x * 0.75, player.y + 1.2, player.z - 7);
}
function snapCamera() {
  cameraGoal(camPos, camLook);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  sky.position.copy(camera.position);
  sun.position.set(player.x + 12, player.y + 30, player.z + 14);
  sun.target.position.set(player.x, player.y, player.z - 6);
}
const _goal = new THREE.Vector3(), _look = new THREE.Vector3();
function updateCamera(dt) {
  cameraGoal(_goal, _look);
  const k = 1 - Math.exp(-dt * 7);
  camPos.x += (_goal.x - camPos.x) * k;
  camPos.z = _goal.z;
  camPos.y += (_goal.y - camPos.y) * (1 - Math.exp(-dt * 5));
  camLook.x += (_look.x - camLook.x) * k;
  camLook.y += (_look.y - camLook.y) * (1 - Math.exp(-dt * 6));
  camLook.z = _look.z;
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  sky.position.copy(camera.position);
  sun.position.set(player.x + 12, player.y + 30, player.z + 14);
  sun.target.position.set(player.x, player.y, player.z - 6);
}

// ---------- 루프 ----------
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? 78 : 62;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

world.update(player.z);
snapCamera();

let last = performance.now();
let menuT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (window.curb?.paused) { snapCamera(); renderer.render(scene, camera); return; }
  if (mode === 'play' || (mode === 'over' && player.state === 'bail')) {
    const steps = Math.ceil(dt / (1 / 90));
    for (let i = 0; i < steps; i++) player.update(dt / steps);
    world.update(player.z);
    $('score').textContent = Math.floor(score + player.dist).toLocaleString();
    $('distance').textContent = `${Math.floor(player.dist)} m`;
    updateCamera(dt);
  } else if (mode === 'menu') {
    // 시작 화면: 스케이터 주위를 천천히 도는 카메라
    menuT += dt * 0.25;
    skater.update(dt);
    camera.position.set(player.x + Math.sin(menuT) * 4.5, player.y + 1.8, player.z + Math.cos(menuT) * 4.5);
    camera.lookAt(player.x, player.y + 1, player.z);
    sky.position.copy(camera.position);
    sun.position.set(player.x + 12, player.y + 30, player.z + 14);
    sun.target.position.set(player.x, player.y, player.z);
  } else {
    updateCamera(dt);
  }
  renderer.render(scene, camera);
}
player.place();
requestAnimationFrame(frame);

// ?debug 로 열면 콘솔에서 상태를 볼 수 있다
if (new URLSearchParams(location.search).has('debug')) window.curb = { player, world, startRun, get mode() { return mode; } };
