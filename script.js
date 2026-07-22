// =========================================================
// Bright modern site — scroll interactions & niceties
// =========================================================
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ----- Animated space background: twinkling green/purple particles -----
(function () {
  const canvas = document.getElementById("bgCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  // green + purple lead, with a few cyan/white sparkles for depth
  const palette = ["#22ff9c", "#22ff9c", "#4ade80", "#a855f7", "#a855f7", "#7c3aed", "#22d3ee", "#e9d5ff"];
  // gaming-gear objects that float through the background
  const gear = ["🎧", "🎮", "⌨️", "🖱️", "🕹️", "🖥️", "👾", "🚀", "🎯", "💾"];
  let w, h, dpr, particles, floaters, raf, running = true, t = 0;

  function make() {
    const count = Math.min(200, Math.floor((innerWidth * innerHeight) / 8500));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.28 * dpr,
      vy: (Math.random() - 0.5) * 0.28 * dpr,
      r: (Math.random() * 2 + 0.9) * dpr,
      c: palette[(Math.random() * palette.length) | 0],
      ph: Math.random() * Math.PI * 2,       // twinkle phase
      tw: Math.random() * 0.05 + 0.015,      // twinkle speed
      base: Math.random() * 0.35 + 0.62,     // base brightness (brighter)
    }));

    const fcount = Math.min(16, Math.max(6, Math.floor((innerWidth * innerHeight) / 95000)));
    floaters = Array.from({ length: fcount }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.22 * dpr,
      vy: (Math.random() - 0.5) * 0.22 * dpr,
      size: (Math.random() * 30 + 26) * dpr,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.006,
      bob: Math.random() * Math.PI * 2,
      alpha: Math.random() * 0.14 + 0.12,
      e: gear[(Math.random() * gear.length) | 0],
    }));
  }

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width = Math.floor(innerWidth * dpr);
    h = canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    make();
  }

  function draw() {
    t++;
    ctx.clearRect(0, 0, w, h);
    const linkDist = 120 * dpr;

    // faint connecting lines (no glow — keeps it cheap)
    ctx.shadowBlur = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const dx = p.x - q.x, dy = p.y - q.y;
        const d = Math.hypot(dx, dy);
        if (d < linkDist) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = p.c;
          ctx.globalAlpha = (1 - d / linkDist) * 0.13;
          ctx.lineWidth = 1 * dpr;
          ctx.stroke();
        }
      }
    }

    // glowing, flickering particles
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < -20) p.x = w + 20; else if (p.x > w + 20) p.x = -20;
      if (p.y < -20) p.y = h + 20; else if (p.y > h + 20) p.y = -20;
      const flicker = p.base * (0.68 + 0.32 * Math.sin(t * p.tw + p.ph));
      ctx.globalAlpha = Math.max(0, Math.min(1, flicker));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.c;
      ctx.shadowColor = p.c;
      ctx.shadowBlur = p.r * 5.5;
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // floating gaming-gear objects
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < floaters.length; i++) {
      const f = floaters[i];
      f.x += f.vx; f.y += f.vy; f.rot += f.vrot; f.bob += 0.02;
      const m = f.size;
      if (f.x < -m) f.x = w + m; else if (f.x > w + m) f.x = -m;
      if (f.y < -m) f.y = h + m; else if (f.y > h + m) f.y = -m;
      ctx.save();
      ctx.translate(f.x, f.y + Math.sin(f.bob) * 6 * dpr);
      ctx.rotate(f.rot);
      ctx.globalAlpha = f.alpha;
      ctx.font = f.size + "px serif";
      ctx.fillText(f.e, 0, 0);
      ctx.restore();
    }

    ctx.globalAlpha = 1;
    if (running) raf = requestAnimationFrame(draw);
  }

  size();
  if (reduceMotion) { running = false; draw(); } // one static frame, no loop
  else { running = true; draw(); }

  let resizeT;
  addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(size, 200);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!reduceMotion) { running = true; draw(); }
  });
})();

// ----- Nav: solidify on scroll + scroll progress bar -----
(function () {
  const nav = document.getElementById("nav");
  const progress = document.getElementById("progress");

  function onScroll() {
    const y = window.scrollY;
    nav.classList.toggle("scrolled", y > 10);
    const docH = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = (docH > 0 ? (y / docH) * 100 : 0) + "%";
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();

// ----- Reveal on scroll (fade-up, reveal-scale, reveal-line) -----
(function () {
  const els = document.querySelectorAll(".fade-up, .reveal-scale, .reveal-line");
  if (reduceMotion) {
    els.forEach((el) => el.classList.add("in"));
    return;
  }
  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          obs.unobserve(e.target);
        }
      });
    },
    { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
  );
  els.forEach((el) => obs.observe(el));
})();

// ----- Parallax hero orbs (rAF, transform only) -----
(function () {
  if (reduceMotion) return;
  const orbs = document.querySelectorAll("[data-parallax]");
  if (!orbs.length) return;
  let latest = 0, ticking = false;

  function apply() {
    orbs.forEach((orb) => {
      const speed = parseFloat(orb.dataset.parallax);
      orb.style.transform = `translate3d(0, ${latest * speed}px, 0)`;
    });
    ticking = false;
  }
  window.addEventListener(
    "scroll",
    () => {
      latest = window.scrollY;
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(apply);
      }
    },
    { passive: true }
  );
})();

// ----- Subtle 3D tilt on work cards (pointer) -----
(function () {
  if (reduceMotion || window.matchMedia("(hover: none)").matches) return;
  document.querySelectorAll(".tilt").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `translateY(-6px) rotateX(${(-py * 6).toFixed(2)}deg) rotateY(${(px * 8).toFixed(2)}deg)`;
    });
    card.addEventListener("pointerleave", () => {
      card.style.transform = "";
    });
  });
})();

// ----- Contact form (client-side validation demo) -----
(function () {
  const form = document.getElementById("signupForm");
  const note = document.getElementById("formNote");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (!emailOk) return show("Please enter a valid email address.", "error");

    // Front-end demo only. Connect an email service (Mailchimp, ConvertKit,
    // Beehiiv, Buttondown) or Formspree/Netlify Forms to actually collect signups.
    show("You're on the list! (Demo — connect an email service to store signups.)", "success");
    form.reset();
  });

  function show(msg, type) {
    note.textContent = msg;
    note.className = "contact__note " + type;
  }
})();

// ----- Footer year -----
(function () {
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
})();
