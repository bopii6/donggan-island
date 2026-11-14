/* 姿态识别层：摄像头 → MediaPipe PoseLandmarker → 屏幕坐标关键点 + 运动量
   另外提供一个「鼠标小人」模拟源，没摄像头也能试玩、也方便调试。 */

import { FilesetResolver, PoseLandmarker } from "../vendor/mediapipe/vision_bundle.mjs";
import { clamp } from "./kit.js";

const WASM_BASE = new URL("../vendor/mediapipe/wasm", import.meta.url).href;
const MODEL_LITE = new URL("../vendor/models/pose_landmarker_lite.task", import.meta.url).href;
const MODEL_FULL = new URL("../vendor/models/pose_landmarker_full.task", import.meta.url).href;

const IDX = {
  nose: 0,
  lSho: 11, rSho: 12, lElb: 13, rElb: 14, lWri: 15, rWri: 16,
  lHip: 23, rHip: 24, lKne: 25, rKne: 26, lAnk: 27, rAnk: 28,
  lHeel: 29, rHeel: 30, lToe: 31, rToe: 32,
};

const ACTIVITY = ["lWri", "rWri", "lElb", "rElb", "lSho", "rSho", "lHip", "rHip", "lKne", "rKne", "lAnk", "rAnk", "nose"];
const CORE = ["nose", "lSho", "rSho", "lWri", "rWri", "lHip", "rHip", "lKne", "rKne", "lAnk", "rAnk"];

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) });

export class PoseTracker {
  constructor(video, { width = 0, height = 0, quality = "lite" } = {}) {
    this.video = video;
    this.W = width;
    this.H = height;
    this.quality = quality;

    this.mode = "idle"; // idle | camera | mock
    this.landmarker = null;
    this.stream = null;
    this.running = false;

    this.rect = { x: 0, y: 0, w: 0, h: 0 };
    this.videoSize = { w: 0, h: 0 };

    this.smooth = {};
    this.speed = {};
    this.lastTs = 0;
    this.frame = null;
    this.baseline = null;
    this.calibBuffer = [];

    this.mock = null;
    this.pointer = { x: 0.5, y: 0.5 };
    this.keys = new Set();
  }

  resize(w, h) {
    this.W = w;
    this.H = h;
    this.fitRect();
  }

  fitRect() {
    const { w: vw, h: vh } = this.videoSize;
    if (!vw || !vh || !this.W || !this.H) {
      this.rect = { x: 0, y: 0, w: this.W, h: this.H };
      return;
    }
    const scale = Math.max(this.W / vw, this.H / vh);
    const w = vw * scale;
    const h = vh * scale;
    this.rect = { x: (this.W - w) / 2, y: (this.H - h) / 2, w, h };
  }

