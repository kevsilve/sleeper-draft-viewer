export function createRevealEffects({ canvas, lowPowerMode, reduceMotion }) {
  const ctx = canvas.getContext("2d");
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  resize();
  window.addEventListener("resize", resize);

  // Broadcast-style reveal burst: an expanding shockwave ring, radiating light
  // rays, and a soft rise of glowing embers — tuned to look sharp at full TV
  // scale without ever reading as "party confetti."
  let particles = [];
  let rings = [];
  let flashAlpha = 0;
  let revealAnimationRunning = false;
  let revealBurstToken = 0;

  function resetRevealBurst() {
    revealBurstToken++;
    particles = [];
    rings = [];
    flashAlpha = 0;
    revealAnimationRunning = false;
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function burstReveal(hex, originY) {
    if (reduceMotion) return;
    const token = revealBurstToken;
    hex = hex || "#ffcc33";
    const cx = canvas.width / 2;
    const cy = originY != null ? originY : canvas.height * 0.42;
    const scale = Math.max(1, canvas.width / 1600); // scale the burst up on bigger TV screens

    flashAlpha = Math.min(flashAlpha + (lowPowerMode ? 0.16 : 0.3), lowPowerMode ? 0.24 : 0.4);

    const ringCount = lowPowerMode ? 1 : 3;
    for (let i = 0; i < ringCount; i++) {
      rings.push({ x: cx, y: cy, radius: 6, alpha: 0.85, speed: (13 + i * 5) * scale, lineWidth: 3 * scale, delay: i * 5, color: hex, elapsed: 0 });
    }

    const rayCount = lowPowerMode ? (canvas.width < 900 ? 10 : 16) : (canvas.width < 900 ? 28 : 54);
    for (let i = 0; i < rayCount; i++) {
      const angle = (Math.PI * 2 * i) / rayCount + (Math.random() - 0.5) * 0.12;
      const speed = (Math.random() * 8 + 7) * scale;
      particles.push({
        type: "ray",
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        len: (Math.random() * 22 + 16) * scale,
        color: i % 3 === 0 ? "#ffffff" : hex,
        life: 0,
        maxLife: (lowPowerMode ? 30 : 42) + Math.random() * (lowPowerMode ? 8 : 16)
      });
    }

    const emberCount = lowPowerMode ? (canvas.width < 900 ? 6 : 10) : (canvas.width < 900 ? 18 : 40);
    for (let i = 0; i < emberCount; i++) {
      particles.push({
        type: "ember",
        x: cx + (Math.random() - 0.5) * 460 * scale,
        y: cy + 70 * scale + Math.random() * 70 * scale,
        vx: (Math.random() - 0.5) * 1.1,
        vy: -(Math.random() * 2.4 + 1.3) * scale,
        size: (Math.random() * 2.6 + 1.6) * scale,
        color: Math.random() < 0.55 ? hex : "#ffcc33",
        life: 0,
        maxLife: (lowPowerMode ? 60 : 110) + Math.random() * (lowPowerMode ? 30 : 70),
        flicker: Math.random() * Math.PI * 2
      });
    }
    if (!revealAnimationRunning) {
      revealAnimationRunning = true;
      requestAnimationFrame(() => animateReveal(token));
    }
  }

  function animateReveal(token = revealBurstToken) {
    if (reduceMotion) return;
    if (token !== revealBurstToken) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (flashAlpha > 0) {
      const g = ctx.createRadialGradient(canvas.width / 2, canvas.height * 0.42, 0, canvas.width / 2, canvas.height * 0.42, canvas.width * 0.55);
      g.addColorStop(0, `rgba(255,255,255,${flashAlpha})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      flashAlpha *= 0.82;
      if (flashAlpha < 0.01) flashAlpha = 0;
    }

    rings = rings.filter((r) => r.alpha > 0.01);
    rings.forEach((r) => {
      if (r.delay > 0) { r.delay--; return; }
      r.radius += r.speed;
      r.alpha *= 0.945;
      ctx.save();
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = r.alpha;
      ctx.lineWidth = r.lineWidth;
      ctx.shadowColor = r.color;
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });

    particles.forEach((p) => {
      p.life++;
      if (p.type === "ray") {
        const t = p.life / p.maxLife;
        p.x += p.vx * (1 - t * 0.5);
        p.y += p.vy * (1 - t * 0.5);
        const alpha = Math.max(0, 1 - t);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;
        ctx.lineWidth = 2.4;
        ctx.lineCap = "round";
        const mag = Math.hypot(p.vx, p.vy) || 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - (p.vx / mag) * p.len, p.y - (p.vy / mag) * p.len);
        ctx.stroke();
        ctx.restore();
      } else {
        p.vy += -0.002;
        p.x += p.vx + Math.sin(p.life * 0.08 + p.flicker) * 0.4;
        p.y += p.vy;
        const t = p.life / p.maxLife;
        const alpha = Math.max(0, 1 - t) * (0.6 + 0.4 * Math.sin(p.life * 0.3 + p.flicker));
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });
    particles = particles.filter((p) => p.life < p.maxLife);

    if (particles.length || rings.length || flashAlpha > 0) {
      requestAnimationFrame(() => animateReveal(token));
    } else {
      revealAnimationRunning = false;
    }
  }

  return { burstReveal, resetRevealBurst };
}
