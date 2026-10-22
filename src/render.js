// Drives headless Chrome (via Puppeteer) to draw each frame with p5.js and
// streams the frames straight into ffmpeg, which muxes them with the audio.

const path = require('path');
const fs = require('fs');
const { once } = require('events');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const { ffmpegPath } = require('./ffmpeg');

const PRESETS = {
  particles: 'Particles',
  rings: 'Waveform rings',
  fields: 'Colour fields',
};

const BATCH = 6; // frames per browser round-trip
const WARMUP_SECONDS = 2; // let particles/trails build up before a clip starts

async function launchBrowser() {
  const args = ['--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio'];
  if (process.platform === 'linux' && process.getuid && process.getuid() === 0) args.push('--no-sandbox');
  return puppeteer.launch({
    headless: true,
    executablePath: process.env.LRR_CHROME || undefined,
    args,
    protocolTimeout: 0,
  });
}

function startEncoder({ out, audioFile, fps, start, length, songDuration }) {
  const fadeOutAt = Math.max(0, length - 1);
  const vf = [`fade=t=in:st=0:d=0.5`, `fade=t=out:st=${fadeOutAt.toFixed(3)}:d=1`];
  const af = [];
  if (start > 0.05) af.push('afade=t=in:st=0:d=0.3');
  if (start + length < songDuration - 0.05) af.push(`afade=t=out:st=${fadeOutAt.toFixed(3)}:d=1`);

  const args = [
    '-y', '-v', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-ss', start.toFixed(3), '-t', length.toFixed(3), '-i', audioFile,
    '-map', '0:v:0', '-map', '1:a:0',
    '-vf', vf.join(','),
    ...(af.length ? ['-af', af.join(',')] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-g', String(Math.max(1, Math.round(fps / 2))), '-bf', '2', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '320k', '-ar', '48000',
    '-shortest', '-movflags', '+faststart',
    out,
  ];
  const ff = spawn(ffmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr.on('data', (d) => (err += d));
  ff.stdin.on('error', () => {}); // surfaced via the exit code below
  const done = new Promise((resolve, reject) => {
    ff.on('error', (e) => reject(new Error(`Could not start ffmpeg (${e.message}).`)));
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed while writing "${out}".\n${err.trim()}`))));
  });
  return { ff, done };
}

async function renderJob({ browser, analysis, audioFile, preset, width, height, start, length, out, palette, quality, seed, onProgress }) {
  const { fps, frames } = analysis;
  const page = await browser.newPage();
  let encoder = null;
  try {
    page.on('pageerror', (e) => console.error(`\n[${preset}] browser error: ${e.message}`));
    await page.setContent('<!doctype html><html><body style="margin:0;background:#000"></body></html>');
    await page.addScriptTag({ path: require.resolve('p5/lib/p5.min.js') });
    await page.addScriptTag({ path: path.join(__dirname, 'browser', 'harness.js') });
    await page.addScriptTag({ path: path.join(__dirname, 'presets', `${preset}.js`) });
    await page.evaluate((cfg) => window.lrrInit(cfg), { preset, width, height, fps, palette, seed });

    const first = Math.min(frames.length - 1, Math.round(start * fps));
    const last = Math.min(frames.length, first + Math.ceil(length * fps));
    const warmFrom = Math.max(0, first - Math.round(WARMUP_SECONDS * fps));

    for (let f = warmFrom; f < first; f += BATCH * 4) {
      const batch = frames.slice(f, Math.min(f + BATCH * 4, first));
      await page.evaluate((b) => { window.lrrRender(b, 0.1); }, batch);
    }

    fs.mkdirSync(path.dirname(out), { recursive: true });
    encoder = startEncoder({ out, audioFile, fps, start: first / fps, length: (last - first) / fps, songDuration: analysis.duration });
    const stdin = encoder.ff.stdin;
    let failed = false;
    encoder.done.catch(() => (failed = true));

    for (let f = first; f < last; f += BATCH) {
      if (failed) break;
      const batch = frames.slice(f, Math.min(f + BATCH, last));
      const images = await page.evaluate((b, q) => window.lrrRender(b, q), batch, quality);
      for (const img of images) {
        if (!stdin.write(Buffer.from(img, 'base64'))) await Promise.race([once(stdin, 'drain'), encoder.done.catch(() => {})]);
      }
      onProgress((f + batch.length - first) / (last - first));
    }
    stdin.end();
    await encoder.done;
  } catch (e) {
    if (encoder) encoder.ff.kill('SIGKILL');
    try { fs.unlinkSync(out); } catch (_) { /* nothing to clean up */ }
    throw e;
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { PRESETS, launchBrowser, renderJob };
