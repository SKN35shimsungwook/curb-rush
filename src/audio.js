// Web Audio로 직접 합성하는 효과음과 90년대 붐뱁 느낌 드럼 루프. 음원 파일이 필요 없다.
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = last * 3.2 + w * 0.15; }

    // 굴러가는 소리
    this.rollSrc = this.loopNoise();
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'lowpass';
    this.rollGain = ctx.createGain(); this.rollGain.gain.value = 0;
    this.rollSrc.connect(this.rollFilter).connect(this.rollGain).connect(this.master);

    // 그라인드 소리
    this.grindSrc = this.loopNoise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 2.5;
    this.grindGain = ctx.createGain(); this.grindGain.gain.value = 0;
    this.grindSrc.connect(bp).connect(this.grindGain).connect(this.master);

    this.music = ctx.createGain(); this.music.gain.value = 0.32;
    this.music.connect(this.master);
    this.beatStep = 0;
    this.nextBeat = ctx.currentTime + 0.1;
    this.beatTimer = setInterval(() => this.scheduleBeat(), 50);
  }

  loopNoise() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true; src.start();
    return src;
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? 0.8 : 0, this.ctx.currentTime, 0.05);
    return this.enabled;
  }

  roll(on, speed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.rollGain.gain.setTargetAtTime(on ? 0.22 : 0, t, 0.05);
    this.rollFilter.frequency.setTargetAtTime(180 + speed * 22, t, 0.1);
    this.rollSrc.playbackRate.setTargetAtTime(0.7 + speed * 0.02, t, 0.1);
  }

  grind(on) {
    if (!this.ctx) return;
    this.grindGain.gain.setTargetAtTime(on ? 0.3 : 0, this.ctx.currentTime, 0.03);
  }

  burst(dur, type, freq, gain, q = 1, dest = this.master) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }

  tone(type, f0, f1, dur, gain, delay = 0, dest = this.master) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }

  pop() { if (!this.ctx) return; this.burst(0.06, 'highpass', 1800, 0.9); this.tone('triangle', 260, 90, 0.08, 0.6); }
  land() { if (!this.ctx) return; this.tone('sine', 140, 45, 0.16, 1.0); this.burst(0.05, 'bandpass', 900, 0.8, 1.5); }
  ding() { if (!this.ctx) return; this.tone('sine', 1320, 1318, 0.25, 0.25); this.tone('sine', 1760, 1758, 0.35, 0.22, 0.08); }
  crash() {
    if (!this.ctx) return;
    this.tone('sine', 110, 35, 0.4, 1.2);
    this.burst(0.25, 'lowpass', 600, 1.0);
    this.tone('sawtooth', 170, 85, 0.32, 0.18, 0.05); // "윽"
  }

  // 90 BPM 드럼 루프(킥·스네어·하이햇)
  scheduleBeat() {
    const ctx = this.ctx, step = 60 / 90 / 4;
    while (this.nextBeat < ctx.currentTime + 0.15) {
      const i = this.beatStep % 16, t = this.nextBeat;
      const at = (fn) => setTimeout(fn, Math.max(0, (t - ctx.currentTime) * 1000));
      if ([0, 7, 10].includes(i)) at(() => this.tone('sine', 120, 40, 0.25, 1.0, 0, this.music));
      if (i === 4 || i === 12) at(() => { this.burst(0.16, 'bandpass', 1800, 0.9, 1, this.music); this.tone('triangle', 220, 160, 0.08, 0.3, 0, this.music); });
      if (i % 2 === 0) at(() => this.burst(i % 4 === 2 ? 0.08 : 0.03, 'highpass', 7000, 0.35, 1, this.music));
      this.nextBeat += step;
      this.beatStep++;
    }
  }

}
