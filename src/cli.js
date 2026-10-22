#!/usr/bin/env node
// LRR Visualizer — command-line entry point.
// Usage: node src/cli.js <song.wav|song.mp3|folder> [...more] [options]   (see --help)

const fs = require('fs');
const path = require('path');
const { analyzeFile, findHighlight } = require('./audio');
const { PRESETS, launchBrowser, renderJob } = require('./render');

const AUDIO_EXT = new Set(['.wav', '.mp3', '.flac', '.aif', '.aiff', '.m4a', '.ogg']);
const FORMATS = {
  youtube: { width: 1920, height: 1080, label: 'YouTube 1920x1080' },
  vertical: { width: 1080, height: 1920, label: 'Vertical 1080x1920' },
};
const PREVIEW_SECONDS = 15;

const HELP = `
LRR Visualizer — turn a song into an audio-reactive video.

  node src/cli.js <song or folder> [more songs...] [options]

Options
  --preset <name>          particles | rings | fields | all   (default: particles)
                           You can also list several: --preset rings,fields
  --format <name>          both | youtube | vertical           (default: both)
  --preview                Make quick ${PREVIEW_SECONDS}-second test clips instead of full videos
  --start <time>           YouTube version: start time, e.g. 45 or 1:20  (default: 0)
  --length <time>          YouTube version: length                       (default: whole song)
  --vertical-start <time>  Vertical version: start time, or "auto" to pick the
                           most energetic part of the song                (default: auto)
  --vertical-length <time> Vertical version: length, or "full"            (default: 60)
  --colors <list>          Your own colours: "bass,mids,highs" or "bass,mids,highs,background"
                           e.g. --colors "#ff0055,#00ffcc,#ffffff,#000000"
  --fps <n>                Frames per second, 24-60                       (default: 30)
  --quality <0-1>          Frame image quality before encoding            (default: 0.92)
  --jobs <n>               Videos to render at the same time              (default: 2)
  --out <folder>           Where to save videos                           (default: ./output)
  --seed <n>               Change the random pattern                      (default: 1)
  --list                   Show the available presets
  --help                   Show this help
`;

