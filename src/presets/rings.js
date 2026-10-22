// WAVEFORM RINGS
// Inner rings  -> shaped by the low end (spectrum + waveform) and swell with the bass.
// Middle rings -> shaped by the mid frequencies of the spectrum.
// Outer rings  -> shaped by the high frequencies, flicker with the highs.
// Kicks        -> the whole shape pulses and throws out a shockwave ring.
LRR.presets.rings = {
  label: 'Waveform rings',
  palette: { bg: '#05050a', bass: '#7b2ff7', mid: '#f107a3', high: '#00e5ff' },

  setup(p, env) {
    env.state.shocks = [];
    env.state.spin = 0;
  },

  draw(p, a, env) {
    const { width: w, height: h, unit: S, colors } = env;
    const st = env.state;
    const ctx = p.drawingContext;
    const { rgba, mix } = LRR.util;
    const cx = w / 2;
    const cy = h / 2;
    const POINTS = 200;
    const RINGS = 9;

    // Fade the previous frame for short motion trails.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(colors.bg, 0.6);
    ctx.fillRect(0, 0, w, h);

    st.spin += (0.002 + a.mid * 0.01) * (30 / env.fps);
    const pulse = 1 + a.kick * 0.07 + a.bass * 0.05;

    ctx.lineJoin = 'round';

    for (let r = 0; r < RINGS; r++) {
      const zone = r < 3 ? 'bass' : r < 6 ? 'mid' : 'high';
      const energy = a[zone];
      const base = S * (0.1 + r * 0.038) * pulse;
      const amp = S * (zone === 'bass' ? 0.035 : zone === 'mid' ? 0.035 : 0.025) * (0.3 + energy * 1.2);
      const color = mix(colors[zone], colors.bg, (r % 3) * 0.18);
      const dir = r % 2 === 0 ? 1 : -1;
      const rot = st.spin * dir * (1 + r * 0.15);

      ctx.beginPath();
      for (let i = 0; i <= POINTS; i++) {
        const u = i / POINTS; // 0..1 around the circle
        const m = u < 0.5 ? u * 2 : (1 - u) * 2; // mirrored so the loop closes smoothly
        let d;
        if (zone === 'bass') {
          const wv = a.wave[Math.min(a.wave.length - 1, Math.floor(m * (a.wave.length - 1)))];
          d = (a.spectrum[Math.floor(m * 15)] - 0.3) * 0.75 + wv * 0.35;
        } else {
          const lo = zone === 'mid' ? 16 : 40;
          const idx = lo + Math.floor(m * 23);
          d = a.spectrum[idx] - 0.3;
        }
        const rad = base + d * amp;
        const ang = u * Math.PI * 2 + rot;
        const x = cx + Math.cos(ang) * rad;
        const y = cy + Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      // Soft additive glow pass, then a crisp line in its true colour.
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = S * (0.014 + energy * 0.01);
      ctx.strokeStyle = rgba(color, 0.05 + energy * 0.1);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = S * (0.003 + energy * 0.003);
      ctx.strokeStyle = rgba(color, 0.35 + energy * 0.5);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'lighter';
    // Shockwaves on kicks.
    if (a.beat) st.shocks.push({ r: S * 0.1 * pulse, alpha: 0.8 });
    st.shocks = st.shocks.filter((s) => {
      s.r += S * 0.012 * (30 / env.fps);
      s.alpha *= Math.pow(0.92, 30 / env.fps);
      ctx.lineWidth = S * 0.003;
      ctx.strokeStyle = rgba(colors.bass, s.alpha);
      ctx.beginPath();
      ctx.arc(cx, cy, s.r, 0, Math.PI * 2);
      ctx.stroke();
      return s.alpha > 0.03;
    });

    // Centre glow.
    const coreR = S * (0.06 + a.bass * 0.05);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    g.addColorStop(0, rgba(mix(colors.bass, colors.mid, 0.4), 0.2 + a.kick * 0.3));
    g.addColorStop(1, rgba(colors.bass, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - coreR, cy - coreR, coreR * 2, coreR * 2);
    ctx.globalCompositeOperation = 'source-over';
  },
};
