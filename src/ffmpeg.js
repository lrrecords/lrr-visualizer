const fs = require('fs');

// Prefer an explicit override, then the bundled ffmpeg-static binary, then whatever is on PATH.
function ffmpegPath() {
  if (process.env.LRR_FFMPEG) return process.env.LRR_FFMPEG;
  try {
    const bundled = require('ffmpeg-static');
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch (_) {
    // not installed — fall through to PATH
  }
  return 'ffmpeg';
}

module.exports = { ffmpegPath };
