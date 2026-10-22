// Runs inside the headless browser. Sets up a p5 sketch in instance mode and
// exposes two functions the Node side calls:
//   lrrInit(config)      -> creates the canvas and the chosen preset
//   lrrRender(frames, q) -> draws each frame and returns base64 JPEGs
(function () {
  window.LRR = window.LRR || { presets: {} };

  LRR.util = {
    rgb(hex) {
      const h = hex.replace('#', '');
      const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
      const n = parseInt(full, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },
    mix(a, b, t) {
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    },
    rgba(c, alpha) {
      return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
    },
  };

  let inst = null;
  let preset = null;
  let env = null;
  let current = null;

  window.lrrInit = function (cfg) {
    return new Promise((resolve, reject) => {
      preset = LRR.presets[cfg.preset];
      if (!preset) return reject(new Error(`Unknown preset "${cfg.preset}"`));
      const pal = Object.assign({}, preset.palette, cfg.palette || {});
      env = {
        width: cfg.width,
        height: cfg.height,
        fps: cfg.fps,
        unit: Math.min(cfg.width, cfg.height),
        palette: pal,
        colors: {
          bg: LRR.util.rgb(pal.bg),
          bass: LRR.util.rgb(pal.bass),
          mid: LRR.util.rgb(pal.mid),
          high: LRR.util.rgb(pal.high),
        },
        state: {},
      };
      inst = new p5((p) => {
        p.setup = () => {
          p.pixelDensity(1);
          const c = p.createCanvas(cfg.width, cfg.height);
          env.canvas = c.elt;
          p.noLoop();
          p.randomSeed(cfg.seed);
          p.noiseSeed(cfg.seed);
          const ctx = p.drawingContext;
          ctx.fillStyle = LRR.util.rgba(env.colors.bg, 1);
          ctx.fillRect(0, 0, cfg.width, cfg.height);
          preset.setup(p, env);
          resolve();
        };
        p.draw = () => {
          // Presets draw through the raw canvas context (gradients, blend modes).
          // p5 caches fill/stroke/blend state and would skip re-applying it, so
          // presets should not mix p.fill()/p.blendMode() with direct ctx calls.
          p.drawingContext.globalCompositeOperation = 'source-over';
          if (current) preset.draw(p, current, env);
        };
      });
    });
  };

  window.lrrRender = function (frames, quality) {
    const out = [];
    for (const f of frames) {
      current = f;
      inst.redraw();
      out.push(env.canvas.toDataURL('image/jpeg', quality).slice('data:image/jpeg;base64,'.length));
    }
    return out;
  };
})();
