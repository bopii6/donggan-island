/* 摄像头自检：开摄像头、看骨骼、判断站位 */

import { PoseTracker } from "./pose.js";
import { drawSkeleton } from "./avatar.js";
import { clamp } from "./kit.js";

const CW = 960, CH = 720;
const canvas = document.getElementById("preview");
const ctx = canvas.getContext("2d");
const hint = document.getElementById("preview-hint");
const dot = document.getElementById("live-dot");
const fpsEl = document.getElementById("fps");
const errEl = document.getElementById("err");

const video = document.createElement("video");
video.playsInline = true;
video.muted = true;
video.autoplay = true;
video.style.cssText = "position:absolute;width:2px;height:2px;opacity:0;pointer-events:none";
document.body.appendChild(video);

canvas.width = CW;
canvas.height = CH;

const tracker = new PoseTracker(video, { width: CW, height: CH });
let started = false;
let last = 0;
let luma = 0;
let fpsSmooth = 0;
let lumaCanvas = document.createElement("canvas");
lumaCanvas.width = 32;
lumaCanvas.height = 18;
const lumaCtx = lumaCanvas.getContext("2d", { willReadFrequently: true });

const checks = {
  body: { el: document.querySelector('[data-check="body"]'), tip: document.getElementById("tip-body"), ok: false, seen: false },
  light: { el: document.querySelector('[data-check="light"]'), tip: document.getElementById("tip-light"), ok: false, seen: false },
  space: { el: document.querySelector('[data-check="space"]'), tip: document.getElementById("tip-space"), ok: false, seen: false },
};

function setCheck(key, ok, bad = false) {
  const c = checks[key];
  c.el.classList.toggle("is-ok", ok);
  c.el.classList.toggle("is-bad", !ok && bad);
}

function sampleLuma() {
  if (!tracker.stream) return;
  try {
    lumaCtx.drawImage(video, 0, 0, 32, 18);
    const d = lumaCtx.getImageData(0, 0, 32, 18).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    luma = s / (d.length / 4);
  } catch { /* ignore */ }
}

async function enable() {
  errEl.hidden = true;
  hint.textContent = "正在打开摄像头…";
  try {
    await tracker.startCamera();
    started = true;
    hint.classList.add("is-hidden");
    dot.classList.add("is-live");
  } catch (e) {
    hint.textContent = "摄像头没有打开";
    errEl.hidden = false;
    errEl.textContent = `没能打开摄像头：${e.message || e}。请检查浏览器地址栏的摄像头权限，或者确认没有别的软件正在占用摄像头。`;
  }
}

function drawVideo() {
  ctx.fillStyle = "#0d1a16";
  ctx.fillRect(0, 0, CW, CH);
  if (tracker.stream && tracker.videoSize.w) {
    const r = tracker.rect;
    ctx.save();
    ctx.translate(CW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, r.x, r.y, r.w, r.h);
    ctx.restore();
  } else {
    // 站位示意
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "#f6f3e9";
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 12]);
    const cx = CW / 2, cy = CH * 0.55, s = CH * 0.2;
    ctx.beginPath();
    ctx.arc(cx, cy - s * 1.7, s * 0.55, 0, Math.PI * 2);
    ctx.moveTo(cx - s * 0.85, cy - s * 1.05);
    ctx.lineTo(cx + s * 0.85, cy - s * 1.05);
    ctx.lineTo(cx + s * 0.6, cy + s * 0.25);
    ctx.lineTo(cx - s * 0.6, cy + s * 0.25);
    ctx.closePath();
    ctx.moveTo(cx - s * 0.45, cy + s * 0.25); ctx.lineTo(cx - s * 0.7, cy + s * 1.5);
    ctx.moveTo(cx + s * 0.45, cy + s * 0.25); ctx.lineTo(cx + s * 0.7, cy + s * 1.5);
    ctx.stroke();
    ctx.restore();
  }

  // 安全框
  ctx.save();
  ctx.strokeStyle = "rgba(246,243,233,0.35)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.strokeRect(CW * 0.05, CH * 0.04, CW * 0.9, CH * 0.92);
  ctx.restore();
}

function updateChecks(f) {
  if (!started || !f) return;
  const hRatio = f.bbox ? f.bbox.h / CH : 0;
  const headUp = f.pts?.nose && f.pts.nose.v > 0.5;
  const feetDown = f.pts?.lAnk && f.pts?.rAnk && f.pts.lAnk.v > 0.4 && f.pts.rAnk.v > 0.4;
  const bodyOk = f.ok && headUp && hRatio > 0.3;
  checks.body.seen = true;
  setCheck("body", bodyOk, f.ok);

  if (luma > 0) {
    checks.light.seen = true;
    setCheck("light", luma > 50, true);
  }

  if (f.bbox) {
    const marginOk = f.bbox.x > CW * 0.04 && f.bbox.x + f.bbox.w < CW * 0.96;
    checks.space.seen = true;
    setCheck("space", marginOk && hRatio < 0.97, bodyOk);
  }

  hint.classList.add("is-hidden");

  // 三项都过了：把“打开摄像头”换成“去挑游戏”
  const allOk = Object.values(checks).every((c) => c.el.classList.contains("is-ok"));
  document.getElementById("btn-go").hidden = !allOk;
  document.getElementById("btn-enable").hidden = allOk || started;

  if (!f.ok) {
    hint.classList.remove("is-hidden");
    hint.textContent = "没看到你，站到电脑前 1～2 米，让头和手进画面";
  }
}

function loop(ts) {
  const dt = clamp((ts - last) / 1000, 0.001, 0.1);
  last = ts;
  fpsSmooth = fpsSmooth * 0.9 + (1 / dt) * 0.1;

  const f = tracker.update(ts, dt);
  drawVideo();
  if (f && f.ok) {
    drawSkeleton(ctx, f.pts, "#f9b233");
    // 头顶和脚底标记
    if (f.bbox) {
      ctx.save();
      ctx.strokeStyle = "#48e08a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(f.bbox.x, f.bbox.y); ctx.lineTo(f.bbox.x + f.bbox.w, f.bbox.y);
      ctx.moveTo(f.bbox.x, f.bbox.y + f.bbox.h); ctx.lineTo(f.bbox.x + f.bbox.w, f.bbox.y + f.bbox.h);
      ctx.stroke();
      ctx.restore();
    }
  }
  updateChecks(f);
  if (Math.random() < 0.06) sampleLuma();

  if (started) fpsEl.textContent = f && f.ok ? `识别中 · ${Math.round(fpsSmooth)} fps` : "摄像头已开，等待人走进画面";
  requestAnimationFrame(loop);
}

document.getElementById("btn-enable").addEventListener("click", enable);
requestAnimationFrame(loop);

// 用户直接点按钮时由浏览器弹出权限请求
if (new URLSearchParams(location.search).get("auto") === "1") enable();
