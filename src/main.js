import * as THREE from 'three';
import { createTextures } from './textures.js';
import { World } from './world.js';
import { Skater } from './skater.js';
import { Player } from './player.js';
import { Audio } from './audio.js';
import { createInput } from './input.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;
const SESSION_TIME = 120;

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
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 18, bottom: -18, near: 1, far: 80 });
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);

// ---------- 게임 객체 ----------
const world = new World(scene, tex);
const skater = new Skater(tex);
scene.add(skater.root);
const audio = new Audio();

let score = 0, best = 0, mode = 'menu', session = true, timeLeft = SESSION_TIME;
let stats = { tricks: 0, bestCombo: 0, bails: 0 };
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
const flash = () => { const f = $('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); };

const player = new Player(skater, world, audio, {
  combo: (names, pts) => showCombo(names, pts, names.length),
  bank: (names, total, mult, perfect) => {
    score += total;
    stats.tricks += names.length;
    stats.bestCombo = Math.max(stats.bestCombo, total);
    showCombo(names, total, 1);
    hideCombo(900);
    floater(`+${total.toLocaleString()}`, total >= 1000);
    if (perfect) floater('PERFECT', true, -34);
    if (total >= 300) audio.ding();
    vibrate(12);
  },
  lost: () => { $('combo-points').textContent = 'BAIL'; $('combo-name').textContent = ''; comboEl.classList.remove('fade'); hideCombo(900); },
  bail: (reason) => {
    stats.bails++;
    vibrate([60, 40, 120]);
    flash();
    floater(reason, false, -20);
  },
  bump: (hard) => { if (hard) vibrate(30); },
  vibrate,
});

// ---------- 흐름 ----------
function startRun(isSession) {
  audio.init();
  session = isSession;
  timeLeft = SESSION_TIME;
  stats = { tricks: 0, bestCombo: 0, bails: 0 };
  world.reset();
  player.reset();
  world.update(0, player);
  score = 0;
  mode = 'play';
  $('start').classList.add('hidden');
  $('over').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('timer').classList.toggle('hidden', !session);
  document.body.classList.add('playing');
  comboEl.classList.add('fade');
  snapCamera();
}

function endRun() {
  mode = 'over';
  audio.roll(false, 0);
  audio.grind(false);
  const total = Math.floor(score + player.progress);
  if (session && total > best) {
    best = total;
    try { localStorage.setItem('curbrush-best', String(best)); } catch { /* 저장소 차단 */ }
  }
  $('over-title').textContent = session ? 'SESSION OVER' : 'RIDE OVER';
  $('over-reason').textContent = `${Math.floor(player.progress)}m · 트릭 ${stats.tricks}개 · 최고 콤보 ${stats.bestCombo.toLocaleString()} · 넘어짐 ${stats.bails}번`;
  $('final-score').textContent = total.toLocaleString();
  $('best-score').textContent = best.toLocaleString();
  $('over').classList.remove('hidden');
}

$('session-btn').addEventListener('click', () => startRun(true));
$('free-btn').addEventListener('click', () => startRun(false));
$('restart-btn').addEventListener('click', () => startRun(session));
$('menu-btn').addEventListener('click', () => { $('over').classList.add('hidden'); $('start').classList.remove('hidden'); $('hud').classList.add('hidden'); mode = 'menu'; });
$('end-btn').addEventListener('click', () => { if (mode === 'play') endRun(); });
$('sound-btn').addEventListener('click', (e) => {
  audio.init();
  e.currentTarget.classList.toggle('off', !audio.toggle());
});

const input = createInput(canvas, (ev) => {
  if (mode === 'menu' && ev === 'start') return startRun(true);
  if (mode !== 'play') return;
  player.action(ev);
});

// ---------- 카메라: 스케이터 뒤를 따라간다 ----------
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let camYaw = 0;
function cameraGoal(out, look, yaw) {
  const fx = Math.sin(yaw), fz = -Math.cos(yaw);
  out.set(player.x - fx * 5.4, player.y + 2.6, player.z - fz * 5.4);
  look.set(player.x + fx * 7, player.y + 1.1, player.z + fz * 7);
}
function placeLights() {
  sky.position.copy(camera.position);
  sun.position.set(player.x + 12, player.y + 30, player.z + 14);
  sun.target.position.set(player.x, player.y, player.z - 6);
}
function snapCamera() {
  camYaw = player.heading;
  cameraGoal(camPos, camLook, camYaw);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  placeLights();
}
const _goal = new THREE.Vector3(), _look = new THREE.Vector3();
function updateCamera(dt) {
  const target = player.state === 'air' ? player.travel : player.heading;
  let d = target - camYaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  camYaw += d * (1 - Math.exp(-dt * 4));
  cameraGoal(_goal, _look, camYaw);
  const k = 1 - Math.exp(-dt * 9);
  camPos.x += (_goal.x - camPos.x) * k;
  camPos.z += (_goal.z - camPos.z) * k;
  camPos.y += (_goal.y - camPos.y) * (1 - Math.exp(-dt * 5));
  camLook.lerp(_look, 1 - Math.exp(-dt * 10));
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  placeLights();
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

world.update(0, player);
snapCamera();

let last = performance.now();
let menuT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (window.curb?.paused) { snapCamera(); renderer.render(scene, camera); return; }
  if (mode === 'play') {
    const ctl = input.read();
    // 터치로 할 때는 자동으로 밀어서 일정 속도를 유지한다
    player.ctl.steer = ctl.steer;
    player.ctl.brake = ctl.brake;
    player.ctl.push = ctl.push || (ctl.touch && player.speed < 11);
    const steps = Math.ceil(dt / (1 / 90));
    for (let i = 0; i < steps; i++) player.update(dt / steps);
    world.update(dt, player);
    $('score').textContent = Math.floor(score + player.progress).toLocaleString();
    $('distance').textContent = `${Math.floor(player.progress)} m · ${Math.round(player.speed * 3.6)} km/h`;
    if (session) {
      timeLeft -= dt;
      const t = Math.max(0, Math.ceil(timeLeft));
      $('timer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      $('timer').classList.toggle('low', timeLeft < 15);
      if (timeLeft <= 0) endRun();
    }
    updateCamera(dt);
  } else if (mode === 'menu') {
    // 시작 화면: 스케이터 주위를 천천히 도는 카메라
    menuT += dt * 0.25;
    skater.update(dt);
    camera.position.set(player.x + Math.sin(menuT) * 4.5, player.y + 1.8, player.z + Math.cos(menuT) * 4.5);
    camera.lookAt(player.x, player.y + 1, player.z);
    placeLights();
  } else {
    updateCamera(dt);
  }
  renderer.render(scene, camera);
}
player.place();
requestAnimationFrame(frame);

// ?debug 로 열면 콘솔에서 상태를 볼 수 있다
if (new URLSearchParams(location.search).has('debug')) window.curb = { player, world, startRun, endRun, get mode() { return mode; } };
