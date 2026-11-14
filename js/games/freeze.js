/* 木头人 —— 绿灯动手动脚，红灯定格。
   练的是：抑制控制、听觉指令反应、全身爆发力。 */

import { clamp, lerp, rand, Particles, roundRect, starPath, easeOutCubic, easeOutBack } from "../kit.js";
import { drawAvatar, PALETTES, presetPose, standingJoints, fitScale } from "../avatar.js";

const DURATION = 60;
const PAL = PALETTES.sunset;

let S = null;

function blank() {
  return {
    phase: "green",
    phaseT: 0,
    phaseDur: 5.2,
    warned: false,
    lives: 3,
    stars: 0,
    buf: 0,
    fly: [],
    parts: new Particles(220),
    caughtT: 0,
    caughtFlash: 0,
    stamp: null,
    clean: 0,
    freezes: 0,
    caught: 0,
    maxStill: 0,
    curStill: 0,
    stillSamples: 0,
    sumStill: 0,
    greenMotion: 0,
    greenTime: 0,
    caption: { text: "", t: 0, sub: "" },
    lastPhase: "green",
    energy: 0,
    t: 0,
  };
}

function enterGreen(rt) {
  S.phase = "green";
  S.phaseT = 0;
  S.phaseDur = rand(6.2, 4.6);
  S.warned = false;
  S.caption = { text: "动起来！", sub: "绿灯亮，使劲动", t: 0 };
  rt.audio.sfx("light");
  rt.say("绿灯，动起来！", { ms: 1500 });
}

function enterRed(rt) {
  S.phase = "red";
  S.phaseT = 0;
  S.phaseDur = rand(3.6, 2.6);
  S.caption = { text: "木头人！", sub: "定住，别动", t: 0 };
  S.caughtT = 0;
  S.curStill = 0;
  S.freezes++;
  rt.audio.sfx("caught");
  rt.say("木头人！", { alert: true, ms: 1600 });
}

function addFlyStar(rt) {
  const f = rt.frame;
  const src = f?.pts?.lWri && f.pts.lWri.v > 0.5 ? f.pts.lWri : { x: rt.W * 0.5, y: rt.H * 0.4 };
  const from = f?.pts?.rWri && f.pts.rWri.v > 0.5 ? f.pts.rWri : src;
  S.fly.push({
    x0: lerp(src.x, from.x, 0.5) + rand(30, -30),
    y0: lerp(src.y, from.y, 0.5) + rand(20, -40),
    x1: rt.W - 96,
    y1: 74,
    t: 0,
    dur: rand(0.62, 0.42),
  });
}

