/* 节奏跳跳 —— 踩着拍子向左、向右、向上跳。
   练的是：双侧协调、前庭觉、节奏感、动作计划。 */

import { clamp, lerp, rand, pick, Particles, roundRect, easeOutCubic, easeOutBack } from "../kit.js";
import { drawAvatar, PALETTES, presetPose, standingJoints, fitScale } from "../avatar.js";
import { Music } from "../kit.js";

const DURATION = 60;
const BPM = 108;
const BEAT = 60 / BPM;
const STEP = BEAT * 2; // 每两拍一个指令
const PAL = PALETTES.mint;

let S = null;

function blank() {
  return {
    t: 0,
    cues: [],
    cueCount: 0,
    genAt: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    perfect: 0,
    good: 0,
    miss: 0,
    hitsLeft: 0,
    hitsRight: 0,
    jumps: 0,
    errSum: 0,
    errN: 0,
    base: null,
    zone: "center",
    air: false,
    parts: new Particles(200),
    pops: [],
    beat: 0,
    lastBeat: -1,
    state: "center",
    banner: null,
    music: null,
  };
}

function cueWord(c) {
  return c.type === "left" ? "左" : c.type === "right" ? "右" : "跳";
}

function requiredState(type) {
  return type === "jump" ? "air" : type;
}

function currentState() {
  if (S.air) return "air";
  return S.zone;
}

function genCue(rt) {
  const t = 2.1 + S.cueCount * STEP;
  S.cueCount++;
  let type;
  const r = Math.random();
  const last = S.cues[S.cues.length - 1]?.type;
  if (S.cueCount <= 3) {
    type = S.cueCount % 2 === 0 ? "left" : "right";
  } else if (r < 0.3) {
    type = "jump";
  } else if (r < 0.55) {
    type = last === "left" ? "right" : "left";
  } else {
    type = pick(["left", "right"]);
  }
  if (type === last && S.cueCount > 4 && Math.random() < 0.6) {
    type = type === "left" ? "right" : "left";
  }
  S.cues.push({ type, t, judged: false, result: null, dt: 0 });
}

function judge(rt, cue, hitState, dtErr) {
  cue.judged = true;
  cue.dt = dtErr;
  const perfect = Math.abs(dtErr) < 0.11;
  cue.result = perfect ? "perfect" : "good";
  S.combo++;
  S.bestCombo = Math.max(S.bestCombo, S.combo);
  const mult = 1 + Math.min(20, S.combo - 1) * 0.03;
  const base = perfect ? 120 : 70;
  S.score += Math.round(base * mult);
  rt.setScore(S.score);
  if (perfect) S.perfect++; else S.good++;
  S.errSum += Math.abs(dtErr);
  S.errN++;
  if (cue.type === "left") S.hitsLeft++;
  if (cue.type === "right") S.hitsRight++;
  if (cue.type === "jump") S.jumps++;

  S.pops.push({
    text: perfect ? "完美" : "不错",
    sub: perfect ? "+120" : "+70",
    x: cue.type === "left" ? rt.W * 0.22 : cue.type === "right" ? rt.W * 0.78 : rt.W * 0.5,
    y: rt.H * 0.62,
    t: 0,
    color: perfect ? "#ffd166" : "#8ef0ff",
  });
  rt.audio.sfx(perfect ? "perfect" : "hit");
  S.parts.burst(
    cue.type === "left" ? rt.W * 0.22 : cue.type === "right" ? rt.W * 0.78 : rt.W * 0.5,
    rt.H * 0.74, 12, { color: perfect ? ["#ffd166", "#fff"] : ["#8ef0ff", "#fff"], life: 0.7, size: 9, power: 1 }
  );
}

function missCue(rt, cue) {
  cue.judged = true;
  cue.result = "miss";
  S.miss++;
  S.combo = 0;
  rt.audio.sfx("miss");
  const mx = cue.type === "left" ? rt.W * 0.22 : cue.type === "right" ? rt.W * 0.78 : rt.W * 0.5;
  S.pops.push({ text: "错过", sub: "", x: mx, y: rt.H * 0.44, t: 0, color: "#ff8a7a" });
}