function fail(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

function parseTime(value, name) {
  if (value === undefined) fail(`${name} needs a value.`);
  const parts = String(value).trim().split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n) || n < 0)) fail(`${name}: "${value}" is not a time. Use seconds (45) or minutes:seconds (1:20).`);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function parseArgs(argv) {
  const opts = {
    inputs: [], presets: ['particles'], formats: ['youtube', 'vertical'], preview: false,
    start: 0, length: null, vStart: 'auto', vLength: 60, palette: null,
    fps: 30, quality: 0.92, jobs: 2, out: path.resolve(process.cwd(), 'output'), seed: 1,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '-h': case '--help': console.log(HELP); process.exit(0); break;
      case '--list':
        console.log('\nPresets:');
        for (const [k, v] of Object.entries(PRESETS)) console.log(`  ${k.padEnd(10)} ${v}`);
        console.log('');
        process.exit(0); break;
      case '-p': case '--preset': {
        const v = String(next() || '').toLowerCase();
        const list = v === 'all' ? Object.keys(PRESETS) : v.split(',').map((s) => s.trim()).filter(Boolean);
        for (const p of list) if (!PRESETS[p]) fail(`Unknown preset "${p}". Choose from: ${Object.keys(PRESETS).join(', ')}, all.`);
        if (!list.length) fail('--preset needs a value.');
        opts.presets = list;
        break;
      }
      case '-f': case '--format': {
        const v = String(next() || '').toLowerCase();
        if (v === 'both') opts.formats = ['youtube', 'vertical'];
        else if (FORMATS[v]) opts.formats = [v];
        else fail(`Unknown format "${v}". Choose youtube, vertical or both.`);
        break;
      }
      case '--preview': opts.preview = true; break;
      case '--start': opts.start = parseTime(next(), '--start'); break;
      case '--length': opts.length = parseTime(next(), '--length'); break;
      case '--vertical-start': {
        const v = next();
        opts.vStart = String(v).toLowerCase() === 'auto' ? 'auto' : parseTime(v, '--vertical-start');
        break;
      }
      case '--vertical-length': {
        const v = next();
        opts.vLength = String(v).toLowerCase() === 'full' ? null : parseTime(v, '--vertical-length');
        break;
      }
      case '--colors': case '--colours': {
        const list = String(next() || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (list.length < 3 || list.length > 4 || list.some((c) => !/^#?[0-9a-f]{6}$/i.test(c))) {
          fail('--colors needs 3 or 4 hex colours, e.g. "#ff0055,#00ffcc,#ffffff" (bass, mids, highs[, background]).');
        }
        const hex = list.map((c) => (c.startsWith('#') ? c : `#${c}`));
        opts.palette = { bass: hex[0], mid: hex[1], high: hex[2] };
        if (hex[3]) opts.palette.bg = hex[3];
        break;
      }
      case '--fps': opts.fps = Math.round(Number(next())); if (!(opts.fps >= 12 && opts.fps <= 60)) fail('--fps must be between 12 and 60.'); break;
      case '--quality': opts.quality = Number(next()); if (!(opts.quality > 0 && opts.quality <= 1)) fail('--quality must be between 0 and 1.'); break;
      case '--jobs': opts.jobs = Math.max(1, Math.round(Number(next())) || 1); break;
      case '--out': opts.out = path.resolve(next() || 'output'); break;
      case '--seed': opts.seed = Math.round(Number(next())) || 1; break;
      default:
        if (a.startsWith('-')) fail(`Unknown option "${a}". Run with --help to see options.`);
        opts.inputs.push(a);
    }
  }
  return opts;
}

function collectAudio(inputs) {
  const files = [];
  for (const input of inputs) {
    const p = path.resolve(input);
    if (!fs.existsSync(p)) fail(`Can't find "${input}".`);
    if (fs.statSync(p).isDirectory()) {
      for (const name of fs.readdirSync(p).sort()) {
        if (AUDIO_EXT.has(path.extname(name).toLowerCase())) files.push(path.join(p, name));
      }
    } else {
      files.push(p);
    }
  }
  return files;
}

function safeName(s) {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'song';
}

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function planClips(analysis, opts) {
  const dur = analysis.duration;
  const clamp = (start, len) => {
    const s = Math.min(Math.max(0, start), Math.max(0, dur - 0.5));
    return { start: s, length: Math.min(len ?? dur, dur - s) };
  };
  if (opts.preview) {
    const s = opts.start > 0 ? opts.start : findHighlight(analysis, PREVIEW_SECONDS);
    const c = clamp(s, PREVIEW_SECONDS);
    return { youtube: c, vertical: c };
  }
  const youtube = clamp(opts.start, opts.length);
  const vLen = opts.vLength ?? dur;
  const vStart = opts.vStart === 'auto' ? findHighlight(analysis, vLen) : opts.vStart;
  return { youtube, vertical: clamp(vStart, vLen) };
}

async function runPool(tasks, size) {
  let next = 0;
  const errors = [];
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      try { await task(); } catch (e) { errors.push(e); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
  return errors;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.inputs.length) { console.log(HELP); fail('Give me a song (WAV or MP3) or a folder of songs.'); }
  const files = collectAudio(opts.inputs);
  if (!files.length) fail('No audio files found (looking for .wav, .mp3, .flac, .aiff, .m4a, .ogg).');

  console.log(`\nLRR Visualizer — ${files.length} song(s), preset(s): ${opts.presets.join(', ')}${opts.preview ? '  [PREVIEW MODE]' : ''}`);
  const browser = await launchBrowser();
  const made = [];
  const allErrors = [];
  const t0 = Date.now();

  try {
    for (const file of files) {
      const song = path.basename(file, path.extname(file));
      console.log(`\n♪ ${song}`);
      process.stdout.write('  Listening to the track...');
      let analysis;
      try {
        analysis = await analyzeFile(file, opts.fps);
      } catch (e) {
        console.log('');
        console.error(`  ✗ Skipping this song: ${e.message.split('\n')[0]}`);
        allErrors.push(e);
        continue;
      }
      const beats = analysis.frames.filter((f) => f.beat).length;
      console.log(` done (${fmtTime(analysis.duration)} long, ${beats} kicks detected)`);

      const clips = planClips(analysis, opts);
      const progress = {};
      const jobs = [];
      for (const preset of opts.presets) {
        for (const fmt of opts.formats) {
          const { width, height, label } = FORMATS[fmt];
          const clip = clips[fmt];
          const suffix = opts.preview ? ' (preview)' : '';
          const out = path.join(opts.out, safeName(song), `${safeName(song)} - ${preset} - ${label}${suffix}.mp4`);
          const key = `${preset}/${fmt}`;
          progress[key] = 0;
          if (fmt === 'vertical' && clip.length > 180) {
            console.log(`  Note: the vertical version is ${fmtTime(clip.length)} long — YouTube Shorts and Reels allow up to 3:00.`);
          }
          console.log(`  • ${PRESETS[preset]} / ${label}: ${fmtTime(clip.start)} → ${fmtTime(clip.start + clip.length)}`);
          jobs.push(async () => {
            await renderJob({
              browser, analysis, audioFile: file, preset, width, height,
              start: clip.start, length: clip.length, out,
              palette: opts.palette, quality: opts.quality, seed: opts.seed,
              onProgress: (v) => (progress[key] = v),
            });
            progress[key] = 1;
            made.push(out);
          });
        }
      }

      const started = Date.now();
      const draw = () => {
        const vals = Object.values(progress);
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const elapsed = (Date.now() - started) / 1000;
        const eta = avg > 0.01 ? (elapsed / avg) * (1 - avg) : null;
        const bar = '█'.repeat(Math.round(avg * 30)).padEnd(30, '░');
        process.stdout.write(`\r  Rendering ${bar} ${(avg * 100).toFixed(0).padStart(3)}%  ${eta === null ? '' : `about ${fmtTime(eta)} left `}   `);
      };
      const timer = setInterval(draw, 1000);
      const errors = await runPool(jobs, opts.jobs);
      clearInterval(timer);
      draw();
      process.stdout.write('\n');
      for (const e of errors) console.error(`  ✗ ${e.message}`);
      allErrors.push(...errors);
    }
  } finally {
    await browser.close();
  }

  console.log(`\nFinished in ${fmtTime((Date.now() - t0) / 1000)}.`);
  if (made.length) {
    console.log('Your videos:');
    for (const m of made) console.log(`  ${m}`);
  }
  if (allErrors.length) process.exit(1);
}

main().catch((e) => fail(e.message));
