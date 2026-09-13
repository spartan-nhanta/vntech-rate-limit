// Charts and interactive widgets. Every chart draws marks, ticks and labels from one linear scale.
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent, text) => {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (text != null) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  };
  const scale = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  const fmt = (n, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const $ = (id) => document.getElementById(id);

  // Deterministic so the chart looks the same on every load and in print.
  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Slides 15 and 17: histogram of retry arrivals with a mode switch.
  function histogram({ svg, seg, readout, domain: [a, b], bin, ymax, yStep, xStep, xUnit, modes, describe }) {
    const W = 1100, H = 300, L = 60, R = 16, T = 12, B = 40;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const x = scale(a, b, L, W - R);
    const y = scale(0, ymax, H - B, T);
    for (let v = 0; v <= ymax; v += yStep) {
      el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'sv-grid' }, svg);
      el('text', { x: L - 10, y: y(v) + 4.5, class: 'sv-tick', 'text-anchor': 'end' }, svg, fmt(v));
    }
    for (let v = a; v <= b; v += xStep) {
      el('text', { x: x(v), y: H - B + 24, class: 'sv-tick', 'text-anchor': 'middle' }, svg, `${v}${xUnit}`);
    }
    el('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'sv-axis' }, svg);
    const n = Math.round((b - a) / bin);
    const bw = x(a + bin) - x(a);
    const bars = Array.from({ length: n }, (_, i) =>
      el('rect', { x: x(a + i * bin) + 1, width: Math.max(1, bw - 2), y: y(0), height: 0, rx: 2, class: 'sv-bar' }, svg));

    function show(key) {
      const counts = new Array(n).fill(0);
      modes[key]().forEach((t) => {
        const i = Math.floor((t - a) / bin);
        if (i >= 0 && i < n) counts[i]++;
      });
      counts.forEach((c, i) => {
        const top = y(Math.min(c, ymax));
        bars[i].setAttribute('y', top);
        bars[i].setAttribute('height', y(0) - top);
        bars[i].style.y = `${top}px`;
        bars[i].style.height = `${y(0) - top}px`;
      });
      const peak = Math.max(...counts);
      readout.innerHTML = describe(peak, a + counts.indexOf(peak) * bin, key);
      seg.querySelectorAll('button').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.mode === key)));
    }
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn) show(btn.dataset.mode);
    });
    show(seg.querySelector('button').dataset.mode);
  }

  window.Charts = { el, scale, fmt, $, rng, histogram };
})();
