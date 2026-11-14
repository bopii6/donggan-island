/* 游戏运行时：摄像头、姿态、HUD、倒计时、暂停、结算、换游戏
   整个游玩过程都在一页里完成：摄像头和模型只加载一次，换游戏、再来一局都不用重新等。 */

import { PoseTracker } from "./pose.js";
import { AudioKit, clamp, roundRect, pick } from "./kit.js";
import { addRecord, bestOf, getRecords } from "./store.js";
import { drawAvatar, drawSkeleton, PALETTES, standingJoints, fitScale } from "./avatar.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const params = new URLSearchParams(location.search);
const forceMock = params.get("mode") === "mouse";
const AUTO_HOLD = 1.6; // 站好不动多少秒自动开始

const CHEERS = ["太棒了！", "好厉害！", "就是这样！", "继续加油！", "真不错！", "你真棒！"];
const STAR_WORDS = ["第一颗星！", "第二颗星！", "三颗星，满分！"];

const INTENSITY = ["", "轻松", "出点汗", "出大汗"];

const STAR_SVG = (on) => `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 5l8.4 17.6 19.1 2.5-14 13.2 3.6 19L32 48.6 14.9 57.3l3.6-19-14-13.2 19.1-2.5z" fill="${on ? "#f9b233" : "#ded8c6"}" stroke="#10201b" stroke-width="4" stroke-linejoin="round"/></svg>`;

