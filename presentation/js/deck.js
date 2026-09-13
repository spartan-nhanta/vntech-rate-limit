// Keyboard-driven deck: data-step reveals, #slide.step deep links, O overview, T theme, F fullscreen.
(() => {
  const deck = document.getElementById('deck');
  const slides = [...deck.querySelectorAll('.slide')];
  const bar = document.querySelector('.progress i');
  const pager = document.querySelector('.pager');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = (n) => n.toLocaleString('en-US');

  let current = 0;
  let step = 0;

  const maxStep = (slide) =>
    Math.max(0, ...[...slide.querySelectorAll('[data-step]')].map((n) => Number(n.dataset.step)));

  function countUp(slide) {
    slide.querySelectorAll('[data-count]').forEach((node) => {
      const target = Number(node.dataset.count);
      if (reduceMotion) { node.textContent = fmt(target); return; }
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - start) / 800);
        node.textContent = fmt(Math.round(target * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  function stagger(slide) {
    const children = [...slide.children].filter((n) => !n.matches('.foot'));
    children.forEach((n, i) => { n.style.transitionDelay = `${0.32 + i * 0.1}s`; });
  }

  function render(slideChanged) {
    slides.forEach((s, i) => s.classList.toggle('active', i === current));
    const slide = slides[current];
    if (slideChanged) stagger(slide);
    slide.querySelectorAll('[data-step]').forEach((n) => n.classList.toggle('shown', Number(n.dataset.step) <= step));
    if (slideChanged) countUp(slide);
    bar.style.width = `${((current + 1) / slides.length) * 100}%`;
    pager.textContent = `${current + 1} / ${slides.length}`;
    history.replaceState(null, '', `#${current + 1}.${step}`);
  }

  function go(index, toStep = 0) {
    const changed = index !== current;
    current = Math.max(0, Math.min(slides.length - 1, index));
    step = Math.max(0, Math.min(maxStep(slides[current]), toStep));
    render(changed);
  }

  function next() {
    if (step < maxStep(slides[current])) go(current, step + 1);
    else if (current < slides.length - 1) go(current + 1, 0);
  }

  function prev() {
    if (step > 0) go(current, step - 1);
    else if (current > 0) go(current - 1, maxStep(slides[current - 1]));
  }

  function fit() {
    const s = Math.min((innerWidth - 32) / 1280, (innerHeight - 40) / 720);
    deck.style.setProperty('--s', Math.max(0.2, s).toFixed(4));
  }

  function fromHash() {
    const m = location.hash.match(/^#(\d+)(?:\.(\d+))?$/);
    if (m) go(Number(m[1]) - 1, Number(m[2] || 0));
  }

  const toggleOverview = (on = !document.body.classList.contains('overview')) => {
    document.body.classList.toggle('overview', on);
    if (on) slides[current].scrollIntoView({ block: 'center' });
  };

  function applyStoredTheme() {
    const saved = localStorage.getItem('rl-theme');
    if (saved) document.documentElement.dataset.theme = saved;
  }
  function toggleTheme() {
    const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
    const current = document.documentElement.dataset.theme || (isDark ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('rl-theme', next); } catch { /* private mode: theme just won't persist */ }
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.matches('input')) return;
    const overview = document.body.classList.contains('overview');
    switch (e.key) {
      case 'ArrowRight': case 'PageDown': case ' ': case 'Enter':
        if (!overview) { e.preventDefault(); next(); } break;
      case 'ArrowLeft': case 'PageUp': case 'Backspace':
        if (!overview) { e.preventDefault(); prev(); } break;
      case 'Home': go(0); break;
      case 'End': go(slides.length - 1, maxStep(slides[slides.length - 1])); break;
      case 'o': case 'O': toggleOverview(); break;
      case 't': case 'T': toggleTheme(); break;
      case 'Escape': toggleOverview(false); break;
      case 'f': case 'F':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
        break;
    }
  });

  // Clicks only pick a slide in overview; advancing is keyboard-only.
  deck.addEventListener('click', (e) => {
    if (!document.body.classList.contains('overview')) return;
    const slide = e.target.closest('.slide');
    if (slide) { go(slides.indexOf(slide)); toggleOverview(false); }
  });

  addEventListener('resize', fit);
  addEventListener('hashchange', fromHash);
  applyStoredTheme();
  fit();
  render(true);
  fromHash();
})();
