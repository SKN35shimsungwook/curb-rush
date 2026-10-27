// 키보드와 터치를 하나의 조작 상태로 묶는다.
// 계속 누르는 값: steer(-1~1), push, brake / 한 번 누르는 동작: 'ollie' 'kick' 'shove' 'start'
export function createInput(target, emit) {
  const held = new Set();
  const state = { steer: 0, push: false, brake: false, touch: false };
  const keyAction = { Space: 'ollie', KeyZ: 'kick', KeyX: 'shove', Enter: 'start' };
  const holdKeys = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'push', KeyW: 'push', ArrowDown: 'brake', KeyS: 'brake' };

  window.addEventListener('keydown', (e) => {
    if (holdKeys[e.code]) { held.add(holdKeys[e.code]); e.preventDefault(); }
    const a = keyAction[e.code];
    if (a) { e.preventDefault(); if (!e.repeat) emit(a); }
  });
  window.addEventListener('keyup', (e) => { if (holdKeys[e.code]) held.delete(holdKeys[e.code]); });
  window.addEventListener('blur', () => held.clear());

  // 터치: 화면 왼쪽 = 가상 스틱(좌우로 끌어서 방향), 오른쪽 = 제스처(탭·위 스와이프 올리, 좌/우 스와이프 트릭, 아래 스와이프 감속)
  let stick = null, gesture = null, brakeUntil = 0, touchSteer = 0;
  target.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') state.touch = true;
    if (e.clientX < innerWidth * 0.45) stick = { id: e.pointerId, x: e.clientX };
    else gesture = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  target.addEventListener('pointermove', (e) => {
    if (stick && e.pointerId === stick.id) touchSteer = Math.max(-1, Math.min(1, (e.clientX - stick.x) / 70));
  });
  const end = (e) => {
    if (stick && e.pointerId === stick.id) { stick = null; touchSteer = 0; return; }
    if (!gesture || e.pointerId !== gesture.id) return;
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
    gesture = null;
    if (Math.hypot(dx, dy) < 24) return emit('ollie');
    if (Math.abs(dy) > Math.abs(dx)) {
      if (dy < 0) emit('ollie'); else brakeUntil = performance.now() + 700;
    } else emit(dx < 0 ? 'kick' : 'shove');
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);

  return {
    state,
    read() {
      const kb = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
      state.steer = kb || touchSteer;
      state.push = held.has('push');
      state.brake = held.has('brake') || performance.now() < brakeUntil;
      return state;
    },
  };
}
