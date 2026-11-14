/* 动感岛 · 通用小工具：数学、绘图、粒子、音效、语音 */

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b = 0) => b + Math.random() * (a - b);
export const randInt = (a, b) => Math.floor(rand(b + 1, a));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
export const easeOutElastic = (t) => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function starPath(ctx, cx, cy, outer, inner, points = 5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = rot + (i * Math.PI) / points;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

/* 剪纸质感的“贴纸描边”：先粗描边，再填色 */
export function sticker(ctx, draw, fill, ink = "#10201b", lineWidth = 7) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = ink;
  ctx.lineWidth = lineWidth;
  draw();
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

/* ---------- 粒子 ---------- */
export class Particles {
  constructor(max = 260) {
    this.items = [];
    this.max = max;
  }

  spawn(opts) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({
      x: opts.x, y: opts.y,
      vx: opts.vx ?? rand(120, -120),
      vy: opts.vy ?? rand(-60, -320),
      g: opts.g ?? 900,
      life: opts.life ?? rand(1.1, 0.5),
      age: 0,
      size: opts.size ?? rand(9, 3),
      color: opts.color ?? "#f9b233",
      shape: opts.shape ?? "circle",
      rot: opts.rot ?? rand(Math.PI * 2, 0),
      spin: opts.spin ?? rand(9, -9),
      drag: opts.drag ?? 0.6,
      fade: opts.fade ?? true,
    });
  }

  burst(x, y, n, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI * 2, 0);
      const sp = rand(420, 90) * (opts.power ?? 1);
      this.spawn({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 80,
        ...opts,
        color: Array.isArray(opts.color) ? pick(opts.color) : opts.color,
      });
    }
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.age += dt;
      if (p.age > p.life) { this.items.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.vx *= 1 - p.drag * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
  }

  draw(ctx) {
    for (const p of this.items) {
      const t = p.age / p.life;
      ctx.save();
      ctx.globalAlpha = p.fade ? clamp(1 - t * t, 0, 1) : 1;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === "star") {
        starPath(ctx, 0, 0, p.size, p.size * 0.45, 5);
        ctx.fill();
      } else if (p.shape === "rect") {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.6);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  clear() { this.items.length = 0; }
}

/* ---------- 音效 ---------- */
export class AudioKit {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.ducked = false;
    this.music = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  tone({ freq = 440, to = null, dur = 0.16, type = "sine", gain = 0.5, attack = 0.005, when = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.now + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  noise({ dur = 0.18, gain = 0.3, freq = 2400, q = 0.8, when = 0, type = "bandpass" }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.now + when;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }

  sfx(name) {
    if (!this.ctx || this.muted) return;
    const n = this.now;
    switch (name) {
      case "tap":
        this.tone({ freq: 820, to: 640, dur: 0.09, type: "triangle", gain: 0.28 });
        break;
      case "pop":
        this.tone({ freq: 620, to: 1180, dur: 0.1, type: "sine", gain: 0.35 });
        break;
      case "star":
        this.tone({ freq: 1180, dur: 0.1, type: "triangle", gain: 0.2 });
        this.tone({ freq: 1560, dur: 0.14, type: "triangle", gain: 0.14, when: 0.06 });
        break;
      case "sparkle":
        [1046, 1318, 1568, 2093].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.16, type: "sine", gain: 0.16, when: i * 0.045 }));
        break;
      case "slice":
        this.noise({ dur: 0.14, gain: 0.28, freq: 3200, q: 1.4 });
        this.tone({ freq: 900, to: 380, dur: 0.12, type: "sawtooth", gain: 0.1 });
        break;
      case "combo":
        this.tone({ freq: 700, to: 1400, dur: 0.16, type: "square", gain: 0.12 });
        break;
      case "bomb":
        this.noise({ dur: 0.5, gain: 0.5, freq: 220, q: 0.6, type: "lowpass" });
        this.tone({ freq: 120, to: 40, dur: 0.5, type: "sine", gain: 0.4 });
        break;
      case "fail":
        this.tone({ freq: 300, to: 150, dur: 0.32, type: "sawtooth", gain: 0.22 });
        break;
      case "caught":
        this.tone({ freq: 220, to: 110, dur: 0.4, type: "square", gain: 0.18 });
        this.noise({ dur: 0.2, gain: 0.2, freq: 900 });
        break;
      case "light":
        this.tone({ freq: 520, dur: 0.1, type: "sine", gain: 0.2 });
        this.tone({ freq: 780, dur: 0.16, type: "sine", gain: 0.16, when: 0.1 });
        break;
      case "count":
        this.tone({ freq: 660, dur: 0.12, type: "square", gain: 0.18 });
        break;
      case "go":
        this.tone({ freq: 990, dur: 0.22, type: "square", gain: 0.22 });
        this.tone({ freq: 1320, dur: 0.3, type: "sine", gain: 0.14, when: 0.02 });
        break;
      case "hit":
        this.tone({ freq: 440, to: 660, dur: 0.1, type: "triangle", gain: 0.25 });
        this.noise({ dur: 0.08, gain: 0.14, freq: 1800 });
        break;
      case "perfect":
        this.tone({ freq: 880, dur: 0.1, type: "triangle", gain: 0.24 });
        this.tone({ freq: 1320, dur: 0.12, type: "triangle", gain: 0.16, when: 0.06 });
        break;
      case "miss":
        this.tone({ freq: 260, to: 180, dur: 0.18, type: "triangle", gain: 0.16 });
        break;
      case "tick":
        this.tone({ freq: 1200, dur: 0.03, type: "square", gain: 0.07 });
        break;
      case "win":
        [784, 988, 1175, 1568].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.3, type: "triangle", gain: 0.2, when: i * 0.11 }));
        break;
    }
  }

  speak(text, { rate = 1.02, pitch = 1.18 } = {}) {
    if (this.muted || !("speechSynthesis" in window) || !text) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN";
      u.rate = rate;
      u.pitch = pitch;
      const voices = speechSynthesis.getVoices();
      const zh = voices.find((v) => /zh[-_]CN/i.test(v.lang)) || voices.find((v) => /^zh/i.test(v.lang));
      if (zh) u.voice = zh;
      u.onstart = () => this.duck(0.45);
      u.onend = () => this.duck(1);
      u.onerror = () => this.duck(1);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* 语音不可用就算了 */ }
  }

  duck(amount) {
    if (!this.ctx || !this.master) return;
    const t = this.now;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime((this.muted ? 0 : 0.5) * amount, t, 0.08);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.now, 0.03);
    if (m && "speechSynthesis" in window) speechSynthesis.cancel();
  }
}

