// 키보드와 터치(스와이프·탭)를 같은 이벤트 이름으로 바꿔 넘긴다.
// 'left' 'right' 'up' 'down' 'z' 'x' 'c' / 스와이프: 'swipeLeft' 'swipeRight' 'up' 'down'
export function bindInput(target, emit) {
  const keys = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up', Space: 'up', ArrowDown: 'down', KeyS: 'down',
    KeyZ: 'z', KeyX: 'x', KeyC: 'c',
  };
  window.addEventListener('keydown', (e) => {
    const ev = keys[e.code];
    if (!ev) return;
    e.preventDefault();
    if (!e.repeat) emit(ev, 'key');
  });

  let start = null;
  target.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  target.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    const dist = Math.hypot(dx, dy);
    start = null;
    if (dist < 24) {
      emit(e.clientX < window.innerWidth / 2 ? 'left' : 'right', 'tap');
      return;
    }
    if (Math.abs(dy) > Math.abs(dx)) emit(dy < 0 ? 'up' : 'down', 'swipe');
    else emit(dx < 0 ? 'swipeLeft' : 'swipeRight', 'swipe');
  });
  target.addEventListener('pointercancel', () => { start = null; });
}
