// PARTICLES
// Bass  -> how many particles burst from the centre, how fast, and the size of the core.
// Mids  -> how strongly the swirling "wind" pushes particles around.
// Highs -> particle sparkle/size and twinkling stars across the frame.
// Kicks -> big bursts and a flash ring.
LRR.presets.particles = {
  label: 'Particles',
  palette: { bg: '#07060f', bass: '#ff2e63', mid: '#08d9d6', high: '#f9f871' },

  setup(p, env) {
    env.state.particles = [];
    env.state.rings = [];
  },

  draw(p, a, env) {
    const { width: w, height: h, unit: S, colors } = env;
    const st = env.state;
    const ctx = p.drawingContext;
    const cx = w / 2;
    const cy = h / 2;
    const { rgba, mix } = LRR.util;

    // Fade the previous frame for motion trails.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(colors.bg, 0.18 + a.kick * 0.12);
    ctx.fillRect(0, 0, w, h);

    // Emit.
    const emit = Math.floor(3 + a.bass * 18 + (a.beat ? 90 : 0));
    const total = a.bass + a.mid + a.high + 0.001;
    for (let i = 0; i < emit && st.particles.length < 2600; i++) {
      const ang = p.random(p.TWO_PI);
      const speed = S * (0.003 + a.bass * 0.01 + (a.beat ? p.random(0.008, 0.022) : 0));
      const r = p.random(total);
      const band = r < a.bass ? 'bass' : r < a.bass + a.mid ? 'mid' : 'high';
      const life = p.random(60, 150) * (env.fps / 30);
      st.particles.push({
        x: cx + Math.cos(ang) * S * 0.05,
        y: cy + Math.sin(ang) * S * 0.05,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life,
        max: life,
        size: p.random(0.6, 1.6),
        color: colors[band],
      });
    }

    // Move + draw (additive blending for glow).
    ctx.globalCompositeOperation = 'lighter';
    const push = S * 0.00035 * (0.4 + a.mid * 2.6);
    const drag = Math.pow(0.975, 30 / env.fps);
    const sizeBase = S * 0.0045 * (0.7 + a.high * 1.5);
    const alive = [];
    for (const pt of st.particles) {
      const n = p.noise(pt.x * 0.0018, pt.y * 0.0018, a.t * 0.15);
      const ang = n * p.TWO_PI * 2;
      pt.vx = (pt.vx + Math.cos(ang) * push) * drag;
      pt.vy = (pt.vy + Math.sin(ang) * push) * drag;
      pt.x += pt.vx * (30 / env.fps);
      pt.y += pt.vy * (30 / env.fps);
      pt.life -= 1;
      if (pt.life <= 0 || pt.x < -50 || pt.x > w + 50 || pt.y < -50 || pt.y > h + 50) continue;
      alive.push(pt);
      const k = pt.life / pt.max;
      const sz = sizeBase * pt.size * (0.4 + k);
      ctx.fillStyle = rgba(pt.color, 0.55 * k);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, sz, 0, Math.PI * 2);
      ctx.fill();
    }
    st.particles = alive;

    // Twinkling stars from the highs.
    const stars = Math.floor(a.high * a.high * 70);
    ctx.fillStyle = rgba(mix(colors.high, [255, 255, 255], 0.5), 0.8);
    for (let i = 0; i < stars; i++) {
      const s = p.random(0.5, 2) * S * 0.0012;
      ctx.fillRect(p.random(w), p.random(h), s, s);
    }

    // Flash rings on kicks.
    if (a.beat) st.rings.push({ r: S * 0.06, alpha: 0.9 });
    ctx.lineWidth = S * 0.004;
    st.rings = st.rings.filter((ring) => {
      ring.r += S * 0.018 * (30 / env.fps);
      ring.alpha *= Math.pow(0.9, 30 / env.fps);
      ctx.strokeStyle = rgba(colors.bass, ring.alpha);
      ctx.beginPath();
      ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
      ctx.stroke();
      return ring.alpha > 0.03;
    });

    // Glowing core.
    const coreR = S * (0.035 + a.bass * 0.07 + a.kick * 0.04);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3);
    g.addColorStop(0, rgba(mix(colors.bass, [255, 255, 255], 0.3), 0.6));
    g.addColorStop(0.3, rgba(colors.bass, 0.3));
    g.addColorStop(1, rgba(colors.bass, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - coreR * 3, cy - coreR * 3, coreR * 6, coreR * 6);
    ctx.globalCompositeOperation = 'source-over';
  },
};