/* 没有摄像头时的黄昏操场（鼠标模式） */
function drawBackdrop(ctx, W, H) {
  const horizon = H * 0.72;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#2a3358");
  sky.addColorStop(0.45, "#7d5069");
  sky.addColorStop(0.78, "#e0805a");
  sky.addColorStop(1, "#f7b26a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // 星星
  ctx.save();
  ctx.fillStyle = "rgba(255,240,210,0.75)";
  for (let i = 0; i < 22; i++) {
    const x = ((i * 97.3) % 1) * W + ((i * 37) % 40);
    const y = ((i * 53.7) % (horizon * 0.55));
    const r = 1 + ((i * 13) % 3) * 0.6;
    ctx.globalAlpha = 0.25 + ((i * 17) % 60) / 100;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 夕阳
  const sx = W * 0.74, sy = horizon - H * 0.1;
  const glow = ctx.createRadialGradient(sx, sy, 4, sx, sy, H * 0.34);
  glow.addColorStop(0, "rgba(255,214,140,0.9)");
  glow.addColorStop(0.25, "rgba(255,170,90,0.35)");
  glow.addColorStop(1, "rgba(255,140,80,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, horizon + 20);
  ctx.beginPath();
  ctx.arc(sx, sy, H * 0.085, 0, Math.PI * 2);
  ctx.fillStyle = "#ffd98f";
  ctx.fill();

  // 远山
  ctx.fillStyle = "#3d3757";
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  ctx.quadraticCurveTo(W * 0.18, horizon - H * 0.16, W * 0.36, horizon);
  ctx.quadraticCurveTo(W * 0.52, horizon - H * 0.1, W * 0.68, horizon);
  ctx.quadraticCurveTo(W * 0.85, horizon - H * 0.13, W, horizon);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();

  // 地面
  const ground = ctx.createLinearGradient(0, horizon, 0, H);
  ground.addColorStop(0, "#2a2a3e");
  ground.addColorStop(1, "#141422");
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, W, H - horizon);

  // 跑道线
  ctx.save();
  ctx.strokeStyle = "rgba(255,250,240,0.14)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    ctx.beginPath();
    ctx.moveTo(-W * 0.1 + W * 1.2 * t, horizon);
    ctx.lineTo(-W * 0.5 + W * 2 * t, H);
    ctx.stroke();
  }
  for (let i = 0; i < 4; i++) {
    const y = horizon + (H - horizon) * Math.pow(i / 4, 1.7) * 1.05;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();

  // 装饰小树剪影
  ctx.fillStyle = "#101020";
  for (const [tx, s] of [[W * 0.1, 1], [W * 0.9, 0.8], [W * 0.06, 0.7]]) {
    ctx.save();
    ctx.translate(tx, horizon + 8);
    ctx.scale(s, s);
    ctx.fillRect(-5, -70, 10, 70);
    ctx.beginPath();
    ctx.arc(0, -78, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-22, -58, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(22, -58, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawBigText(ctx, text, x, y, size) {  ctx.save();
  ctx.font = `900 ${size}px "KuaiLe","MiSans","PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 0.18;
  ctx.strokeStyle = "#10201b";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#fffaf0";
  ctx.fillText(text, x, y);
  ctx.restore();
}

export default {
  id: "freeze",
  name: "木头人",
  tag: "抑制控制 · 全身",
  unit: "颗星",
  age: "3–10",
  duration: DURATION,
  lives: 3,
  tagline: "绿灯使劲动，听到「木头人」马上定住，动一下就被抓到。",
  howto: [
    "绿灯亮：跳、挥手、扭一扭，动得越多星星越多。",
    "听到「木头人」：像被按了暂停键，站着别动。",
    "被摄像机抓到动，就少一颗心。三颗心用完这局就结束了。",
  ],
  stars: [80, 135],

  cover(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#ff9d5c");
    g.addColorStop(0.55, "#f0705c");
    g.addColorStop(1, "#5b3f6e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 太阳
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.arc(w * 0.78, h * 0.34, h * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 地面
    ctx.fillStyle = "#3a2b4d";
    ctx.beginPath();
    ctx.moveTo(0, h * 0.82);
    ctx.quadraticCurveTo(w * 0.5, h * 0.72, w, h * 0.84);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    // 红绿灯
    const lx = w * 0.13, ly = h * 0.22;
    ctx.save();
    ctx.strokeStyle = "#10201b";
    ctx.lineWidth = 6;
    ctx.fillStyle = "#10201b";
    roundRect(ctx, lx - 26, ly + 14, 52, 6, 3);
    ctx.fill();
    roundRect(ctx, lx - 24, ly, 48, 118, 14);
    ctx.fillStyle = "#1c2e28";
    ctx.fill();
    ctx.stroke();
    const on = ["#ff5a4d", "#ffd166", "#48d17a"];
    on.forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(lx, ly + 26 + i * 33, 12, 0, Math.PI * 2);
      ctx.fillStyle = i === 2 ? c : "#2f463d";
      ctx.fill();
      ctx.strokeStyle = "#10201b";
      ctx.lineWidth = 3;
      ctx.stroke();
    });
    ctx.restore();

    drawAvatar(ctx, presetPose(w, h, "slash"), {
      palette: PALETTES.sunset,
      inkW: 5,
    });
  },

  start(rt) {
    S = blank();
    rt.score = 0;
    rt.setScore(0);
    rt.setLives(3);
    rt.lives = 3;
    enterGreen(rt);
  },

  update(dt, f, rt) {
    if (!S || S.ending) return;
    S.t += dt;
    S.phaseT += dt;
    if (S.caption.t < 1) S.caption.t = Math.min(1, S.caption.t + dt * 5);
    if (S.caughtFlash > 0) S.caughtFlash = Math.max(0, S.caughtFlash - dt * 1.6);
    if (S.stamp) {
      S.stamp.t += dt;
      if (S.stamp.t > 1.4) S.stamp = null;
    }

    const motion = f && f.ok ? f.motion : 0;
    S.energy = lerp(S.energy, motion, 0.25);

    // 粒子
    S.parts.update(dt);
    for (let i = S.fly.length - 1; i >= 0; i--) {
      const p = S.fly[i];
      p.t += dt / p.dur;
      if (p.t >= 1) {
        S.fly.splice(i, 1);
        S.parts.burst(p.x1, p.y1, 4, { color: ["#f9b233", "#fff"], life: 0.35, size: 6, g: 200, power: 0.4 });
      }
    }

    // 阶段切换
    if (S.phase === "green") {
      S.greenTime += dt;
      S.greenMotion += motion * dt;
      if (!S.warned && S.phaseT > S.phaseDur - 1.2) {
        S.warned = true;
        rt.say("注意——", { ms: 1000 });
        rt.audio.sfx("count");
      }
      if (S.phaseT >= S.phaseDur) enterRed(rt);
    } else {
      if (S.phaseT >= S.phaseDur) {
        if (S.cleanThisFreeze) S.clean++;
        S.cleanThisFreeze = false;
        enterGreen(rt);
      }
    }

    // 绿灯：动起来攒星星
    if (S.phase === "green") {
      const eff = clamp((motion - 0.16) / 0.66, 0, 1);
      S.buf += eff * dt * 7.5;
      while (S.buf >= 1) {
        S.buf -= 1;
        S.stars++;
        rt.setScore(S.stars);
        addFlyStar(rt);
        if (S.stars % 5 === 0) rt.audio.sfx("star");
      }
    }

    // 红灯：动就被抓到
    if (S.phase === "red") {
      if (motion > 0.32) {
        S.caughtT += dt;
        S.curStill = 0;
      } else {
        S.caughtT = Math.max(0, S.caughtT - dt * 1.8);
        S.curStill += dt;
        S.stillSamples++;
        S.sumStill += dt;
        S.maxStill = Math.max(S.maxStill, S.curStill);
        if (S.curStill > 0.5) S.cleanThisFreeze = true;
      }
      if (S.caughtT > 0.26) {
        S.caughtT = 0;
        S.caught++;
        S.lives--;
        S.curStill = 0;
        rt.setLives(S.lives);
        rt.lives = S.lives;
        rt.kick(26);
        rt.flash("#e2542f", 0.42);
        rt.audio.sfx("fail");
        rt.say("抓到啦！", { alert: true, ms: 1200 });
        S.stamp = { text: "抓到啦", t: 0, bad: true };
        S.caughtFlash = 1;
        S.parts.burst(rt.W * 0.5, rt.H * 0.45, 16, { color: ["#e2542f", "#ffd166"], life: 0.7, size: 10, power: 1.2 });
        if (S.lives <= 0) {
          S.ending = true;
          setTimeout(() => { if (rt.state === "playing") rt.finish(); }, 900);
        }
      }
    }
  },

  draw(ctx, rt) {
    if (!S) return;
    const { W, H } = rt;

    // 背景：摄像头实时画面，调成黄昏色调
    const hasCam = rt.camera(1, "saturate(0.55) contrast(1.02) brightness(1.02) sepia(0.1)");
    if (!hasCam) {
      drawBackdrop(ctx, W, H);
    }

    // 黄昏叠色
    const warm = ctx.createLinearGradient(0, 0, 0, H);
    warm.addColorStop(0, "rgba(255,158,92,0.3)");
    warm.addColorStop(0.55, "rgba(226,84,47,0.14)");
    warm.addColorStop(1, "rgba(42,28,52,0.55)");
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, W, H);

    // 太阳
    ctx.save();
    ctx.globalAlpha = 0.55;
    const sunX = W * 0.8, sunY = H * 0.24, sunR = Math.min(W, H) * 0.15;
    const sg = ctx.createRadialGradient(sunX, sunY, sunR * 0.2, sunX, sunY, sunR * 2.4);
    sg.addColorStop(0, "rgba(255,209,102,0.95)");
    sg.addColorStop(0.32, "rgba(255,170,80,0.5)");
    sg.addColorStop(1, "rgba(255,120,60,0)");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 底部压暗
    const bot = ctx.createLinearGradient(0, H * 0.72, 0, H);
    bot.addColorStop(0, "rgba(16,32,27,0)");
    bot.addColorStop(1, "rgba(16,32,27,0.82)");
    ctx.fillStyle = bot;
    ctx.fillRect(0, 0, W, H);

    this.drawTraffic(ctx, rt);
    this.drawBody(ctx, rt);

    // 星星飞行
    for (const p of S.fly) {
      const e = easeOutCubic(p.t);
      const x = lerp(p.x0, p.x1, e);
      const y = lerp(p.y0, p.y1, e) - Math.sin(e * Math.PI) * 90;
      const r = lerp(16, 9, e);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.t * 6);
      starPath(ctx, 0, 0, r, r * 0.45, 5);
      ctx.fillStyle = "#f9b233";
      ctx.strokeStyle = "#10201b";
      ctx.lineWidth = 2.5;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    S.parts.draw(ctx);
    this.drawCap(ctx, rt);
    this.drawEnergy(ctx, rt);

    // 抓到印章
    if (S.stamp) {
      const t = S.stamp.t;
      const k = easeOutBack(clamp(t / 0.32, 0, 1));
      ctx.save();
      ctx.translate(W * 0.5, H * 0.36);
      ctx.rotate(-0.12);
      ctx.scale(k, k);
      ctx.globalAlpha = clamp(1 - (t - 0.9) / 0.5, 0, 1);
      const bw = 340, bh = 104;
      roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 16);
      ctx.fillStyle = "#e2542f";
      ctx.fill();
      ctx.strokeStyle = "#10201b";
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.font = '900 54px "KuaiLe","MiSans","PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fffaf0";
      ctx.fillText("被抓到啦", 0, 4);
      ctx.restore();
    }

    // 红屏
    if (S.caughtFlash > 0) {
      ctx.save();
      ctx.globalAlpha = S.caughtFlash * 0.35;
      ctx.fillStyle = "#c0392b";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  },

  drawTraffic(ctx, rt) {
    const { W, H } = rt;
    const wide = W > 760;
    const lx = wide ? W * 0.09 : W * 0.13;
    const top = H * 0.2;
    const bw = wide ? 108 : 78;
    const bh = bw * 2.55;
    const r = bw * 0.28;

    ctx.save();
    // 支撑杆
    ctx.fillStyle = "rgba(16,32,27,0.55)";
    ctx.fillRect(lx - 4, top + bh * 0.5, 8, H);

    roundRect(ctx, lx - bw / 2, top, bw, bh, r);
    ctx.fillStyle = "#1c2e28";
    ctx.fill();
    ctx.strokeStyle = "#10201b";
    ctx.lineWidth = 6;
    ctx.stroke();

    const on = S.phase === "red" ? 0 : S.phase === "green" && S.warned ? 1 : 2;
    const colors = ["#ff4b3e", "#ffd166", "#48e08a"];
    const glow = ["rgba(255,75,62,0.65)", "rgba(255,209,102,0.6)", "rgba(72,224,138,0.6)"];
    for (let i = 0; i < 3; i++) {
      const cy = top + bw * 0.5 + i * (bh - bw) / 2.02;
      const active = i === on;
      if (active) {
        const g = ctx.createRadialGradient(lx, cy, 2, lx, cy, bw * 0.9);
        g.addColorStop(0, glow[i]);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(lx, cy, bw * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(lx, cy, bw * 0.29, 0, Math.PI * 2);
      ctx.fillStyle = active ? colors[i] : "#2f463d";
      ctx.fill();
      ctx.strokeStyle = "#10201b";
      ctx.lineWidth = 4;
      ctx.stroke();
      if (active) {
        ctx.beginPath();
        ctx.arc(lx - bw * 0.09, cy - bw * 0.1, bw * 0.08, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fill();
      }
    }
    ctx.restore();
  },

  drawBody(ctx, rt) {
    const f = rt.frame;
    if (!f || !f.pts || !f.ok) {
      // 没识别到人：画一个站位虚影，别让孩子不知道站哪
      const hgt = Math.min(rt.H * 0.55, rt.W * 0.6);
      drawAvatar(ctx, standingJoints(rt.W / 2, rt.H * 0.86, hgt), {
        palette: PALETTES.chalk,
        alpha: 0.32,
        showFace: false,
        inkW: 4,
      });
      ctx.save();
      ctx.font = '800 17px "KuaiLe","MiSans","PingFang SC",sans-serif';
      ctx.textAlign = "center";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#10201b";
      ctx.strokeText("站到画面里，看见你才能动起来", rt.W / 2, rt.H * 0.16);
      ctx.fillStyle = "#fffaf0";
      ctx.fillText("站到画面里，看见你才能动起来", rt.W / 2, rt.H * 0.16);
      ctx.restore();
      return;
    }

    const paused = S.phase === "red";
    const k = fitScale(f.bodyScale, rt.H, 0.66);
    ctx.save();
    if (k < 0.99 && f.hip) {
      ctx.translate(f.hip.x, f.hip.y);
      ctx.scale(k, k);
      ctx.translate(-f.hip.x, -f.hip.y);
    }
    drawAvatar(ctx, f.pts, {
      palette: PAL,
      alpha: f.present < 0.85 ? 0.82 : 0.97,
      inkW: Math.max(3, f.bodyScale * 0.045),
    });
    ctx.restore();

    // 红灯时在脚下画一个“定住”的圆环
    if (paused) {
      const feet = f.pts;
      if (feet.lAnk && feet.rAnk && feet.lAnk.v > 0.3 && feet.rAnk.v > 0.3) {
        const cx = (feet.lAnk.x + feet.rAnk.x) / 2;
        const cy = Math.max(feet.lAnk.y, feet.rAnk.y);
        const rr = f.bodyScale * (0.8 + Math.sin(S.phaseT * 3) * 0.05);
        ctx.save();
        ctx.strokeStyle = S.curStill > 0.4 ? "#48e08a" : "#ffd166";
        ctx.lineWidth = Math.max(3, f.bodyScale * 0.035);
        ctx.setLineDash([14, 12]);
        ctx.lineDashOffset = -S.phaseT * 20;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 6, rr, rr * 0.28, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  },

  drawCap(ctx, rt) {
    const c = S.caption;
    if (!c.text || c.t >= 1) return;
    const k = easeOutBack(clamp(c.t * 1.6, 0, 1));
    const alpha = c.t < 0.7 ? 1 : clamp((1 - c.t) / 0.3, 0, 1);
    const size = Math.min(rt.W * 0.12, 104);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(rt.W / 2, rt.H * 0.18);
    ctx.scale(k, k);
    ctx.rotate(-0.03);
    drawBigText(ctx, c.text, 0, 0, size);
    ctx.font = `800 ${Math.max(14, size * 0.2)}px "KuaiLe","MiSans","PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = size * 0.06;
    ctx.strokeStyle = "#10201b";
    ctx.strokeText(c.sub, 0, size * 0.62);
    ctx.fillStyle = "#fffaf0";
    ctx.fillText(c.sub, 0, size * 0.62);
    ctx.restore();
  },

  drawEnergy(ctx, rt) {
    const w = Math.min(210, rt.W * 0.2);
    const h = 12;
    const x = 28;
    const y = rt.H - 92;
    const e = clamp(S.energy * 1.3, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.font = '800 11px "KuaiLe","MiSans","PingFang SC",sans-serif';
    ctx.fillStyle = "rgba(255,250,240,0.9)";
    ctx.textAlign = "left";
    ctx.fillText(S.phase === "red" ? "别动" : "动起来", x, y - 9);

    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = "rgba(16,32,27,0.55)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,250,240,0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    roundRect(ctx, x + 2, y + 2, Math.max(0, (w - 4) * e), h - 4, (h - 4) / 2);
    ctx.fillStyle = S.phase === "red" ? (S.caughtT > 0.08 ? "#ff4b3e" : "#ffd166") : "#48e08a";
    ctx.fill();
    ctx.restore();

    // 阈值刻度：超过它才算“在动”
    const tx = x + 2 + (w - 4) * 0.3;
    ctx.beginPath();
    ctx.moveTo(tx, y - 3);
    ctx.lineTo(tx, y + h + 3);
    ctx.strokeStyle = "rgba(255,250,240,0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  },

  finish(rt, quit) {
    const s = S || blank();
    const score = s.stars;
    const stars = score >= 135 ? 3 : score >= 80 ? 2 : 1;
    const success = s.freezes ? Math.round((s.clean / s.freezes) * 100) : 0;
    const greenRatio = s.greenTime ? clamp(s.greenMotion / s.greenTime, 0, 1) : 0;
    const headline = stars === 3 ? "定得像石头！" : stars === 2 ? "稳住了！" : "动得很开心";
    return {
      score,
      stars,
      headline,
      desc: stars === 3
        ? "绿灯时火力全开，红灯时一秒定住，控制力非常棒。"
        : stars === 2
          ? "大部分「木头人」都定住了，再快一点点就更厉害。"
          : "已经玩起来了。下一次听到「木头人」，试试先把脚钉在地上。",
      rows: [
        { label: "攒到的星星", value: `${score} 颗` },
        { label: "定住成功率", value: `${success}%` },
        { label: "最长定住", value: `${s.maxStill.toFixed(1)} 秒` },
        { label: "红灯被抓", value: `${s.caught} 次` },
      ],
      sensory: [
        { label: "抑制控制", value: clamp(success / 100, 0.05, 1) },
        { label: "前庭与平衡", value: clamp(s.maxStill / 3, 0.1, 1) },
        { label: "爆发力", value: clamp(greenRatio * 1.1, 0.1, 1) },
      ],
      tip: success >= 70
        ? "小提示：下一次可以把「木头人」的停顿拉长到 4 秒，练更久的身体控制。"
        : "小提示：先玩「慢慢动、快快停」——家长喊停时孩子摆一个造型，比单纯站着更好玩。",
    };
  },
};
