// ===== Theme toggle (persists to localStorage, respects system) =====
(function () {
  const root = document.documentElement;
  const toggle = document.getElementById("themeToggle");
  const icon = toggle.querySelector(".theme-toggle__icon");

  const stored = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const initial = stored || (prefersDark ? "dark" : "light");
  setTheme(initial);

  function setTheme(mode) {
    root.setAttribute("data-theme", mode);
    icon.textContent = mode === "dark" ? "☀️" : "🌙";
  }

  toggle.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
  });
})();

// ===== Sticky nav shadow + mobile menu =====
(function () {
  const nav = document.getElementById("nav");
  const burger = document.getElementById("navBurger");
  const links = document.getElementById("navLinks");

  window.addEventListener("scroll", () => {
    nav.classList.toggle("scrolled", window.scrollY > 8);
  });

  burger.addEventListener("click", () => {
    burger.classList.toggle("open");
    links.classList.toggle("open");
  });

  links.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      burger.classList.remove("open");
      links.classList.remove("open");
    })
  );
})();

// ===== Scroll reveal + active nav link (IntersectionObserver) =====
(function () {
  const revealEls = document.querySelectorAll(".reveal");
  const revealObs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          revealObs.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  revealEls.forEach((el) => revealObs.observe(el));

  const sections = document.querySelectorAll("section[id]");
  const navLinks = document.querySelectorAll(".nav__links a");
  const spyObs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          const id = e.target.getAttribute("id");
          navLinks.forEach((l) =>
            l.classList.toggle("active", l.getAttribute("href") === "#" + id)
          );
        }
      });
    },
    { rootMargin: "-45% 0px -50% 0px" }
  );
  sections.forEach((s) => spyObs.observe(s));
})();

// ===== Contact form (client-side validation demo) =====
(function () {
  const form = document.getElementById("contactForm");
  const note = document.getElementById("formNote");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const message = form.message.value.trim();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (!name || !email || !message) {
      show("Please fill in all fields.", "error");
      return;
    }
    if (!emailOk) {
      show("Please enter a valid email address.", "error");
      return;
    }
    // No backend yet — this is a front-end demo. Wire up to a form service
    // (Formspree, Netlify Forms, your own API) to actually send messages.
    show(`Thanks, ${name}! This is a demo form — connect a backend to send for real.`, "success");
    form.reset();
  });

  function show(msg, type) {
    note.textContent = msg;
    note.className = "contact__note " + type;
  }
})();

// ===== Footer year =====
document.getElementById("year").textContent = new Date().getFullYear();
