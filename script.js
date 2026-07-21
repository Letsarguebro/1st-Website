// =========================================================
// Bright modern site — scroll interactions & niceties
// =========================================================
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