export default {
  id: "hop",
  name: "节奏跳跳",
  tag: "双侧协调 · 前庭觉",
  unit: "分",
  age: "5–12",
  duration: DURATION,
  lives: 3,
  tagline: "踩着鼓点向左、向右、向上跳，越准分越高。",
  howto: [
    "看屏幕上的箭头：向左跳、向右跳，或者原地起跳。",
    "每个指令有两拍的时间，光圈收拢到箭头时正好在位置上，就是「完美」。",
    "连续踩准会累积连击；跳错了不要紧，跟着下一拍继续。",
  ],
  stars: [2600, 4200],

  cover(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#1a2a4a");
    g.addColorStop(1, "#0d1526");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 光束
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 4; i++) {
      const x = w * (0.2 + i * 0.2);
      const grad = ctx.createLinearGradient(x, 0, x + (i - 1.5) * 40, h);
      grad.addColorStop(0, "rgba(120,200,255,0.4)");
      grad.addColorStop(1, "rgba(120,200,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x - 10, 0);
      ctx.lineTo(x + 10, 0);
      ctx.lineTo(x + 70, h);
      ctx.lineTo(x - 70, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 地垫
    ctx.save();
    ["#e2542f", "#2bb3a3", "#f9b233"].forEach((c, i) => {
      ctx.beginPath();
      ctx.ellipse(w * (0.22 + i * 0.28), h * 0.86, w * 0.09, h * 0.055, 0, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#10201b";
      ctx.lineWidth = 4;
      ctx.stroke();
    });
    ctx.restore();

    // 箭头
    ctx.save();
    ctx.translate(w * 0.19, h * 0.22);
    ctx.rotate(-0.06);
    roundRect(ctx, -44, -28, 88, 56, 16);
    ctx.fillStyle = "#f9b233";
    ctx.fill();
    ctx.strokeStyle = "#10201b";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.font = '900 30px "KuaiLe","MiSans","PingFang SC",sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#10201b";
    ctx.fillText("跳", 0, 2);
    ctx.restore();

    drawAvatar(ctx, presetPose(w, h, "jump"), { palette: PAL, inkW: 5 });
  },

  start(rt) {
    S = blank();
    rt.score = 0;
    rt.setScore(0);
    rt.setLives(3);
    rt.lives = 3;
    rt.setScore(0);

    const f = rt.frame;
    if (f && f.ok && f.hip) {
      S.base = {
        x: f.hip.x,
        y: f.hip.y,
        s: f.bodyScale || 120,
        ankleY: f.feet[0] && f.feet[1] ? (f.feet[0].y + f.feet[1].y) / 2 : f.hip.y + (f.bodyScale || 120) * 1.4,
      };
    } else if (f && f.baseline) {
      S.base = { x: f.baseline.hipX, y: f.baseline.hipY, s: f.baseline.scale, ankleY: f.baseline.ankleY };
    } else {
      S.base = { x: rt.W / 2, y: rt.H * 0.62, s: Math.min(rt.W, rt.H) * 0.18, ankleY: rt.H * 0.86 };
    }

    for (let i = 0; i < 4; i++) genCue(rt);

    S.music = new Music(rt.audio, BPM);
    S.music.level = 0.5;
    S.music.start(rt.audio.now + 0.06);
    rt.say("跟着鼓点，左、右、跳！", { ms: 2200 });
  },

  update(dt, f, rt) {
    if (!S) return;
    S.t += dt;

    // 生成指令
    while (2.1 + S.cueCount * STEP < S.t + 6) genCue(rt);

    // 节拍脉动
    const beat = Math.floor(S.t / BEAT);
    if (beat !== S.lastBeat) {
      S.lastBeat = beat;
      S.beat = 1;
    } else {
      S.beat = Math.max(0, S.beat - dt * 3.2);
    }

    // 姿态 → 状态
    if (f && f.ok && f.hip) {
      const s = S.base.s || 120;
      const dx = (f.hip.x - S.base.x) / s;
      let zone = dx < -0.52 ? "left" : dx > 0.52 ? "right" : "center";
      const ankleMin = f.feet[0] && f.feet[1] ? Math.min(f.feet[0].y, f.feet[1].y) : Infinity;
      const air = f.hip.y < S.base.y - s * 0.09 || ankleMin < S.base.ankleY - s * 0.13;
      S.zone = zone;
      S.air = air;
      // 站在中间且没跳时，缓慢更新基准（防止孩子慢慢走位）
      if (!air && zone === "center") {
        S.base.x = lerp(S.base.x, f.hip.x, dt * 0.6);
        S.base.y = lerp(S.base.y, f.hip.y, dt * 0.6);
        S.base.ankleY = lerp(S.base.ankleY, ankleMin, dt * 0.6);
      }
    } else {
      S.air = false;
    }

    // 判定
    for (const cue of S.cues) {
      if (cue.judged) continue;
      const err = S.t - cue.t;
      const need = requiredState(cue.type);
      const cur = currentState();
      if (Math.abs(err) <= 0.24 && cur === need) {
        judge(rt, cue, cur, err);
      } else if (err > 0.24) {
        missCue(rt, cue);
      }
    }
    // 清理已经过期很久的指令
    while (S.cues.length && S.cues[0].t < S.t - 2.5) S.cues.shift();

    // 特效
    S.parts.update(dt);
    for (let i = S.pops.length - 1; i >= 0; i--) {
      S.pops[i].t += dt;
      S.pops[i].y -= dt * 60;
      if (S.pops[i].t > 0.9) S.pops.splice(i, 1);
    }

    if (S.miss + S.perfect + S.good >= 4 && S.combo === 0 && S.miss === S.perfect + S.good + S.miss) {
      // 全错时给一句提示
    }
  },

  draw(ctx, rt) {
    if (!S) return;
    const { W, H } = rt;
    const f = rt.frame;

    const hasCam = rt.camera(0.88, "saturate(0.65) brightness(0.95) contrast(1.02)");
    if (!hasCam) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#1a2a4a");
      g.addColorStop(1, "#0d1526");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(26,42,74,0.32)");
    g.addColorStop(0.7, "rgba(13,21,38,0.16)");
    g.addColorStop(1, "rgba(13,21,38,0.72)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 舞台光束
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 4; i++) {
      const x = W * (0.18 + i * 0.21);
      const grad = ctx.createLinearGradient(x, 0, x + (i - 1.5) * 60, H);
      grad.addColorStop(0, i % 2 ? "rgba(120,200,255,0.16)" : "rgba(255,150,120,0.14)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x - W * 0.01, 0);
      ctx.lineTo(x + W * 0.01, 0);
      ctx.lineTo(x + W * 0.09, H);
      ctx.lineTo(x - W * 0.09, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 地垫
    const pads = [
      { x: W * 0.22, c: "#e2542f", zone: "left", label: "左" },
      { x: W * 0.5, c: "#2bb3a3", zone: "center", label: "中" },
      { x: W * 0.78, c: "#f9b233", zone: "right", label: "右" },
    ];
    const py = H * 0.87;
    const prx = Math.min(W * 0.13, 190);
    const pry = prx * 0.32;

    for (const p of pads) {
      const active = (p.zone === "left" && S.zone === "left") || (p.zone === "right" && S.zone === "right") || (p.zone === "center" && S.zone === "center" && !S.air);
      const pulse = 1 + S.beat * 0.06 + (active ? 0.05 : 0);
      ctx.save();
      ctx.translate(p.x, py);
      if (active) {
        const glow = ctx.createRadialGradient(0, 0, prx * 0.2, 0, 0, prx * 1.5);
        glow.addColorStop(0, "rgba(255,250,240,0.34)");
        glow.addColorStop(1, "rgba(255,250,240,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.ellipse(0, 0, prx * 1.5, pry * 1.9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.scale(pulse, pulse);
      ctx.beginPath();
      ctx.ellipse(0, 0, prx, pry, 0, 0, Math.PI * 2);
      ctx.fillStyle = p.c;
      ctx.globalAlpha = active ? 1 : 0.3;
      ctx.fill();
      ctx.globalAlpha = active ? 1 : 0.55;
      ctx.strokeStyle = "#10201b";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, prx * 0.72, pry * 0.72, 0, 0, Math.PI * 2);
      ctx.strokeStyle = active ? "rgba(255,250,240,0.95)" : "rgba(255,250,240,0.4)";
      ctx.lineWidth = active ? 3 : 2;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = active ? 1 : 0.5;
      ctx.font = '900 17px "KuaiLe","MiSans","PingFang SC",sans-serif';
      ctx.fillStyle = "#fffaf0";
      ctx.textAlign = "center";
      ctx.fillText(p.label, p.x, py + pry + 26);
      ctx.restore();
    }

    // 指令
    for (const cue of S.cues) {
      if (cue.judged) continue;
      const lead = cue.t - S.t;
      if (lead > 2.4 || lead < -0.3) continue;
      const x = cue.type === "left" ? W * 0.22 : cue.type === "right" ? W * 0.78 : W * 0.5;
      const startY = cue.type === "jump" ? -50 : H * 0.34;
      const targetY = cue.type === "jump" ? H * 0.19 : py - pry * 2.3;
      const y = lerp(startY, targetY, clamp(1 - lead / 2.4, 0, 1));
      const alpha = clamp(1 - Math.max(0, lead - 2.0) / 0.6, 0, 1);
      const size = 42;
      const approaching = clamp(1 - Math.abs(lead) / 0.3, 0, 1);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      // 收缩光圈
      const ringR = 46 + Math.max(0, lead) * 34;
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = cue.type === "jump" ? "#ffd166" : "#8ef0ff";
      ctx.globalAlpha = alpha * clamp(1.2 - lead / 2.4, 0, 1) * 0.75;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.globalAlpha = alpha;

      const sc = 1 + approaching * 0.18;
      ctx.scale(sc, sc);
      ctx.rotate(cue.type === "left" ? -0.08 : cue.type === "right" ? 0.08 : 0);
      roundRect(ctx, -size, -size * 0.8, size * 2, size * 1.6, 18);
      const cg = ctx.createLinearGradient(0, -size, 0, size);
      cg.addColorStop(0, cue.type === "jump" ? "#ffd166" : "#f6f3e9");
      cg.addColorStop(1, cue.type === "jump" ? "#f39c12" : "#dcd5c1");
      ctx.fillStyle = cg;
      ctx.fill();
      ctx.strokeStyle = "#10201b";
      ctx.lineWidth = 5;
      ctx.stroke();

      // 箭头
      ctx.save();
      ctx.translate(0, -size * 0.24);
      ctx.fillStyle = "#10201b";
      ctx.beginPath();
      if (cue.type === "left") {
        ctx.moveTo(-26, 0); ctx.lineTo(6, -18); ctx.lineTo(6, -8); ctx.lineTo(26, -8);
        ctx.lineTo(26, 8); ctx.lineTo(6, 8); ctx.lineTo(6, 18);
      } else if (cue.type === "right") {
        ctx.moveTo(26, 0); ctx.lineTo(-6, -18); ctx.lineTo(-6, -8); ctx.lineTo(-26, -8);
        ctx.lineTo(-26, 8); ctx.lineTo(-6, 8); ctx.lineTo(-6, 18);
      } else {
        ctx.moveTo(0, -24); ctx.lineTo(20, 2); ctx.lineTo(8, 2); ctx.lineTo(8, 22);
        ctx.lineTo(-8, 22); ctx.lineTo(-8, 2); ctx.lineTo(-20, 2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.font = '900 22px "KuaiLe","MiSans","PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.fillStyle = "#10201b";
      ctx.fillText(cueWord(cue), 0, size * 0.66);
      ctx.restore();
    }

    // 人物
    if (f && f.ok) {
      const k = fitScale(f.bodyScale, H, 0.66);
      ctx.save();
      if (k < 0.99 && f.hip) {
        ctx.translate(f.hip.x, f.hip.y);
        ctx.scale(k, k);
        ctx.translate(-f.hip.x, -f.hip.y);
      }
      drawAvatar(ctx, f.pts, {
        palette: PAL,
        alpha: 0.97,
        inkW: Math.max(3, (f.bodyScale || 120) * 0.045),
      });
      ctx.restore();
    } else {
      drawAvatar(ctx, standingJoints(W / 2, H * 0.86, Math.min(H * 0.5, W * 0.55)), {
        palette: PAL,
        alpha: 0.26,
        showFace: false,
        inkW: 4,
      });
    }

    S.parts.draw(ctx);

    for (const p of S.pops) {
      const a = clamp(1 - p.t / 0.9, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(p.x, p.y);
      const sc = 1 + Math.max(0, 0.25 - p.t) * 1.2;
      ctx.scale(sc, sc);
      ctx.font = '900 26px "KuaiLe","MiSans","PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.lineWidth = 7;
      ctx.strokeStyle = "#10201b";
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      if (p.sub) {
        ctx.font = '900 17px "KuaiLe","MiSans","PingFang SC",sans-serif';
        ctx.strokeText(p.sub, 0, 24);
        ctx.fillStyle = "#fffaf0";
        ctx.fillText(p.sub, 0, 24);
      }
      ctx.restore();
    }

    // 连击
    if (S.combo >= 3) {
      ctx.save();
      ctx.translate(W / 2, H * 0.14);
      ctx.font = '900 22px "KuaiLe","MiSans","PingFang SC",sans-serif';
      ctx.textAlign = "center";
      ctx.lineWidth = 7;
      ctx.strokeStyle = "#10201b";
      const txt = `${S.combo} 连击 ×${(1 + Math.min(20, S.combo - 1) * 0.03).toFixed(2)}`;
      ctx.strokeText(txt, 0, 0);
      ctx.fillStyle = "#ffd166";
      ctx.fillText(txt, 0, 0);
      ctx.restore();
    }

    // 没识别到
    if (!f || !f.ok) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.font = '800 17px "KuaiLe","MiSans","PingFang SC",sans-serif';
      ctx.fillStyle = "#fffaf0";
      ctx.textAlign = "center";
      ctx.fillText("往后退一点，让头和脚都进画面", W / 2, H * 0.2);
      ctx.restore();
    }
  },

  pause() {
    if (S?.music) S.music.stop();
  },

  resume() {
    if (S?.music) S.music.start();
  },

  finish() {
    const s = S || blank();
    const totalCues = s.perfect + s.good + s.miss;
    const acc = totalCues ? Math.round(((s.perfect + s.good) / totalCues) * 100) : 0;
    const perfectRate = totalCues ? Math.round((s.perfect / totalCues) * 100) : 0;
    const avgErr = s.errN ? Math.round((s.errSum / s.errN) * 1000) : 0;
    const lr = s.hitsLeft + s.hitsRight;
    const balance = lr ? 1 - Math.abs(s.hitsLeft - s.hitsRight) / lr : 0.5;
    const stars = s.score >= 4200 ? 3 : s.score >= 2600 ? 2 : 1;

    if (s.music) s.music.stop();

    return {
      score: s.score,
      stars,
      headline: stars === 3 ? "节奏小达人！" : stars === 2 ? "踩得挺准！" : "动起来就对了",
      desc: stars === 3
        ? "左右和起跳都跟上了鼓点，身体两边配合得很好。"
        : stars === 2
          ? "大部分指令都跟上了，再留意一下起跳的时机。"
          : "刚开始跟不上很正常，先跟着「左、右」两个指令慢慢来。",
      rows: [
        { label: "踩准指令", value: `${s.perfect + s.good} / ${totalCues}` },
        { label: "完美率", value: `${perfectRate}%` },
        { label: "平均误差", value: avgErr ? `${avgErr} 毫秒` : "—" },
        { label: "最高连击", value: `${s.bestCombo} 次` },
        { label: "起跳次数", value: `${s.jumps} 次` },
      ],
      sensory: [
        { label: "前庭与平衡", value: clamp(s.jumps / 8, 0.05, 1) },
        { label: "双侧协调", value: clamp(balance * 0.7 + acc / 100 * 0.5, 0.05, 1) },
        { label: "节奏感", value: clamp(perfectRate / 100, 0.05, 1) },
      ],
      tip: balance < 0.6
        ? "小提示：孩子好像更习惯往一边跳。可以在那一侧脚下贴个胶带，让他试着「踩线」往另一边够。"
        : "小提示：把音乐调小一点、鼓点留着，让孩子闭眼听一拍再动，能练听觉和动作的连接。",
    };
  },
};
