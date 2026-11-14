/* 游戏运行时：摄像头、姿态、HUD、倒计时、暂停、结算 */

import { PoseTracker } from "./pose.js";
import { AudioKit, Music, clamp, roundRect } from "./kit.js";
import { GAMES, getGame } from "./games/index.js";
import { addRecord, playCount } from "./store.js";
import { drawAvatar, drawSkeleton, PALETTES, standingJoints } from "./avatar.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const params = new URLSearchParams(location.search);
const gameId = params.get("game") || "freeze";
const forceMock = params.get("mode") === "mouse";

const game = getGame(gameId);

class Runtime {
  constructor() {
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

    this.state = "intro"; // intro | loading | ready | count | playing | paused | result
    this.elapsed = 0;
    this.lastTs = 0;
    this.shake = 0;
    this._flash = null;
    this.muted = localStorage.getItem("qgd_muted") === "1";
    this.audio.setMuted(this.muted);
    this.frame = null;
    this.readySince = 0;
    this.started = false;

    this.resize();
    window.addEventListener("resize", () => this.resize());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state === "playing") this.pause();
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || e.key === "p" || e.key === "P") {
        if (this.state === "playing") this.pause();
        else if (this.state === "paused") this.resume();
      }
    });

    this.bindUI();
    this.applyGameChrome();
    this.showPanel("intro");
    if (forceMock) this.start(true);
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
    $("#btn-camera").addEventListener("click", () => this.start(false));
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
      $("#btn-sound").classList.toggle("is-off", this.muted);
      $("#btn-sound").setAttribute("aria-pressed", String(!this.muted));
    });
    $("#btn-sound").classList.toggle("is-off", this.muted);
    $("#btn-sound").setAttribute("aria-pressed", String(!this.muted));
  }

  applyGameChrome() {
    document.title = `${game.name} · 动感岛`;
    $("#hud-name").textContent = game.name;
    $("#hud-tag").textContent = game.tag;
    $("#score-unit").textContent = game.unit || "分";
    $("#intro-title").textContent = game.name;
    $("#intro-desc").textContent = game.tagline;
    $("#intro-kicker").textContent = `${game.age} 岁 · 一局 ${game.duration} 秒`;
    $("#intro-howto").innerHTML = game.howto.map((t) => `<li>${t}</li>`).join("");
    this.renderLives(game.lives);
    this.renderCover();
  }

  renderLives(n) {
    const box = $("#lives");
    box.innerHTML = "";
    for (let i = 0; i < n; i++) {
      box.insertAdjacentHTML("beforeend",
        `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.7-9.3-9.2C1.3 8 3.4 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.6 0 5.7 3.5 4.3 7.3C19.5 16.3 12 21 12 21z" fill="#e2542f" stroke="#10201b" stroke-width="1.7" stroke-linejoin="round"/></svg>`);
    }
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
    if (game.cover) game.cover(ctx, w, h);
    host.appendChild(c);
  }

  showPanel(name, { clear = false } = {}) {
    const ov = $("#overlay");
    ov.classList.add("is-on");
    ov.classList.toggle("is-clear", clear);
    $$(".panel", ov).forEach((p) => p.classList.toggle("is-active", p.dataset.panel === name));
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
        this.beginCountdown();
        return;
      }
      txt.textContent = "正在打开摄像头…（浏览器可能会问是否允许）";
      await this.tracker.startCamera();
      txt.textContent = "正在加载动作识别，大约 3 秒…";
      await this.tracker.loadModel();
      this.enterSetup();
    } catch (e) {
      console.error(e);
      this.state = "intro";
      this.showPanel("intro");
      const d = $("#intro-desc");
      d.textContent = `没能打开摄像头：${e.message || e}。可以检查权限，或者先用鼠标试玩。`;
      d.style.color = "#b93a1d";
      d.style.fontWeight = "700";
    }
  }

  showMockHint() {
    if (document.getElementById("mock-hint")) return;
    const el = document.createElement("div");
    el.id = "mock-hint";
    el.className = "mock-hint";
    el.innerHTML = `<b>鼠标模式</b><span>移动鼠标＝挥手 · A / D＝左右 · 空格＝跳</span>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("is-out"), 9000);
    setTimeout(() => el.remove(), 11500);
  }

  /* 站位模式：不挡画面，让孩子一边看自己一边站进去 */
  enterSetup() {
    this.state = "setup";
    this.hideOverlay();
    $("#setupbar").hidden = false;
    $("#btn-mock2").hidden = true;
    $("#hud").classList.add("is-dim");
    this.readySince = 0;
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

  updateSetup(f) {
    const chips = $$("#setup-checks li");
    const mark = (key, state) => {
      const el = chips.find((c) => c.dataset.check === key);
      if (!el) return;
      el.classList.toggle("ok", state === "ok");
      el.classList.toggle("bad", state === "bad");
    };

    if (!f) {
      mark("body", "bad"); mark("light", "bad"); mark("space", "bad");
      this.setupOk = false;
      this.setSetupStatus(false, "还没看到你", "站到电脑前 1～2 米，让头和肩膀进画面");
      return;
    }

    const hRatio = f.bbox ? f.bbox.h / this.H : 0;
    const headUp = !!(f.pts?.nose && f.pts.nose.v > 0.4);
    const handsOk = !game.needsHands ||
      !!(f.pts?.lWri && f.pts?.rWri && f.pts.lWri.v > 0.35 && f.pts.rWri.v > 0.35);
    const tooClose = (f.bodyScale || 0) / this.W > 0.52;
    const bodyOk = !!f.ok && headUp && handsOk && !tooClose && hRatio > 0.24;
    const lightOk = (this.luma ?? 0) > 52;
    const spaceOk = !!f.bbox && f.bbox.x > 0 && f.bbox.x + f.bbox.w < this.W;

    mark("body", bodyOk ? "ok" : "bad");
    mark("light", lightOk ? "ok" : "bad");
    mark("space", spaceOk ? "ok" : "bad");

    let title = "站好了，开始吧";
    let hint = "三、二、一，跟着屏幕里的口令动起来";
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
      title = "光线有点暗";
      hint = "开一盏灯，或者面朝窗户站";
    } else if (!spaceOk) {
      title = "站得偏了一点";
      hint = "往中间挪一步，左右留点空间";
    }

    this.setupOk = bodyOk;
    this.readySince = bodyOk ? this.readySince + 1 / 60 : 0;
    if (bodyOk) this._sawBody = true;

    // 8 秒都没见到人：给一条退路，别让人卡在这一屏
    if (!this._sawBody && performance.now() - (this._setupAt || 0) > 8000) {
      $("#btn-mock2").hidden = false;
    }
    this.setSetupStatus(bodyOk, title, hint);
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
    if (!hasCam) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#22303f");
      g.addColorStop(1, "#0d151d");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        ctx.beginPath();
        ctx.moveTo((W * i) / 10, H * 0.6);
        ctx.lineTo((W * i) / 10 - W * 0.15, H);
        ctx.stroke();
      }
    }

    // 底部压暗，保证提示条能看清
    const g = ctx.createLinearGradient(0, H * 0.62, 0, H);
    g.addColorStop(0, "rgba(8,18,15,0)");
    g.addColorStop(1, "rgba(8,18,15,0.66)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 取景括号
    const fr = this.setupFrame();
    const col = ok ? "#48e08a" : "rgba(255,250,240,0.72)";
    this.drawBrackets(ctx, fr.x, fr.y, fr.w, fr.h, col);

    // 地面圆圈：看得见脚才画在脚下，全身没进画面就不硬要求站位
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
      ctx.setLineDash([]);
      if (!ok) {
        ctx.globalAlpha = 0.9;
        for (const dx of [-rx * 0.32, rx * 0.32]) {
          ctx.beginPath();
          ctx.ellipse(padX + dx, padY, rx * 0.1, ry * 0.34, 0, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,250,240,0.35)";
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // 站位时画细骨架就好：贴得近也不会挡住你
    if (f && f.ok) {
      drawSkeleton(ctx, f.pts, ok ? "#48e08a" : "#ffd166");
      if (f.bodyScale) {
        const head = f.pts.nose || f.pts.lSho;
        if (head) {
          ctx.save();
          ctx.strokeStyle = ok ? "rgba(72,224,138,0.85)" : "rgba(255,209,102,0.85)";
          ctx.lineWidth = 3;
          const r = Math.max(26, f.bodyScale * 0.32);
          ctx.beginPath();
          ctx.arc(head.x, head.y, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    } else {
      const ghost = standingJoints(W / 2, H * 0.82, Math.min(H * 0.5, W * 0.55));
      drawAvatar(ctx, ghost, { palette: { ...PALETTES.chalk, shirt: "#ffffff" }, alpha: 0.34, showFace: false, inkW: 5 });
    }

    // 取景框顶部的小标签
    ctx.save();
    ctx.font = '800 13px "MiSans","PingFang SC","Microsoft YaHei",sans-serif';
    const label = ok ? "已识别到你" : "把整个人放进取景框";
    const tw = ctx.measureText(label).width;
    ctx.globalAlpha = 0.9;
    roundRect(ctx, W / 2 - tw / 2 - 16, fr.y + 14, tw + 32, 30, 15);
    ctx.fillStyle = ok ? "rgba(72,224,138,0.92)" : "rgba(16,32,27,0.62)";
    ctx.fill();
    ctx.fillStyle = ok ? "#08301d" : "#fffaf0";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, W / 2, fr.y + 29);
    ctx.restore();
  }

  drawBrackets(ctx, x, y, w, h, color) {
    const len = Math.min(w, h) * 0.08;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    const corners = [
      [x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * len, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  ghostPose(cx, feetY, hgt) {
    return standingJoints(cx, feetY, hgt);
  }

  beginCountdown() {
    if (this.state === "count") return;
    this.state = "count";
    this.elapsed = 0;
    this.started = false;
    const box = $("#countdown");
    const num = $("#countdown-num");
    box.classList.add("is-on");
    this.hideSetupBar();
    this.hideOverlay();
    $("#hud").classList.remove("is-dim");

    const steps = ["3", "2", "1", "Go!"];
    let i = 0;
    const tick = () => {
      if (i >= steps.length) {
        box.classList.remove("is-on", "is-tick");
        this.state = "playing";
        this.started = true;
        this.elapsed = 0;
        game.start?.(this);
        return;
      }
      num.textContent = steps[i];
      box.classList.remove("is-tick");
      void box.offsetWidth;
      box.classList.add("is-tick");
      this.audio.sfx(i === steps.length - 1 ? "go" : "count");
      i++;
      setTimeout(tick, i === steps.length ? 620 : 700);
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
    } else if (this.tracker.mode === "mock") {
      this.tracker.startMock();
    }
    this.beginCountdown();
  }

  pause() {
    if (this.state !== "playing") return;
    this.state = "paused";
    game.pause?.();
    this.showPanel("pause");
    $("#hud").classList.add("is-dim");
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "playing";
    $("#overlay").classList.remove("is-on");
    $("#hud").classList.remove("is-dim");
    game.resume?.();
  }

  finish(quit = false) {
    if (this.state === "result") return;
    const wasPlaying = this.state === "playing" || this.state === "paused";
    this.state = "result";
    const report = game.finish ? game.finish(this, quit) : { score: 0, stars: 1 };
    $("#hud").classList.remove("is-dim");
    this.renderResult(report, quit && !wasPlaying);
  }

  renderResult(r, aborted) {
    const mood = r.stars >= 3 ? "太厉害了！" : r.stars === 2 ? "很不错！" : "完成啦";
    $("#result-kicker").textContent = `${game.name} · ${aborted ? "中途结束" : "本局完成"}`;
    $("#result-title").textContent = r.headline || mood;
    $("#result-desc").textContent = r.desc || "";

    const starBox = $("#result-stars");
    starBox.innerHTML = "";
    for (let i = 0; i < 3; i++) {
      starBox.insertAdjacentHTML("beforeend", `
        <svg class="star ${i < r.stars ? "on" : ""}" viewBox="0 0 64 64" aria-hidden="true">
          <path d="M32 5l8.4 17.6 19.1 2.5-14 13.2 3.6 19L32 48.6 14.9 57.3l3.6-19-14-13.2 19.1-2.5z"
            fill="${i < r.stars ? "#f9b233" : "#ded8c6"}" stroke="#10201b" stroke-width="3.4" stroke-linejoin="round"/>
        </svg>`);
    }
    $$(".star.on", starBox).forEach((s, i) => {
      setTimeout(() => {
        s.classList.add("in");
        this.audio.sfx("star");
      }, 180 + i * 260);
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

    if (!aborted) {
      addRecord({
        ts: Date.now(),
        game: game.id,
        name: game.name,
        score: r.score ?? 0,
        stars: r.stars ?? 0,
        rows: r.rows || [],
      });
    }

    this.showPanel("result");
    if (!aborted) this.audio.sfx("win");
    this.tracker.stop();
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
      if (this.elapsed >= game.duration) {
        this.finish();
      } else {
        game.update?.(dt, this.frame, this);
        if (this.state === "playing" && this.elapsed >= game.duration) this.finish();
      }
    }

    if (this.state === "setup" && this.frame) this.updateSetup(this.frame);
    if (this.tracker.mode === "camera") this.sampleLuma();

    // 光线太暗时提醒一次，别让孩子在黑屏里乱挥手
    if (this.state === "playing" && this.luma && this.luma < 42) {
      const now = performance.now();
      if (now - (this._darkWarnAt || 0) > 15000) {
        this._darkWarnAt = now;
        this.say("房间有点暗，开一盏灯会更容易看见你", { speak: false, ms: 3600 });
      }
    }

    this.draw(ts, dt);
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

  draw(ts, dt) {
    const { ctx, W, H, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const sh = this.shake;
    let ox = 0, oy = 0;
    if (sh > 0.01) {
      ox = (Math.random() - 0.5) * sh;
      oy = (Math.random() - 0.5) * sh;
      this.shake *= Math.pow(0.001, dt);
      if (this.shake < 0.1) this.shake = 0;
    }
    this.shakeX = ox; this.shakeY = oy;

    ctx.save();
    ctx.translate(ox, oy);
    if (this.state === "setup") this.drawSetup(ctx, this.frame);
    else game.draw?.(ctx, this);
    ctx.restore();

    // HUD 数值同步
    if (this._score !== this.score) {
      this._score = this.score;
      $("#score").textContent = this.score ?? 0;
    }
    const left = Math.max(0, game.duration - this.elapsed);
    if (Math.ceil(left) !== this._left) {
      this._left = Math.ceil(left);
      $("#timer-num").textContent = this._left;
      $("#timer-fill").style.transform = `scaleX(${clamp(left / game.duration, 0, 1)})`;
      $(".timer").classList.toggle("is-low", left <= 10);
    }
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
    // 环境暗的时候自动提亮，避免“看得见自己”变成黑屏
    const luma = this.luma ?? 90;
    const boost = luma < 80 ? clamp(1 + ((80 - luma) / 80) * 1.2, 1, 2.2) : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.filter = boost > 1.03 ? `${filter} brightness(${boost.toFixed(2)})` : filter;
    ctx.drawImage(tracker.video, r.x, r.y, r.w, r.h);
    ctx.restore();
    return true;
  }

  kick(power = 12) { this.shake = power; }

  flash(color = "#fff", alpha = 0.6) {
    this._flash = { color, alpha };
    const ctx = this.ctx;
    requestAnimationFrame(() => {
      if (!this._flash) return;
      ctx.save();
      ctx.globalAlpha = this._flash.alpha;
      ctx.fillStyle = this._flash.color;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.restore();
      this._flash = null;
    });
  }
}

const rt = new Runtime();
window.__rt = rt;
window.__game = game;

window.addEventListener("load", () => {
  requestAnimationFrame(rt.loop);
});

if (!GAMES[gameId]) {
  location.replace("./index.html");
}
