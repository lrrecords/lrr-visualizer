// Decodes an audio file with ffmpeg and turns it into per-video-frame features:
// bass / mid / high energy (0..1), overall level, a kick envelope, a 64-band
// spectrum and a short waveform snapshot. All analysis happens up front in Node,
// so rendering is deterministic and never depends on real-time playback.

const { spawn } = require('child_process');
const { ffmpegPath } = require('./ffmpeg');

const SAMPLE_RATE = 44100;
const FFT_SIZE = 2048;
const SPECTRUM_BANDS = 64;
const WAVE_POINTS = 128;

const BANDS = {
  bass: [20, 250],
  mid: [250, 4000],
  high: [4000, 16000],
};

function decodeAudio(file) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-'];
    const ff = spawn(ffmpegPath(), args);
    const chunks = [];
    let err = '';
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.stderr.on('data', (d) => (err += d));
    ff.on('error', (e) => reject(new Error(`Could not start ffmpeg (${e.message}).`)));
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Could not read the audio file "${file}".\n${err.trim()}`));
      const buf = Buffer.concat(chunks);
      const usable = buf.length - (buf.length % 4);
      const samples = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + usable));
      if (samples.length < SAMPLE_RATE / 10) return reject(new Error(`"${file}" has no audio (or is too short).`));
      resolve(samples);
    });
  });
}

function makeFFT(n) {
  const levels = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j;
          const b = a + half;
          const tre = re[b] * cos[k] + im[b] * sin[k];
          const tim = -re[b] * sin[k] + im[b] * cos[k];
          re[b] = re[a] - tre;
          im[b] = im[a] - tim;
          re[a] += tre;
          im[a] += tim;
        }
      }
    }
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

// Map dB values onto 0..1 using the track's own quiet (p10) and loud (p98) points,
// so quiet masters and loud masters both move the visuals across the full range.
function normalizeDb(values, lo = 0.1, hi = 0.98, minRange = 9) {
  const sorted = Float64Array.from(values).sort();
  const floor = percentile(sorted, lo);
  const ceil = Math.max(percentile(sorted, hi), floor + minRange);
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    out[i] = Math.min(1, Math.max(0, (values[i] - floor) / (ceil - floor)));
  }
  return out;
}

// Attack/release envelope follower, scaled so it feels the same at any frame rate.
function envelope(values, fps, attack, release) {
  const a = 1 - Math.pow(1 - attack, 30 / fps);
  const r = 1 - Math.pow(1 - release, 30 / fps);
  const out = new Float32Array(values.length);
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    s += (v - s) * (v > s ? a : r);
    out[i] = s;
  }
  return out;
}

function analyze(samples, fps) {
  const sr = SAMPLE_RATE;
  const duration = samples.length / sr;
  const frameCount = Math.max(1, Math.ceil(duration * fps));
  const fft = makeFFT(FFT_SIZE);
  const half = FFT_SIZE / 2;
  const binHz = sr / FFT_SIZE;
  const hann = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));

  const bandBins = {};
  for (const [name, [lo, hi]] of Object.entries(BANDS)) {
    bandBins[name] = [Math.max(1, Math.floor(lo / binHz)), Math.min(half - 1, Math.ceil(hi / binHz))];
  }
  // Log-spaced spectrum bands from 30 Hz to 16 kHz.
  const specEdges = [];
  for (let b = 0; b <= SPECTRUM_BANDS; b++) {
    const hz = 30 * Math.pow(16000 / 30, b / SPECTRUM_BANDS);
    specEdges.push(Math.min(half - 1, Math.max(1, Math.round(hz / binHz))));
  }

  let peak = 1e-6;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }

  const raw = { bass: new Float64Array(frameCount), mid: new Float64Array(frameCount), high: new Float64Array(frameCount), level: new Float64Array(frameCount) };
  const specDb = Array.from({ length: SPECTRUM_BANDS }, () => new Float64Array(frameCount));
  const waves = new Array(frameCount);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const power = new Float64Array(half);
  const waveStep = FFT_SIZE / WAVE_POINTS;

  for (let f = 0; f < frameCount; f++) {
    const center = Math.round((f / fps) * sr);
    const start = center - half;
    let sumSq = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = start + i;
      const s = idx >= 0 && idx < samples.length ? samples[idx] : 0;
      sumSq += s * s;
      re[i] = s * hann[i];
      im[i] = 0;
    }
    const wave = new Array(WAVE_POINTS);
    for (let w = 0; w < WAVE_POINTS; w++) {
      const idx = start + Math.floor(w * waveStep);
      const s = idx >= 0 && idx < samples.length ? samples[idx] : 0;
      wave[w] = Math.round((s / peak) * 1000) / 1000;
    }
    waves[f] = wave;

    fft(re, im);
    for (let k = 0; k < half; k++) power[k] = re[k] * re[k] + im[k] * im[k];

    for (const name of Object.keys(BANDS)) {
      const [lo, hi] = bandBins[name];
      let sum = 0;
      for (let k = lo; k <= hi; k++) sum += power[k];
      raw[name][f] = 10 * Math.log10(sum / (hi - lo + 1) + 1e-12);
    }
    raw.level[f] = 10 * Math.log10(sumSq / FFT_SIZE + 1e-12);
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
      const lo = specEdges[b];
      const hi = Math.max(lo, specEdges[b + 1]);
      let sum = 0;
      for (let k = lo; k <= hi; k++) sum += power[k];
      specDb[b][f] = 10 * Math.log10(sum / (hi - lo + 1) + 1e-12);
    }
  }

  const bassN = normalizeDb(raw.bass);
  const midN = normalizeDb(raw.mid);
  const highN = normalizeDb(raw.high);
  const levelN = normalizeDb(raw.level);
  const specN = specDb.map((band) => envelope(normalizeDb(band, 0.1, 0.99, 12), fps, 0.55, 0.2));

  // Emphasise peaks a little so the visuals breathe instead of sitting at "medium".
  const shape = (arr, gamma) => arr.map((v) => Math.pow(v, gamma));
  const bass = envelope(shape(bassN, 1.6), fps, 0.75, 0.18);
  const mid = envelope(shape(midN, 1.4), fps, 0.6, 0.15);
  const high = envelope(shape(highN, 1.3), fps, 0.8, 0.25);
  const level = envelope(levelN, fps, 0.5, 0.1);

  // Kick / beat detection: positive jumps in bass energy above a moving threshold.
  const flux = new Float64Array(frameCount);
  for (let f = 1; f < frameCount; f++) flux[f] = Math.max(0, bassN[f] - bassN[f - 1]);
  const win = Math.max(4, Math.round(fps));
  const minGap = Math.round(fps * 0.22);
  const kickDecay = Math.pow(0.86, 30 / fps);
  const beat = new Uint8Array(frameCount);
  const kick = new Float32Array(frameCount);
  let lastBeat = -minGap;
  let k = 0;
  for (let f = 0; f < frameCount; f++) {
    const from = Math.max(0, f - win);
    let mean = 0;
    let sq = 0;
    for (let i = from; i < f; i++) { mean += flux[i]; sq += flux[i] * flux[i]; }
    const n = Math.max(1, f - from);
    mean /= n;
    const std = Math.sqrt(Math.max(0, sq / n - mean * mean));
    if (flux[f] > 0.07 && flux[f] > mean + 1.5 * std && f - lastBeat >= minGap) {
      beat[f] = 1;
      lastBeat = f;
      k = 1;
    } else {
      k *= kickDecay;
    }
    kick[f] = k;
  }

  const r3 = (v) => Math.round(v * 1000) / 1000;
  const frames = new Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    frames[f] = {
      i: f,
      t: r3(f / fps),
      bass: r3(bass[f]),
      mid: r3(mid[f]),
      high: r3(high[f]),
      level: r3(level[f]),
      kick: r3(kick[f]),
      beat: beat[f] === 1,
      spectrum: Array.from({ length: SPECTRUM_BANDS }, (_, b) => Math.round(specN[b][f] * 100) / 100),
      wave: waves[f],
    };
  }

  return { duration, fps, frames };
}

// Finds the most energetic stretch of the track — used to pick a default clip
// for the vertical (Shorts/Reels) version and for previews.
function findHighlight(analysis, lengthSec) {
  const { frames, fps, duration } = analysis;
  const len = Math.round(lengthSec * fps);
  if (lengthSec >= duration || len >= frames.length) return 0;
  const score = frames.map((fr) => fr.level * 0.5 + fr.bass * 0.35 + fr.kick * 0.15);
  let sum = 0;
  for (let i = 0; i < len; i++) sum += score[i];
  let best = sum;
  let bestStart = 0;
  for (let i = len; i < frames.length; i++) {
    sum += score[i] - score[i - len];
    if (sum > best) { best = sum; bestStart = i - len + 1; }
  }
  // Nudge the start onto a nearby beat so the clip opens on a hit.
  for (let d = 0; d < fps; d++) {
    if (frames[bestStart + d] && frames[bestStart + d].beat) { bestStart += d; break; }
  }
  return Math.min(bestStart / fps, Math.max(0, duration - lengthSec));
}

async function analyzeFile(file, fps) {
  const samples = await decodeAudio(file);
  return analyze(samples, fps);
}

module.exports = { analyzeFile, findHighlight };
