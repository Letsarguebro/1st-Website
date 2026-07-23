# 1st-Website

My first website — a clean, responsive personal/portfolio site built with plain
HTML, CSS, and JavaScript. No build step, no dependencies.

## Features

- 🎨 Modern, responsive design (looks good on phone, tablet, desktop)
- 🌙 Dark / light mode toggle (remembers your choice, respects system setting)
- ✨ Smooth scroll-reveal animations and an active-section nav highlighter
- 📱 Mobile menu (hamburger)
- 📮 Contact form with client-side validation (demo — see note below)
- ♿ Respects `prefers-reduced-motion` for accessibility

## Structure

| File         | Purpose                                  |
| ------------ | ---------------------------------------- |
| `index.html` | Page content and structure               |
| `styles.css` | All styling and design tokens            |
| `script.js`  | Theme toggle, menu, animations, form     |

## Run it

It's a static site — just open `index.html` in your browser. Or serve it locally:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Make it yours

Everything is placeholder content, ready to customize:

- Search `index.html` for **"Your Name"** and replace it everywhere.
- Update the **About**, **Projects**, and **Contact** sections with real info.
- Change the brand colors in `styles.css` — edit `--primary` and `--primary-2`
  in the `:root` block at the top.
- The contact form is front-end only. To actually receive messages, connect it
  to a form service like [Formspree](https://formspree.io) or Netlify Forms
  (see the comment in `script.js`).

## Adding real product photos

Each product tile is image-ready. In `index.html` (top picks) or
`best-gaming-headsets.html` (ranked list), find a tile like:

```html
<div class="product__img">
  <!-- 📸 REAL PHOTO: delete the 🎧 below and paste your image ... -->
  🎧
</div>
```

Delete the emoji and drop in an image tag:

```html
<div class="product__img">
  <img src="https://link-to-the-product-photo.jpg" alt="Headset name" />
</div>
```

The photo auto-sizes to fill the tile. Use the images your affiliate program
provides (Amazon Associates gives you approved product images), or the brand's
official press photos.

## Deploy

Push to GitHub and enable **GitHub Pages** (Settings → Pages → deploy from
branch), or drag the folder onto [Netlify](https://netlify.com) /
[Vercel](https://vercel.com). It works anywhere static files are served.

<!-- deploy check: 2026-07-21T16:11:41Z -->
