// COLOUR FIELDS
// Bass  -> two huge, slow clouds of colour that swell with the low end.
// Mids  -> three medium clouds that drift faster when the mids are busy.
// Highs -> small bright clouds plus film-grain shimmer.
// Kicks -> the whole field brightens for a moment.
LRR.presets.fields = {
  label: 'Colour fields',
  palette: { bg: '#0b0a1a', bass: '#ff6b35', mid: '#6a4cff', high: '#2ee6a6' },

  setup(p, env) {
    const blobs = [];
    const add = (band, count, size, speed) => {
      for (let i = 0; i < count; i++) {
        blobs.push({ band, size, speed, seedX: p.random(1000), seedY: p.random(1000), phase: 0 });
      }
    };
    add('bass', 2, 0.6, 0.05);
    add('mid', 3, 0.45, 0.11);
    add('high', 5, 0.22, 0.2);
    env.state.blobs = blobs;
  },

  draw(p, a, env) {
    const { width: w, height: h, unit: S, colors } = env;
    const ctx = p.drawingContext;
    const { rgba, mix } = LRR.util;
    const dt = 30 / env.fps;

    ctx.globalCompositeOperation = 'source-over';
    const bg = mix(colors.bg, colors.bass, a.level * 0.06);
    ctx.fillStyle = rgba(bg, 1);
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'screen';
    for (const b of env.state.blobs) {
      const energy = a[b.band];
      b.phase += b.speed * 0.03 * (0.3 + energy * 1.7 + a.mid * 0.4) * dt;
      // Blobs wander over the whole frame (a bit beyond, so edges stay alive).
      const x = w * (-0.1 + 1.2 * p.noise(b.seedX, b.phase));
      const y = h * (-0.1 + 1.2 * p.noise(b.seedY, b.phase + 50));
      const r = S * b.size * (0.6 + energy * 0.7 + a.kick * 0.12);
      const c = colors[b.band];
      const alpha = 0.24 + energy * 0.38 + a.kick * 0.08;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(mix(c, [255, 255, 255], energy * 0.12), Math.min(1, alpha)));
      g.addColorStop(0.45, rgba(c, alpha * 0.45));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // Kick flash.
    if (a.kick > 0.05) {
      ctx.fillStyle = rgba(colors.bass, a.kick * 0.07);
      ctx.fillRect(0, 0, w, h);
    }

    // Grain driven by the highs.
    ctx.globalCompositeOperation = 'source-over';
    const grains = Math.floor(400 + a.high * 2600);
    const gs = Math.max(1, S * 0.0018);
    for (let i = 0; i < grains; i++) {
      const v = p.random() < 0.5 ? 255 : 0;
      ctx.fillStyle = `rgba(${v},${v},${v},${0.05 + a.high * 0.1})`;
      ctx.fillRect(p.random(w), p.random(h), gs, gs);
    }

    // Vignette keeps the edges dark and the colour centred.
    const vg = ctx.createRadialGradient(w / 2, h / 2, S * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  },
};