export class Runtime {
  /**
   * @param game 当前游戏模块
   * @param opts { getGame(id), suggest(currentId, playedIds) → 游戏数组, nextTitle, brand }
   *   入口脚本把自己的游戏表传进来，运行时本身不关心有哪些游戏
   */
  constructor(game, opts = {}) {
    this.game = game;
    this.opts = {
      getGame: opts.getGame || (() => null),
      suggest: opts.suggest || (() => []),
      nextTitle: opts.nextTitle || "接着玩",
      brand: opts.brand || "动感岛",
    };
    this.canvas = $("#scene");
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    this.video = $("#cam");
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.audio = new AudioKit();
    this.tracker = new PoseTracker(this.video, {
      width: this.W,
      height: this.H,
      quality: params.get("q") === "full" ? "full" : "lite",
    });

    this.state = "intro"; // intro | loading | setup | count | playing | paused | result
    this.elapsed = 0;
    this.lastTs = 0;
    this.shake = 0;
    this.frame = null;
    this.holdT = 0;
    this.score = 0;
    this.starsGot = 0;
    this.lastCheer = 0;
    this.muted = localStorage.getItem("qgd_muted") === "1";
    this.audio.setMuted(this.muted);

    this.resize();
    window.addEventListener("resize", () => this.resize());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state === "playing") this.pause();
    });
    window.addEventListener("pagehide", () => this.tracker.stop());
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || e.key === "p" || e.key === "P") {
        if (this.state === "playing") this.pause();
        else if (this.state === "paused") this.resume();
      }
      if (e.key === "Enter" && this.state === "setup") this.beginCountdown();
    });

    this.bindUI();
    this.applyGameChrome();
    this.showPanel("intro");
    if (forceMock) this.start(true);
  }

  get running() {
    return this.tracker.running && (this.tracker.mode === "camera" || this.tracker.mode === "mock");
  }

  /* ---------------- 画布 ---------------- */
  resize() {
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.width = this.W + "px";
    this.canvas.style.height = this.H + "px";
    this.tracker.resize(this.W, this.H);
  }

  /* ---------------- UI ---------------- */
  bindUI() {
    $("#btn-camera").addEventListener("click", () => {
      if (this.running) this.readyUp();
      else this.start(false);
    });
    $("#btn-mock").addEventListener("click", () => this.start(true));
    $("#btn-start").addEventListener("click", () => this.beginCountdown());
    $("#btn-mock2").addEventListener("click", () => {
      this.tracker.stop();
      this.tracker.startMock();
      this.hideSetupBar();
      this.showMockHint();
      this.beginCountdown();
    });
    $("#btn-pause").addEventListener("click", () => this.pause());
    $("#btn-resume").addEventListener("click", () => this.resume());
    $("#btn-quit").addEventListener("click", () => this.finish(true));
    $("#btn-again").addEventListener("click", () => this.again());
    $("#btn-sound").addEventListener("click", () => {
      this.muted = !this.muted;
      localStorage.setItem("qgd_muted", this.muted ? "1" : "0");
      this.audio.setMuted(this.muted);
      this.syncSoundBtn();
    });
    $("#next-games").addEventListener("click", (e) => {
      const b = e.target.closest("[data-game]");
      if (b) this.switchGame(b.dataset.game);
    });
    this.syncSoundBtn();
  }

  syncSoundBtn() {
    $("#btn-sound").classList.toggle("is-off", this.muted);
    $("#btn-sound").setAttribute("aria-pressed", String(!this.muted));
  }

  applyGameChrome() {
    const g = this.game;
    document.title = `${g.name} · ${this.opts.brand}`;
    document.documentElement.style.setProperty("--game", g.theme?.color || "#e2542f");
    document.documentElement.style.setProperty("--game-deep", g.theme?.deep || "#b93a1d");
    $("#hud-name").textContent = g.name;
    $("#hud-tag").textContent = g.tag;
    $("#score-unit").textContent = g.unit || "分";
    $("#intro-title").textContent = g.name;
    $("#intro-desc").textContent = g.tagline;
    $("#intro-desc").removeAttribute("style");
    $("#clock").hidden = !Number.isFinite(g.duration);
    $("#intro-chips").innerHTML = [
      `<span class="chip chip--game">${g.sense || "感统"}</span>`,
      `<span class="chip">${g.age} 岁</span>`,
      `<span class="chip">${g.durationLabel || `一局 ${g.duration} 秒`}</span>`,
      `<span class="chip">${INTENSITY[g.intensity || 2]}</span>`,
    ].join("");
    $("#intro-howto").innerHTML = g.howto.map((t) => `<li>${t}</li>`).join("");
    const best = bestOf(g.id);
    $("#intro-note").textContent = best
      ? `你的最好成绩：${best.score} ${g.unit || "分"}${"★".repeat(best.stars || 0)}。画面只在本机识别，不上传。`
      : "画面只在这台电脑上识别，不上传、不保存。";
    this.renderLives(g.lives || 0);
    this.renderStarbar();
    this.renderCover();
    this.syncIntroButtons();
  }

  syncIntroButtons() {
    const on = this.running;
    $("#btn-camera").textContent = on ? "开始游戏" : "打开摄像头，开始";
    $("#btn-mock").hidden = on;
  }

  renderLives(n) {
    const box = $("#lives");
    box.innerHTML = "";
    box.hidden = n <= 0;
    for (let i = 0; i < n; i++) {
      box.insertAdjacentHTML("beforeend",
        `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.7-9.3-9.2C1.3 8 3.4 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.6 0 5.7 3.5 4.3 7.3C19.5 16.3 12 21 12 21z" fill="#e2542f" stroke="#10201b" stroke-width="1.7" stroke-linejoin="round"/></svg>`);
    }
  }

  renderStarbar() {
    const th = this.game.stars || [1, 2, 3];
    const max = th[2];
    $$(".starbar__star").forEach((el, i) => {
      el.style.left = `${(th[i] / max) * 100}%`;
      el.innerHTML = STAR_SVG(false);
      el.classList.remove("is-on");
    });
    $("#starbar-fill").style.transform = "scaleX(0)";
  }

  renderCover() {
    const host = $("#intro-art");
    host.innerHTML = "";
    const c = document.createElement("canvas");
    const w = 640, h = 280;
    c.width = w * 2;
    c.height = h * 2;
    const ctx = c.getContext("2d");
    ctx.scale(2, 2);
    try { this.game.cover?.(ctx, w, h); } catch (e) { console.error(e); }
    host.appendChild(c);
  }

  showPanel(name, { clear = false } = {}) {
    const ov = $("#overlay");
    ov.classList.add("is-on");
    ov.classList.toggle("is-clear", clear);
    $$(".panel", ov).forEach((p) => p.classList.toggle("is-active", p.dataset.panel === name));
    ov.scrollTop = 0;
  }

  hideOverlay() {
    $("#overlay").classList.remove("is-on");
  }

  say(text, { alert = false, speak = true, ms = 0 } = {}) {
    const el = $("#subtitle");
    el.textContent = text;
    el.classList.toggle("is-alert", alert);
    el.classList.add("is-on");
    if (speak) this.audio.speak(text);
    clearTimeout(this._sayTimer);
    this._sayTimer = setTimeout(() => el.classList.remove("is-on"), ms || Math.max(1400, text.length * 260));
  }

  /** 夸一句（有冷却，不会唠叨） */
  cheer(text) {
    const now = performance.now();
    if (now - this.lastCheer < 3500) return;
    this.lastCheer = now;
    this.say(text || pick(CHEERS), { ms: 1300 });
  }

  /* ---------------- 流程 ---------------- */
  async start(useMock) {
    this.audio.unlock();
    this.state = "loading";
    this.showPanel("loading");
    const txt = $("#loading-text");

    try {
      if (useMock) {
        txt.textContent = "正在准备鼠标小人…";
        this.tracker.startMock();
        this.showMockHint();
        this.syncIntroButtons();
        this.beginCountdown();
        return;
      }
      txt.textContent = "正在打开摄像头…（浏览器可能会问是否允许）";
      await this.tracker.startCamera();
      txt.textContent = "正在加载动作识别，大约 3 秒…";
      await this.tracker.loadModel();
      this.syncIntroButtons();
      this.enterSetup();
    } catch (e) {
      console.error(e);
      this.state = "intro";
      this.showPanel("intro");
      const d = $("#intro-desc");
      d.textContent = `没能打开摄像头：${e.message || e}。可以检查浏览器地址栏的摄像头权限，或者先用鼠标试玩。`;
      d.style.color = "#b93a1d";
      d.style.fontWeight = "700";
    }
  }

  /** 摄像头已经开着：直接进站位（人已经站好的话一眨眼就开始） */
  readyUp() {
    this.audio.unlock();
    if (this.tracker.mode === "mock") this.beginCountdown();
    else this.enterSetup();
  }

  showMockHint() {
    if (document.getElementById("mock-hint")) return;
    const el = document.createElement("div");
    el.id = "mock-hint";
    el.className = "mock-hint";
    el.innerHTML = `<b>鼠标模式</b><span>移动鼠标＝挥手 · 空格＝跳 · S＝蹲 · A/D＝左右 · 按住 Shift 只动一只手</span>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("is-out"), 9000);
    setTimeout(() => el.remove(), 11500);
  }

  /* 站位模式：不挡画面，让孩子一边看自己一边站进去；站稳 1.6 秒自动开始 */
  enterSetup() {
    this.state = "setup";
    this.hideOverlay();
    $("#setupbar").hidden = false;
    $("#btn-mock2").hidden = true;
    $("#hud").classList.add("is-dim");
    this.holdT = 0;
    this.setupOk = false;
    this._setupAt = performance.now();
    this._sawBody = false;
    this.setSetupStatus(false, "站到电脑前 1～2 米", "让头和肩膀进画面就行，不用退很远");
  }

  hideSetupBar() {
    $("#setupbar").hidden = true;
    $("#hud").classList.remove("is-dim");
  }

  setSetupStatus(ok, title, hint) {
    const bar = $("#setupbar");
    bar.classList.toggle("is-ok", ok);
    if (title && this._setupTitle !== title) {
      this._setupTitle = title;
      $("#setup-title").textContent = title;
    }
    if (hint && this._setupHint !== hint) {
      this._setupHint = hint;
      $("#setup-hint").textContent = hint;
    }
    $("#btn-start").classList.toggle("is-ready", ok);
  }

  updateSetup(f, dt) {
    const chips = $$("#setup-checks li");
    const mark = (key, state) => {
      const el = chips.find((c) => c.dataset.check === key);
      if (!el) return;
      el.classList.toggle("ok", state === "ok");
      el.classList.toggle("bad", state === "bad");
    };

    let bodyOk = false, title, hint;
    if (!f) {
      mark("body", "bad"); mark("light", "bad"); mark("space", "bad");
      title = "还没看到你";
      hint = "站到电脑前 1～2 米，让头和肩膀进画面";
    } else {
      const hRatio = f.bbox ? f.bbox.h / this.H : 0;
      const headUp = !!(f.pts?.nose && f.pts.nose.v > 0.4);
      const handsOk = !this.game.needsHands ||
        !!(f.pts?.lWri && f.pts?.rWri && f.pts.lWri.v > 0.35 && f.pts.rWri.v > 0.35);
      const tooClose = (f.bodyScale || 0) / this.W > 0.52;
      bodyOk = !!f.ok && headUp && handsOk && !tooClose && hRatio > 0.24;
      const lightOk = (this.luma ?? 0) > 52;
      const spaceOk = !!f.bbox && f.bbox.x > 0 && f.bbox.x + f.bbox.w < this.W;

      mark("body", bodyOk ? "ok" : "bad");
      mark("light", lightOk ? "ok" : "bad");
      mark("space", spaceOk ? "ok" : "bad");

      title = "站好别动，马上开始";
      hint = "三、二、一，跟着屏幕里的口令动起来";
      if (!f.ok) {
        title = "还没看到你";
        hint = "站到电脑前 1～2 米，让头和肩膀进画面";
      } else if (!headUp) {
        title = "头没进画面";
        hint = "把电脑屏幕往上抬一点，或者后退半步";
      } else if (!handsOk) {
        title = "看不见你的手";
        hint = "把手抬到胸前，左右手都露出来";
      } else if (tooClose) {
        title = "太近了";
        hint = "后退半步，让肩膀别占满整个屏幕";
      } else if (!lightOk) {
        title = "站好了，光线有点暗";
        hint = "开一盏灯或者面朝窗户，会认得更准";
      } else if (!spaceOk) {
        title = "站好了，再往中间一点";
        hint = "左右留点空间，挥手不会出画面";
      }
    }

    this.setupOk = bodyOk;
    this.holdT = bodyOk ? this.holdT + dt : Math.max(0, this.holdT - dt * 2);
    $("#btn-start").style.setProperty("--hold", (clamp(this.holdT / AUTO_HOLD, 0, 1) * 100).toFixed(1) + "%");
    if (bodyOk) this._sawBody = true;

    // 8 秒都没见到人：给一条退路，别让人卡在这一屏
    if (!this._sawBody && performance.now() - (this._setupAt || 0) > 8000) {
      $("#btn-mock2").hidden = false;
    }
    this.setSetupStatus(bodyOk, title, hint);
    if (this.holdT >= AUTO_HOLD) this.beginCountdown();
  }

  /* ---------------- 站位画面 ---------------- */
  setupFrame() {
    const m = Math.round(Math.min(this.W, this.H) * 0.055);
    return { x: m, y: Math.max(m, 86), w: this.W - m * 2, h: this.H - Math.max(m, 86) - m - 104 };
  }

  drawSetup(ctx, f) {
    const { W, H } = this;
    const ok = !!this.setupOk;

    const hasCam = this.camera(1, "saturate(0.95) brightness(0.97)");
    if (!hasCam) this.drawThemeBg(ctx);

    const g = ctx.createLinearGradient(0, H * 0.62, 0, H);
    g.addColorStop(0, "rgba(8,18,15,0)");
    g.addColorStop(1, "rgba(8,18,15,0.66)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const fr = this.setupFrame();
    const col = ok ? "#48e08a" : "rgba(255,250,240,0.72)";
    this.drawBrackets(ctx, fr.x, fr.y, fr.w, fr.h, col);

    const ankles = f && f.pts ? [f.pts.lAnk, f.pts.rAnk] : null;
    const hasFeet = ankles && ankles[0] && ankles[1] && ankles[0].v > 0.3 && ankles[1].v > 0.3;
    const showPad = !ok || hasFeet;
    const padX = ok && hasFeet ? (ankles[0].x + ankles[1].x) / 2 : W / 2;
    const padY = ok && hasFeet ? Math.max(ankles[0].y, ankles[1].y) + 6 : H * 0.82;
    const rx = Math.min(W, H) * (ok ? 0.14 : 0.2);
    const ry = rx * (ok ? 0.24 : 0.3);
    if (showPad) {
      ctx.save();
      ctx.strokeStyle = ok ? "#48e08a" : "rgba(255,250,240,0.75)";
      ctx.lineWidth = 3;
      ctx.setLineDash([18, 14]);
      ctx.lineDashOffset = -performance.now() / 55;
      ctx.beginPath();
      ctx.ellipse(padX, padY, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (f && f.ok) {
      drawSkeleton(ctx, f.pts, ok ? "#48e08a" : "#ffd166");
      const head = f.pts.nose || f.pts.lSho;
      if (head && f.bodyScale) {
        // 头上一圈进度环：站稳了就转满，转满自动开始
        const r = Math.max(26, f.bodyScale * 0.32);
        ctx.save();
        ctx.lineWidth = 5;
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.beginPath();
        ctx.arc(head.x, head.y, r, 0, Math.PI * 2);
        ctx.stroke();
        if (ok) {
          ctx.strokeStyle = "#48e08a";
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.arc(head.x, head.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(this.holdT / AUTO_HOLD, 0, 1));
          ctx.stroke();
        }
        ctx.restore();
      }
    } else {
      const ghost = standingJoints(W / 2, H * 0.82, Math.min(H * 0.5, W * 0.55));
      drawAvatar(ctx, ghost, { palette: { ...PALETTES.chalk, shirt: "#ffffff" }, alpha: 0.34, showFace: false, inkW: 5 });
    }

    ctx.save();
    ctx.font = '800 14px "MiSans","PingFang SC","Microsoft YaHei",sans-serif';
    const label = ok ? "已识别到你，站稳别动" : "把自己放进取景框";
    const tw = ctx.measureText(label).width;
    roundRect(ctx, W / 2 - tw / 2 - 16, fr.y + 14, tw + 32, 32, 16);
    ctx.fillStyle = ok ? "rgba(72,224,138,0.95)" : "rgba(16,32,27,0.66)";
    ctx.fill();
    ctx.fillStyle = ok ? "#08301d" : "#fffaf0";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, W / 2, fr.y + 30);
    ctx.restore();
  }

  drawBrackets(ctx, x, y, w, h, color) {
    const len = Math.min(w, h) * 0.08;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * len, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* 没在玩的时候（介绍、倒计时、结算）：摄像头画面或主题色背景 + 自己的小人，画面一直是活的 */
  drawThemeBg(ctx) {
    const { W, H } = this;
    const [a, b] = this.game.theme?.bg || ["#22303f", "#0d151d"];
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  drawIdle(ctx) {
    const { W, H } = this;
    const hasCam = this.camera(1, "saturate(0.85)");
    if (!hasCam) this.drawThemeBg(ctx);
    const f = this.frame;
    if (f && f.ok) {
      const k = fitScale(f.bodyScale, H, 0.66);
      ctx.save();
      if (k < 0.99 && f.hip) {
        ctx.translate(f.hip.x, f.hip.y);
        ctx.scale(k, k);
        ctx.translate(-f.hip.x, -f.hip.y);
      }
      drawAvatar(ctx, f.pts, { palette: this.game.palette || PALETTES.sunset, alpha: 0.95, inkW: Math.max(3, f.bodyScale * 0.045) });
      ctx.restore();
    }
    if (this.state === "count") {
      ctx.fillStyle = "rgba(8,18,15,0.25)";
      ctx.fillRect(0, 0, W, H);
    }
  }

  beginCountdown() {
    if (this.state === "count" || this.state === "playing") return;
    this.state = "count";
    this.elapsed = 0;
    this.score = 0;
    this.starsGot = 0;
    this.renderStarbar();
    this.renderLives(this.game.lives || 0);
    $("#score").textContent = "0";
    const box = $("#countdown");
    const num = $("#countdown-num");
    box.classList.add("is-on");
    this.hideSetupBar();
    this.hideOverlay();
    $("#hud").classList.remove("is-dim");

    const steps = ["3", "2", "1", "开始"];
    const voice = ["三", "二", "一", "开始！"];
    let i = 0;
    const tick = () => {
      if (this.state !== "count") { box.classList.remove("is-on", "is-tick"); return; }
      if (i >= steps.length) {
        box.classList.remove("is-on", "is-tick");
        this.state = "playing";
        this.elapsed = 0;
        this.game.start?.(this);
        return;
      }
      num.textContent = steps[i];
      box.classList.toggle("is-go", i === steps.length - 1);
      box.classList.remove("is-tick");
      void box.offsetWidth;
      box.classList.add("is-tick");
      this.audio.sfx(i === steps.length - 1 ? "go" : "count");
      this.audio.speak(voice[i], { rate: 1.15 });
      i++;
      setTimeout(tick, i === steps.length ? 620 : 750);
    };
    tick();
  }

  async again() {
    this.elapsed = 0;
    if (this.tracker.mode === "camera" && !this.tracker.stream) {
      this.state = "loading";
      this.showPanel("loading");
      $("#loading-text").textContent = "正在打开摄像头…";
      try {
        await this.tracker.startCamera();
      } catch (e) {
        this.state = "intro";
        this.showPanel("intro");
        return;
      }
    } else if (this.tracker.mode === "mock" && !this.tracker.running) {
      this.tracker.startMock();
    }
    // 人还在画面里就直接倒计时，否则先站位
    if (this.tracker.mode === "camera" && !(this.frame && this.frame.ok)) this.enterSetup();
    else this.beginCountdown();
  }

  switchGame(id) {
    const g = this.opts.getGame(id);
    if (!g || this.state === "playing" || this.state === "count") return;
    this.game = g;
    const q = new URLSearchParams(location.search);
    q.set("game", g.id);
    history.replaceState(null, "", `${location.pathname}?${q}`);
    this.state = "intro";
    this.applyGameChrome();
    this.showPanel("intro");
  }

  pause() {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.game.pause?.(this);
    this.showPanel("pause");
    $("#hud").classList.add("is-dim");
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "playing";
    this.hideOverlay();
    $("#hud").classList.remove("is-dim");
    this.game.resume?.(this);
  }

  starsFor(score) {
    const th = this.game.stars || [1, 2, 3];
    return th.filter((t) => score >= t).length;
  }

  finish(quit = false) {
    if (this.state === "result") return;
    const wasPlaying = this.state === "playing" || this.state === "paused";
    this.state = "result";
    const report = this.game.finish ? this.game.finish(this, quit) : { score: 0 };
    // 完整玩完至少给一颗星：鼓励优先
    const earned = this.starsFor(report.score ?? 0);
    report.stars = quit ? earned : Math.max(1, earned);
    $("#hud").classList.remove("is-dim");
    this.renderResult(report, quit && !wasPlaying, quit);
  }

  renderResult(r, aborted, quit) {
    const g = this.game;
    const mood = r.stars >= 3 ? "太厉害了！" : r.stars === 2 ? "很不错！" : "完成啦";
    $("#result-kicker").textContent = `${g.name} · ${quit ? "中途结束" : "本局完成"}`;
    $("#result-title").textContent = r.headline || mood;
    $("#result-desc").textContent = r.desc || "";
    $("#result-score").textContent = r.score ?? 0;
    $("#result-unit").textContent = g.unit || "分";

    const starBox = $("#result-stars");
    starBox.innerHTML = "";
    for (let i = 0; i < 3; i++) {
      starBox.insertAdjacentHTML("beforeend", `<span class="star ${i < r.stars ? "on" : ""}">${STAR_SVG(i < r.stars)}</span>`);
    }
    $$(".star.on", starBox).forEach((s, i) => {
      setTimeout(() => {
        s.classList.add("in");
        this.audio.sfx("star");
      }, 220 + i * 280);
    });

    $("#result-metrics").innerHTML = (r.rows || [])
      .map((row) => `<li><span>${row.label}</span><b>${row.value}</b></li>`).join("");
    $("#sensory-rows").innerHTML = (r.sensory || [])
      .map((s) => `
        <div class="sensory__row">
          <div class="sensory__label"><span>${s.label}</span><span>${Math.round(s.value * 100)}%</span></div>
          <div class="sensory__track"><div class="sensory__fill" data-w="${s.value}"></div></div>
        </div>`).join("");
    $("#result-tip").textContent = r.tip || "";
    setTimeout(() => {
      $$("#sensory-rows .sensory__fill").forEach((f) => {
        f.style.width = Math.round(Number(f.dataset.w) * 100) + "%";
      });
    }, 300);

    let rec = null;
    const prev = bestOf(g.id);
    if (!aborted && !quit) {
      rec = addRecord({
        ts: Date.now(),
        game: g.id,
        name: g.name,
        score: r.score ?? 0,
        stars: r.stars ?? 0,
        duration: Math.round(Number.isFinite(g.duration) ? Math.min(this.elapsed, g.duration) : this.elapsed),
        rows: r.rows || [],
      });
    }
    const ribbon = $("#result-record");
    ribbon.hidden = !(rec && rec.isBest);
    const bestTxt = $("#result-best");
    if (rec && rec.isBest) bestTxt.textContent = `上次最好 ${prev.score}`;
    else if (prev) bestTxt.textContent = `最好成绩 ${Math.max(prev.score, r.score ?? 0)}`;
    else bestTxt.textContent = rec ? "第一次玩，记下来啦" : "";

    // 接着玩：推荐 3 个
    const played = new Set(getRecords().map((x) => x.game));
    const list = this.opts.suggest(g.id, played, 3);
    document.querySelector(".next h3").textContent = this.opts.nextTitle;
    document.querySelector(".next").hidden = !list.length;
    $("#next-games").innerHTML = list.map((n) => {
      const b = bestOf(n.id);
      return `
        <button class="next-card" data-game="${n.id}" style="--c:${n.theme?.color || "#e2542f"}">
          <span class="next-card__art" data-cover="${n.id}"></span>
          <span class="next-card__txt"><b>${n.name}</b><small>${n.cardNote || n.sense} · ${b ? "★".repeat(b.stars) + "☆".repeat(3 - b.stars) : n.isNew ? "新游戏" : "还没玩过"}</small></span>
        </button>`;
    }).join("");
    $$("#next-games [data-cover]").forEach((el) => {
      const ng = this.opts.getGame(el.dataset.cover);
      const c = document.createElement("canvas");
      c.width = 480; c.height = 300;
      const cx = c.getContext("2d");
      cx.scale(2, 2);
      try { ng.cover(cx, 240, 150); } catch { /* ignore */ }
      el.appendChild(c);
    });

    this.showPanel("result");
    if (!quit) {
      this.audio.sfx("win");
      if (rec && rec.isBest) setTimeout(() => this.say("新纪录！", { ms: 1500 }), 900);
      else if (r.stars >= 3) setTimeout(() => this.say("三颗星，太厉害了！", { ms: 1600 }), 900);
    }
  }

  /* ---------------- 主循环 ---------------- */
  loop = (ts) => {
    const last = this.lastTs || ts;
    const dtRaw = (ts - last) / 1000;
    this.lastTs = ts;
    const dt = clamp(dtRaw, 0.001, 0.05);

    this.frame = this.tracker.update(ts, dtRaw);

    if (this.state === "playing") {
      this.elapsed += dt;
      if (this.elapsed >= this.game.duration) { // duration 为 Infinity 时由游戏自己调用 finish()
        this.finish();
      } else {
        this.game.update?.(dt, this.frame, this);
        if (this.state === "playing" && this.elapsed >= this.game.duration) this.finish();
      }
    }

    if (this.state === "setup") this.updateSetup(this.frame, dt);
    if (this.tracker.mode === "camera") this.sampleLuma();

    if (this.state === "playing" && this.luma && this.luma < 42) {
      const now = performance.now();
      if (now - (this._darkWarnAt || 0) > 15000) {
        this._darkWarnAt = now;
        this.say("房间有点暗，开一盏灯会更容易看见你", { speak: false, ms: 3600 });
      }
    }

    this.draw(dt);
    requestAnimationFrame(this.loop);
  };

  sampleLuma() {
    const now = performance.now();
    if (now - (this._lumaTs || 0) < 400) return;
    this._lumaTs = now;
    if (!this._lumaCanvas) {
      this._lumaCanvas = document.createElement("canvas");
      this._lumaCanvas.width = 32;
      this._lumaCanvas.height = 18;
      this._lumaCtx = this._lumaCanvas.getContext("2d", { willReadFrequently: true });
    }
    try {
      this._lumaCtx.drawImage(this.video, 0, 0, 32, 18);
      const d = this._lumaCtx.getImageData(0, 0, 32, 18).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      this.luma = sum / (d.length / 4);
    } catch { /* 忽略 */ }
  }

  draw(dt) {
    const { ctx, W, H, dpr } = this;
    if (!W || !H) return; // 窗口被最小化成 0 尺寸时什么都不画
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    let ox = 0, oy = 0;
    if (this.shake > 0.01) {
      ox = (Math.random() - 0.5) * this.shake;
      oy = (Math.random() - 0.5) * this.shake;
      this.shake *= Math.pow(0.001, dt);
      if (this.shake < 0.1) this.shake = 0;
    }

    ctx.save();
    ctx.translate(ox, oy);
    if (this.state === "setup") this.drawSetup(ctx, this.frame);
    else if (this.state === "playing" || this.state === "paused") this.game.draw?.(ctx, this);
    else this.drawIdle(ctx);
    ctx.restore();

    if (this._flash) {
      ctx.save();
      ctx.globalAlpha = this._flash.alpha;
      ctx.fillStyle = this._flash.color;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      this._flash.alpha *= Math.pow(0.002, dt);
      if (this._flash.alpha < 0.02) this._flash = null;
    }

    this.syncHud();
  }

  syncHud() {
    const g = this.game;
    if (this._score !== this.score) {
      this._score = this.score;
      $("#score").textContent = this.score ?? 0;
      const th = g.stars || [1, 2, 3];
      const p = clamp((this.score || 0) / th[2], 0, 1);
      $("#starbar-fill").style.transform = `scaleX(${p})`;
      $("#starbar").setAttribute("aria-valuenow", String(Math.round(p * 100)));
      if (this.state === "playing") {
        const got = this.starsFor(this.score || 0);
        while (this.starsGot < got) {
          const i = this.starsGot++;
          const el = $$(".starbar__star")[i];
          if (el) {
            el.innerHTML = STAR_SVG(true);
            el.classList.add("is-on");
          }
          this.audio.sfx("sparkle");
          this.toast(STAR_WORDS[i]);
        }
      }
    }
    if (!Number.isFinite(g.duration)) return;
    const left = Math.max(0, g.duration - (this.state === "playing" || this.state === "paused" ? this.elapsed : 0));
    const sec = Math.ceil(left);
    if (sec !== this._left) {
      this._left = sec;
      $("#timer-num").textContent = sec;
      $("#clock-ring").style.strokeDashoffset = String(100 - clamp(left / g.duration, 0, 1) * 100);
      $("#clock").classList.toggle("is-low", left <= 10 && this.state === "playing");
      if (this.state === "playing" && sec <= 5 && sec > 0) this.audio.sfx("tick");
    }
  }

  toast(text) {
    const el = $("#star-toast");
    el.innerHTML = `${STAR_SVG(true)}<span>${text}</span>`;
    el.classList.remove("is-on");
    void el.offsetWidth;
    el.classList.add("is-on");
    this.audio.speak(text);
  }

  /* ---------------- 给游戏用的工具 ---------------- */
  setScore(n) {
    this.score = Math.round(n);
    const box = $(".score-box");
    box.classList.remove("is-pop");
    void box.offsetWidth;
    box.classList.add("is-pop");
  }

  setLives(n) {
    $$("#lives svg").forEach((s, i) => s.classList.toggle("is-lost", i >= n));
  }

  camera(alpha = 1, filter = "none") {
    const { ctx, tracker } = this;
    if (!tracker.stream || !tracker.videoSize.w) return false;
    const r = tracker.rect;
    const luma = this.luma ?? 90;
    const boost = luma < 80 ? clamp(1 + ((80 - luma) / 80) * 1.2, 1, 2.2) : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.filter = boost > 1.03 ? `${filter} brightness(${boost.toFixed(2)})` : filter;
    // 镜像：和关键点的镜像坐标保持一致
    ctx.translate(this.W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(tracker.video, this.W - r.x - r.w, r.y, r.w, r.h);
    ctx.restore();
    return true;
  }

  kick(power = 12) { this.shake = power; }

  flash(color = "#fff", alpha = 0.6) {
    this._flash = { color, alpha };
  }
}
