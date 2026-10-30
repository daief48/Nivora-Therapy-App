// Procedurally synthesizes seamlessly-looping ambient WAVs (mono, 16-bit, 22.05 kHz) into assets/sounds.
// Run: node scripts/gen-sounds.cjs   (no dependencies; output is deterministic)
const fs = require('fs');
const path = require('path');

const SR = 22050;
const SECS = 24;
const N = SR * SECS;
const XF = SR * 3; // crossfade length (samples) that makes the loop seamless
const OUT = path.join(__dirname, '..', 'assets', 'sounds');

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const TAU = Math.PI * 2;

/** One-pole filters over a buffer. */
const lowpass = (x, fc) => { const a = 1 - Math.exp(-TAU * fc / SR); let y = 0; return x.map((v) => (y += a * (v - y))); };
const highpass = (x, fc) => { const lp = lowpass(x, fc); return x.map((v, i) => v - lp[i]); };

/** Generate N+XF samples with fn, then fold the tail into the head so the loop has no seam. */
function loopable(fn) {
  const g = fn(N + XF);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = g[i + 0];
  for (let i = 0; i < XF; i++) {
    const a = i / XF; // 0 -> tail only, 1 -> head only (equal-power)
    out[i] = g[i] * Math.sin(a * Math.PI / 2) + g[N + i] * Math.cos(a * Math.PI / 2);
  }
  return out;
}

const white = (r, n) => Float32Array.from({ length: n }, () => r() * 2 - 1);

function rain(n) {
  const r = rng(11);
  const base = highpass(lowpass(white(r, n), 7000), 900);
  const hiss = lowpass(white(r, n), 400).map((v) => v * 0.6); // distant low patter
  const out = Float32Array.from(base, (v, i) => v * 0.9 + hiss[i] * 0.5);
  // droplets: short decaying sine pings
  const drops = Math.floor(n / SR * 22);
  for (let d = 0; d < drops; d++) {
    const at = Math.floor(r() * (n - 2000)), f = 1800 + r() * 3200, amp = 0.05 + r() * 0.12, dec = 120 + r() * 220;
    for (let k = 0; k < 1500; k++) out[at + k] += Math.sin(TAU * f * k / SR) * Math.exp(-k / dec) * amp;
  }
  return out;
}

function ocean(n) {
  const r = rng(23);
  const w = white(r, n);
  const slow = lowpass(w, 600), mid = lowpass(w, 2200);
  return Float32Array.from(slow, (v, i) => {
    const t = i / SR;
    const swell = 0.5 + 0.5 * Math.sin(TAU * t / 8 - 1.2); // ~8 s wave cycle
    const swell2 = 0.5 + 0.5 * Math.sin(TAU * t / 12 + 0.7);
    const env = Math.pow(0.15 + 0.85 * (0.65 * swell + 0.35 * swell2), 1.6);
    return v * 1.6 * (0.35 + env * 0.65) + (mid[i] - v) * env * 0.7;
  });
}

function forest(n) {
  const r = rng(37);
  const w = white(r, n);
  const wind = lowpass(highpass(w, 180), 1100);
  const out = Float32Array.from(wind, (v, i) => v * (0.25 + 0.2 * Math.sin(TAU * i / SR / 9) + 0.12 * Math.sin(TAU * i / SR / 5.3 + 2)));
  // gentle, sparse bird-like chirps (short rising sine glides)
  const chirps = Math.floor(n / SR / 2.6);
  for (let c = 0; c < chirps; c++) {
    const at = Math.floor(r() * (n - 9000)), f0 = 2300 + r() * 1400, rise = 400 + r() * 900, len = 1800 + Math.floor(r() * 2400), amp = 0.04 + r() * 0.05;
    const reps = 1 + Math.floor(r() * 3);
    let ph = 0;
    for (let rp = 0; rp < reps; rp++) {
      for (let k = 0; k < len; k++) {
        ph += TAU * (f0 + rise * (k / len)) / SR;
        out[at + rp * (len + 1200) + k] += Math.sin(ph) * Math.sin(Math.PI * k / len) * amp;
      }
    }
  }
  return out;
}

function brown(n) {
  const r = rng(51);
  let y = 0;
  const raw = Float32Array.from({ length: n }, () => (y = (y + (r() * 2 - 1) * 0.04) * 0.998));
  return highpass(raw, 30).map((v) => v * 4);
}

function drone(n) {
  const notes = [[110, 0.5], [164.81, 0.32], [220, 0.28], [277.18, 0.14], [329.63, 0.1]]; // A minor-ish open pad
  return Float32Array.from({ length: n }, (_, i) => {
    const t = i / SR;
    let s = 0;
    notes.forEach(([f, a], k) => {
      const detune = 1 + 0.0015 * Math.sin(TAU * t / (11 + k * 3));
      s += Math.sin(TAU * f * detune * t + k) * a * (0.75 + 0.25 * Math.sin(TAU * t / (6 + k * 2.5) + k));
    });
    return s * (0.8 + 0.2 * Math.sin(TAU * t / 8));
  });
}

function writeWav(name, data) {
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const k = 0.8 / (peak || 1);
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + data.length * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(data.length * 2, 40);
  data.forEach((v, i) => buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * k * 32767))), 44 + i * 2));
  fs.writeFileSync(path.join(OUT, name + '.wav'), buf);
  console.log(name, (buf.length / 1024 / 1024).toFixed(2), 'MB');
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, fn] of Object.entries({ rain, ocean, forest, brown, drone })) writeWav(name, loopable(fn));