  async loadModel() {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    const opts = {
      baseOptions: {
        modelAssetPath: this.quality === "full" ? MODEL_FULL : MODEL_LITE,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, opts);
    } catch (e) {
      console.warn("[pose] GPU 不可用，改用 CPU", e);
      opts.baseOptions.delegate = "CPU";
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, opts);
    }
    return this.landmarker;
  }

  async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("这个浏览器不支持摄像头（请用 Chrome 或 Edge）");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    await new Promise((resolve) => {
      if (this.video.videoWidth) return resolve();
      this.video.onloadedmetadata = () => resolve();
    });
    this.videoSize = { w: this.video.videoWidth, h: this.video.videoHeight };
    this.fitRect();
    if (!this.landmarker) await this.loadModel();
    this.mode = "camera";
    this.running = true;
    this.reset();
  }

  startMock() {
    this.mode = "mock";
    this.running = true;
    this.videoSize = { w: 0, h: 0 };
    this.rect = { x: 0, y: 0, w: this.W, h: this.H };
    this.mock = {
      baseY: 0.78,
      lean: 0,
      leanTarget: 0,
      jump: 0,
      jumpV: 0,
      jumping: false,
      t: 0,
    };
    this.reset();
    this.bindMockInput();
  }

  bindMockInput() {
    if (this._mockBound) return;
    this._mockBound = true;
    const onMove = (e) => {
      const t = e.touches ? e.touches[0] : e;
      this.pointer.x = t.clientX / window.innerWidth;
      this.pointer.y = t.clientY / window.innerHeight;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.code === "Space") {
        e.preventDefault();
        this.triggerMockJump();
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
  }

  triggerMockJump() {
    if (!this.mock || this.mock.jumping) return;
    this.mock.jumping = true;
    this.mock.jumpV = 1;
  }

  reset() {
    this.smooth = {};
    this.speed = {};
    this.baseline = null;
    this.calibBuffer = [];
    this.lastTs = 0;
  }

  stop() {
    this.running = false;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  /* ---------- 每帧更新 ---------- */
  update(nowMs, dt) {
    if (!this.running) return this.frame;
    const dtc = clamp(dt, 0.001, 0.12);
    let raw = null;

    if (this.mode === "camera") {
      if (!this.landmarker || this.video.readyState < 2) return this.frame;
      if (this.W !== this._lastW || this.H !== this._lastH) {
        this._lastW = this.W; this._lastH = this.H; this.fitRect();
      }
      let res;
      try {
        res = this.landmarker.detectForVideo(this.video, Math.round(nowMs));
      } catch (e) {
        return this.frame;
      }
      const lms = res?.landmarks?.[0];
      if (lms) {
        raw = {};
        for (const [k, i] of Object.entries(IDX)) {
          const p = lms[i];
          raw[k] = { x: p.x, y: p.y, v: p.visibility ?? 1, z: p.z ?? 0 };
        }
      }
    } else if (this.mode === "mock") {
      raw = this.mockLandmarks(dtc);
    }

    this.frame = this.buildFrame(raw, dtc, nowMs);
    return this.frame;
  }

  buildFrame(raw, dt, nowMs) {
    const rect = this.rect;
    const pts = {};
    let scale = 0;

    if (raw) {
      // 归一化 → 屏幕坐标（镜像）
      for (const [k, p] of Object.entries(raw)) {
        pts[k] = {
          x: rect.x + (1 - p.x) * rect.w,
          y: rect.y + p.y * rect.h,
          v: p.v,
          nx: p.x,
          ny: p.y,
        };
      }

      // 指数平滑 + 速度
      for (const k of Object.keys(pts)) {
        const p = pts[k];
        const prev = this.smooth[k];
        const alpha = k === "rWri" || k === "lWri" ? 0.5 : 0.32;
        if (p.v < 0.35) {
          this.speed[k] = 0;
          continue;
        }
        if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > Math.max(this.W, this.H) * 0.4) {
          this.smooth[k] = { x: p.x, y: p.y };
          this.speed[k] = 0;
          continue;
        }
        const nx = prev.x + (p.x - prev.x) * alpha;
        const ny = prev.y + (p.y - prev.y) * alpha;
        const inst = Math.hypot(nx - prev.x, ny - prev.y) / dt;
        this.speed[k] = (this.speed[k] ?? 0) * 0.6 + inst * 0.4;
        this.smooth[k] = { x: nx, y: ny };
      }

      // 关键点输出（平滑后的位置 + 可见度）
      const sm = {};
      for (const k of Object.keys(pts)) {
        const s = this.smooth[k] ? { x: this.smooth[k].x, y: this.smooth[k].y, v: pts[k].v } : pts[k];
        sm[k] = s;
      }
      Object.assign(pts, sm);

      if (pts.lSho && pts.rSho && pts.lSho.v > 0.4 && pts.rSho.v > 0.4) {
        scale = Math.hypot(pts.lSho.x - pts.rSho.x, pts.lSho.y - pts.rSho.y);
      }
      if (scale < 20 && pts.lHip && pts.rHip) {
        scale = Math.hypot(pts.lHip.x - pts.rHip.x, pts.lHip.y - pts.rHip.y) * 1.35;
      }
    }

    const TORSO = ["nose", "lSho", "rSho", "lElb", "rElb", "lWri", "rWri", "lHip", "rHip"];
    const torsoPresent = TORSO.reduce((n, k) => n + (pts[k] && pts[k].v > 0.55 ? 1 : 0), 0) / TORSO.length;
    const feetVisible = !!(pts.lAnk && pts.rAnk && pts.lAnk.v > 0.4 && pts.rAnk.v > 0.4);
    // 只要上半身能看清就能玩：不强制全身，孩子不用退到看不见屏幕
    const ok = torsoPresent >= 0.68 && scale > 22;
    const present = torsoPresent;

    // 运动量：各活动点位移速度的平均值，按“身体宽度/秒”归一化
    let speedSum = 0, n = 0;
    for (const k of ACTIVITY) {
      if (this.speed[k] != null && pts[k] && pts[k].v > 0.45) {
        speedSum += this.speed[k];
        n++;
      }
    }
    const bwSpeed = scale > 10 ? speedSum / Math.max(1, n) / scale : 0;
    const motionTarget = 1 - Math.exp(-bwSpeed * 0.85);
    const prevMotion = this.frame?.motion ?? 0;
    const motion = prevMotion + (motionTarget - prevMotion) * (motionTarget > prevMotion ? 0.55 : 0.25);

    const bbox = this.bboxOf(pts);
    const hip = pts.lHip && pts.rHip && pts.lHip.v > 0.4 && pts.rHip.v > 0.4
      ? mid(pts.lHip, pts.rHip)
      : (pts.lSho && pts.rSho ? { x: mid(pts.lSho, pts.rSho).x, y: mid(pts.lSho, pts.rSho).y + scale * 1.2, v: 0 } : null);

    const frame = {
      t: nowMs / 1000,
      ok,
      present,
      pts,
      bodyScale: scale,
      motion,
      bwSpeed,
      bbox,
      hip,
      shoulder: pts.lSho && pts.rSho ? mid(pts.lSho, pts.rSho) : null,
      hands: [
        pts.lWri && pts.lWri.v > 0.45 ? pts.lWri : null,
        pts.rWri && pts.rWri.v > 0.45 ? pts.rWri : null,
      ],
      feet: [
        pts.lAnk && pts.lAnk.v > 0.4 ? pts.lAnk : null,
        pts.rAnk && pts.rAnk.v > 0.4 ? pts.rAnk : null,
      ],
      hasVideo: this.mode === "camera",
      fullBody: feetVisible,
      baseline: this.baseline,
    };

    // 校准：站定后取 1 秒的均值
    if (ok && !this.baseline) {
      this.calibBuffer.push({ x: hip.x, y: hip.y, s: scale, feet: (pts.lAnk?.y ?? 0 + (pts.rAnk?.y ?? 0)) / 2 });
      if (this.calibBuffer.length >= 30) {
        const b = this.calibBuffer;
        this.baseline = {
          hipX: b.reduce((a, c) => a + c.x, 0) / b.length,
          hipY: b.reduce((a, c) => a + c.y, 0) / b.length,
          scale: b.reduce((a, c) => a + c.s, 0) / b.length,
          ankleY: b.reduce((a, c) => a + (c.feet || 0), 0) / b.length,
        };
        frame.baseline = this.baseline;
      }
    }

    return frame;
  }

  bboxOf(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    for (const p of Object.values(pts)) {
      if (!p || p.v < 0.35) continue;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      n++;
    }
    return n ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  /* ---------- 无摄像头：鼠标小人 ---------- */
  mockLandmarks(dt) {
    const m = this.mock;
    m.t += dt;

    // 键盘左右倾
    const l = this.keys.has("a") || this.keys.has("arrowleft") ? -1 : 0;
    const r = this.keys.has("d") || this.keys.has("arrowright") ? 1 : 0;
    m.leanTarget = l + r;
    m.lean += (m.leanTarget - m.lean) * Math.min(1, dt * 9);

    // 跳跃
    if (m.jumping) {
      m.jump += m.jumpV * dt * 1.7;
      m.jumpV -= dt * 4.4;
      if (m.jump <= 0) { m.jump = 0; m.jumpV = 0; m.jumping = false; }
    }

    const W = this.W, H = this.H;
    const bs = Math.min(W, H) * 0.26;
    const cx = W * 0.5 + m.lean * bs * 0.55;
    const baseY = H * m.baseY - m.jump * bs * 0.55;

    const shoY = baseY - bs * 0.95;
    const hipY = baseY - bs * 0.5;
    const headY = shoY - bs * 0.36;

    const breath = Math.sin(m.t * 2.4) * bs * 0.012;
    const sway = Math.sin(m.t * 1.7) * bs * 0.02;

    // 右手跟随鼠标（映射成屏幕坐标）
    const handR = {
      x: clamp(this.pointer.x * W, 20, W - 20),
      y: clamp(this.pointer.y * H, 20, H - 20),
      v: 1,
    };
    const handL = {
      x: clamp(cx - bs * 0.75 + (handR.x - (cx - bs * 0.75)) * 0.06, 20, W - 20),
      y: clamp(shoY + bs * 0.45, 20, H - 20),
      v: 1,
    };

    // 屏幕坐标 → 归一化（镜像）
    const toNorm = (p) => ({ x: 1 - p.x / W, y: p.y / H, v: 1 });
    const P = (x, y) => toNorm({ x, y });

    return {
      nose: P(cx + sway, headY + breath),
      lSho: P(cx - bs * 0.34, shoY),
      rSho: P(cx + bs * 0.34, shoY),
      lElb: P((cx - bs * 0.34 + handL.x) / 2, (shoY + handL.y) / 2 + bs * 0.06),
      lWri: P(handL.x, handL.y),
      rElb: P((cx + bs * 0.34 + handR.x) / 2, (shoY + handR.y) / 2),
      rWri: P(handR.x, handR.y),
      lHip: P(cx - bs * 0.22, hipY),
      rHip: P(cx + bs * 0.22, hipY),
      lKne: P(cx - bs * 0.24 - m.jump * bs * 0.08, (hipY + baseY) / 2),
      rKne: P(cx + bs * 0.24 + m.jump * bs * 0.08, (hipY + baseY) / 2),
      lAnk: P(cx - bs * 0.26, baseY),
      rAnk: P(cx + bs * 0.26, baseY),
    };
  }
}