/* ---------- 简易背景音乐（程序化，不依赖音频文件） ---------- */
export class Music {
  constructor(audio, bpm = 104) {
    this.a = audio;
    this.bpm = bpm;
    this.timer = null;
    this.step = 0;
    this.nextTime = 0;
    this.running = false;
    this.level = 0.55;
  }

  start(startAt) {
    if (!this.a.ctx || this.running) return;
    this.running = true;
    this.step = 0;
    this.nextTime = (startAt ?? this.a.now) + 0.08;
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  schedule() {
    if (!this.running || !this.a.ctx) return;
    const spb = 60 / this.bpm / 4; // 16 分音符
    while (this.nextTime < this.a.now + 0.15) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += spb;
      this.step = (this.step + 1) % 64;
    }
  }

  playStep(step, t) {
    const a = this.a;
    if (a.muted) return;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const when = t - a.now;
    const L = this.level;

    // 底鼓
    if (s % 4 === 0 || (bar > 1 && s === 14)) {
      a.tone({ freq: 130, to: 46, dur: 0.18, type: "sine", gain: 0.5 * L, when });
    }
    // 军鼓
    if (s === 4 || s === 12) {
      a.noise({ dur: 0.13, gain: 0.22 * L, freq: 1500, q: 0.9, when });
      a.tone({ freq: 190, dur: 0.09, type: "triangle", gain: 0.12 * L, when });
    }
    // 踩镲
    if (s % 2 === 0) {
      a.noise({ dur: 0.035, gain: (s % 4 === 0 ? 0.08 : 0.05) * L, freq: 7000, q: 0.7, when, type: "highpass" });
    }
    // 低音
    const bassNotes = [0, 0, 7, 7, 5, 5, 3, 3];
    if (s % 4 === 0) {
      const note = bassNotes[(bar * 2 + Math.floor(s / 8)) % bassNotes.length];
      a.tone({ freq: 110 * Math.pow(2, note / 12), dur: 0.22, type: "triangle", gain: 0.2 * L, when });
    }
    // 旋律小句（第 3、4 小节更密）
    if (bar >= 2 && (s === 2 || s === 7 || s === 10 || s === 13)) {
      const scale = [0, 2, 4, 7, 9, 12];
      const n = scale[(step * 7) % scale.length];
      a.tone({ freq: 440 * Math.pow(2, n / 12), dur: 0.14, type: "square", gain: 0.05 * L, when });
    }
  }
}
