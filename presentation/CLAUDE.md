# presentation/ — slide deck

Plain HTML/CSS/JS deck. No framework, no build step: every file in this folder is published as-is to GitHub Pages by `.github/workflows/deploy-pages.yml` on push to `main`.

## Layout

```
index.html          shell: <head>, SVG icon sprite (#ic-*), empty #deck, section loader
css/deck.css        all styles; color tokens on :root, redefined for dark mode
js/charts-lib.js    shared SVG helpers, exposed as window.Charts
js/deck.js          presenter engine: keys, data-step reveals, notes, overview, theme
sections/NN-*.html  slide content — one file per section, most edits happen here
diagrams/*.html     interactive diagrams, embedded via <iframe>
demo.html           standalone demo page, linked from sections/06-demo.html
rate-limit-outline.md  lecture outline (source material, not rendered)
```

## How the page is assembled

1. The loader at the bottom of `index.html` fetches every name in the `SECTIONS` array and appends them to `#deck` **in array order** (the `NN-` filename prefix is cosmetic).
2. Inline `<script>` blocks from the sections are pulled out and executed after all slides are in the DOM.
3. `js/deck.js` loads last. It snapshots `.slide` elements and counts `data-step` nodes, so charts that create `data-step` nodes must run before it — keep this order.

Consequences:
- The deck needs HTTP. `file://` fails on `fetch`; the loader shows a hint. Don't "fix" this by inlining sections or wrapping HTML in JS — the user chose `.html` sections served over HTTP.
- All sections share one document: element `id`s must be unique across the whole deck.
- Relative URLs inside sections resolve against `index.html` (e.g. `diagrams/…`, not `../diagrams/…`).

## Slide conventions

```html
<section class="slide" data-section="kebab-slug">
  <div class="eyebrow"><svg class="ic"><use href="#ic-gauge"/></svg>Small line above the title</div>
  <h2>Slide title</h2>
  <!-- body: reuse existing layouts — split, card, points, tbl, code, chart, meter, stack -->
  <div class="notes"><p>Speaker notes, shown with N.</p></div>
  <div class="foot"><span>12 / 45</span><span>section label</span></div>
</section>
```

- Section files open with a divider slide: `class="slide divider"`, with `divider-num`, `section-tag`, `h2`, `lead`. Copy one from an existing section.
- Every slide has `.notes` and `.foot`. `deck.js` excludes both from the entrance stagger.
- **Footer page numbers (`12 / 45`) are hand-written.** Adding, removing or reordering slides means renumbering every later footer and the total on every slide. The HUD pager (bottom-right) is computed and needs no change.
- Step reveals: `data-step="1"`, `"2"`, … hidden until the presenter advances; unmarked elements show on entry. Keep numbers consecutive from 1.
- Animated numbers: `data-count="1000"` counts up when the slide becomes active (supported by `deck.js`, not used by any slide yet).
- Icons come from the sprite in `index.html` (`#ic-gate`, `#ic-bucket`, `#ic-clock`, …). Add new symbols there, not inline in sections.
- Slide copy is English. Match the tone of neighbouring slides.

## Adding a section

1. Create `sections/NN-slug.html`, starting with a divider slide.
2. Add `'NN-slug'` (no extension) to `SECTIONS` in `index.html` at the right position.
3. Renumber footers.

## Charts

Chart code lives in the same section file as its slide, in one trailing `<script>`:

```html
<script>
(() => {
  const { el, scale, fmt, $ } = window.Charts;
  function myChart(svg) { /* ... */ }
  myChart($('my-chart'));
})();
</script>
```

- Keep the IIFE wrapper so function names don't collide between sections.
- Only destructure the helpers actually used.
- `window.Charts`: `el(tag, attrs, parent, text)`, `scale(d0, d1, r0, r1)`, `fmt(n, digits)`, `$(id)`, `rng(seed)` (deterministic — use it instead of `Math.random` so charts look identical on every load), `histogram({...})` (mode-switch histogram, see `02-implementation-layers.html`).
- Draw marks, ticks and labels from one `scale`. Set `viewBox` on the SVG rather than fixed pixel sizes.
- Colors come from `sv-*` classes in `css/deck.css` (`sv-axis`, `sv-grid`, `sv-mark`, `sv-bar`, `sv-hot`, `sv-lbl`, `sv-lbl-sm`, `sv-tick`, …). Never hard-code colors — both themes must work.
- Only move a helper into `charts-lib.js` when a second section needs it.

## Styling

- All CSS is in `css/deck.css`, grouped by `/* ---------- name ---------- */` markers.
- Change colors via the tokens at the top (`:root`), and update the dark overrides under both the `prefers-color-scheme` query and `[data-theme='dark']`.
- Slides are laid out on a fixed 1280×720 canvas and scaled by `deck.js` (`--s`). Size things for that canvas.

## Verifying changes

1. `cd presentation && python3 -m http.server 8000`, open `http://localhost:8000`.
2. Step through every changed slide with `→`, including all `data-step` states.
3. Toggle theme with `T` and re-check charts.
4. Check the DevTools console for errors.

Headless check without a browser window:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --virtual-time-budget=4000 --dump-dom http://localhost:8000/ > /tmp/dom.html
# then count <section class="slide"> and inspect chart <svg id="..."> contents
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Failed to load slides: Failed to fetch … opened as a file` | Opened via `file://`. Serve over HTTP. |
| `Failed to load slides: sections/xxx.html: HTTP 404` | Name in `SECTIONS` doesn't match the filename (typo, or `.html` included). |
| Blank slide / chart missing | Console error in a section `<script>`, or a duplicated `id`. |
| `→` doesn't reveal the next part | `data-step` numbers missing or not consecutive. |
| Chart wrong color in one theme | Hard-coded color instead of an `sv-*` class. |
| Edits don't show | Browser cache — hard reload. |

## Known issues

- Deep links don't work: opening `#20` lands on slide 1. At the end of `js/deck.js`, `render(true)` calls `history.replaceState` (rewriting the hash to `#1.0`) before `fromHash()` reads it. Pre-existing; fix only when asked.
