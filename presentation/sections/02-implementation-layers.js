// Slides for this section. Chart code for these slides, if any, goes in the init function after the HTML.
Deck.section(`
<!-- ============ SECTION 2 — IMPLEMENTATION LAYERS ============ -->
<section class="slide divider" data-section="divider-02">
  <div class="divider-num">02</div>
  <div class="section-tag"><i></i>SECTION 2</div>
  <h2>Implementation layers</h2>
  <p class="lead">Rate limiting isn't one place — it belongs at several layers at once, each stopping a different class of problem.</p>
  <div class="notes"><p>Client-side (don't send the waste), infrastructure (stop it before application code), application (the only layer with business context).</p></div>
  <div class="foot"><span>5 / 45</span><span>act ii · implementation layers</span></div>
</section>

<section class="slide" data-section="topology">
  <div class="eyebrow"><svg class="ic"><use href="#ic-gate"/></svg>Three layers, one request</div>
  <h2>Client, infrastructure, application — each catches something different</h2>
  <div class="body" style="min-height:0;">
    <div class="diagram-embed">
      <iframe src="diagrams/request-topology.html" loading="lazy" title="Interactive: two directions through a rate limiter"></iframe>
    </div>
    <div class="diagram-caption">
      <span>Pan, zoom, and trace the path — this is a live diagram, not a screenshot.</span>
      <a href="diagrams/request-topology.html" target="_blank" rel="noopener">Open full screen ↗</a>
    </div>
  </div>
  <div class="notes"><p>A dedicated gateway (Kong, Envoy, an API-manager tier) is the tidiest place to enforce inbound limits, but plenty of real systems skip it and enforce entirely in application code instead.</p></div>
  <div class="foot"><span>6 / 45</span><span>architecture</span></div>
</section>

<section class="slide" data-section="client-side">
  <div class="eyebrow"><svg class="ic"><use href="#ic-clock"/></svg>2.1 · Client-side</div>
  <h2>Don't send the wasted request in the first place</h2>
  <div class="trio">
    <div class="card lift">
      <svg class="ic"><use href="#ic-clock"/></svg>
      <div class="k">Debounce</div>
      <div class="t">Collapse rapid-fire input</div>
      <pre class="code">// typing "rate" fires 4 keystrokes
const search = debounce(q =&gt;
  api.search(q), 300)
// only the last one, after 300ms
// of silence, calls the API</pre>
    </div>
    <div class="card lift">
      <svg class="ic"><use href="#ic-log"/></svg>
      <div class="k">Batching</div>
      <div class="t">Flush on an interval, not per event</div>
      <pre class="code">const queue = []
setInterval(() =&gt; {
  if (queue.length) {
api.batchTrack(queue) // 1 call
queue.length = 0      // not N
  }
}, 2000)</pre>
    </div>
    <div class="card lift">
      <svg class="ic"><use href="#ic-die"/></svg>
      <div class="k">Backoff + full jitter</div>
      <div class="t">On a 429, don't retry on the beat</div>
      <pre class="code">const wait = Math.random() *
  Math.min(cap, base * 2 ** i)
await sleep(wait)
// next 3 slides: why</pre>
    </div>
  </div>
  <div class="notes"><p>None of these three protect the server directly — they exist so the client never sends the request that would have needed protecting against in the first place.</p></div>
  <div class="foot"><span>7 / 45</span><span>client-side · debounce, batch, backoff</span></div>
</section>

<section class="slide" data-section="herd">
  <div class="eyebrow"><svg class="ic"><use href="#ic-die"/></svg>Why jitter matters</div>
  <h2>1,000 clients, no jitter, waking in unison</h2>
  <div class="body">
    <div class="seg" id="herd-seg" role="group" aria-label="Backoff mode">
      <button data-mode="none" aria-pressed="true">No jitter</button>
      <button data-mode="equal">Equal jitter</button>
      <button data-mode="full">Full jitter</button>
    </div>
    <div class="chart meter">
      <svg id="herd"></svg>
      <figcaption>A downstream API drops for two minutes; 1,000 queued jobs fail together and retry on <code>30s → 90s → 210s</code>. Each bin is 5 seconds.</figcaption>
    </div>
    <p class="readout" id="herd-readout"></p>
  </div>
  <div class="notes"><p>Exponential backoff only spaces the retries further apart over time — it never makes concurrent clients diverge from each other. Jitter is the only ingredient that does that. Full jitter produces the lowest total load; equal jitter guarantees at least half the base delay.</p></div>
  <div class="foot"><span>8 / 45</span><span>jitter · simulated, per AWS's "Exponential Backoff and Jitter"</span></div>
</section>

<section class="slide" data-section="jitter-formulas">
  <div class="eyebrow"><svg class="ic"><use href="#ic-die"/></svg>Three jitter formulas</div>
  <h2>Equal jitter is the common middle ground</h2>
  <div class="split even">
    <table class="tbl">
      <thead><tr><th>Style</th><th>Wait time</th></tr></thead>
      <tbody>
        <tr><td class="name">Full jitter</td><td class="mono">random(0, min(cap, base·2ⁿ))</td></tr>
        <tr><td class="name">Equal jitter</td><td class="mono">t/2 + random(0, t/2)</td></tr>
        <tr><td class="name">Decorrelated</td><td class="mono">min(cap, random(base, prev·3))</td></tr>
      </tbody>
    </table>
    <div class="stack">
      <pre class="code">base = min(previousDelay * multiplier, maxDelay)
<span class="hl">return random(base / 2, base + 1)</span></pre>
      <p class="lead" style="font-size:16.5px;" data-step="1"><b>One catch:</b> if the next attempt's base is computed from the previous <em>jittered</em> delay rather than the original, each retry only grows by roughly <b>1.5×</b> on average, not the intended 2×.</p>
    </div>
  </div>
  <div class="notes"><p>Full jitter produces the lowest aggregate load, per AWS's own writeup. Decorrelated jitter is attractive because it needs no retry counter at all — only the previous wait.</p></div>
  <div class="foot"><span>9 / 45</span><span>jitter formulas</span></div>
</section>

<section class="slide" data-section="retry-after">
  <div class="eyebrow"><svg class="ic"><use href="#ic-die"/></svg>Retry-After still needs jitter</div>
  <h2>"Wait 60 seconds" — and everyone wakes at second 60</h2>
  <div class="body">
    <div class="seg" id="ra-seg" role="group" aria-label="With or without jitter">
      <button data-mode="exact" aria-pressed="true">Retry-After, exact</button>
      <button data-mode="jitter">+ random(0, 20%)</button>
    </div>
    <div class="chart meter">
      <svg id="ra"></svg>
      <figcaption>400 jobs are rejected at once, every one of them handed the same <code>Retry-After: 60</code>.</figcaption>
    </div>
    <p class="readout" id="ra-readout"></p>
  </div>
  <div class="notes"><p>The header tells every client the same number, so obeying it literally recreates the herd it was meant to prevent. Adding a small jitter on top — retryAfter + random(0, 20%) — is the cheapest fix.</p></div>
  <div class="foot"><span>10 / 45</span><span>Retry-After · jitter</span></div>
</section>

<section class="slide" data-section="nginx-eventloop">
  <div class="eyebrow"><svg class="ic"><use href="#ic-server"/></svg>2.2 · Infrastructure</div>
  <h2>One thread, ten thousand connections</h2>
  <div class="split">
    <div class="stack">
      <p class="lead" style="font-size:19px;">Nginx isn't just a web server — it's a <b>reverse proxy</b> standing in front of the whole system, and this is the layer that stops a request before it ever reaches application code.</p>
      <p style="color:var(--body); font-size:16.5px; line-height:1.55;">Most traditional web servers use <b>thread-per-connection</b>: 10,000 connections means 10,000 threads — expensive in memory, slow to context-switch.</p>
    </div>
    <div class="card lift">
      <svg class="ic"><use href="#ic-server"/></svg>
      <div class="k">Event-driven, non-blocking I/O</div>
      <div class="t">One worker, thousands of connections</div>
      <p>A single event loop thread reacts to <code>data ready</code>, <code>response ready</code>, <code>new connection</code>, <code>timeout</code> — while waiting on network I/O, the worker does other work instead of blocking on it. The same idea as Node.js's event loop, in C, and faster.</p>
    </div>
  </div>
  <div class="notes"><p>This is why Nginx can front 10K concurrent connections on a single core — it isn't magic, it's just never blocking a thread on I/O it could be doing something else during.</p></div>
  <div class="foot"><span>11 / 45</span><span>nginx · event loop</span></div>
</section>

<section class="slide" data-section="nginx-config">
  <div class="eyebrow"><svg class="ic"><use href="#ic-pipe"/></svg>2.2 · Infrastructure</div>
  <h2>Nginx enforces rate limits as a leaky bucket</h2>
  <div class="split code-left">
    <pre class="code"><span class="c"># declare a zone: by IP, 10MB, 10 req/s</span>
limit_req_zone $binary_remote_addr
  zone=api:10m rate=10r/s;

server {
  location /api/ {
<span class="hl">limit_req zone=api burst=20 nodelay;</span>
<span class="c"># burst=20 : queue up to 20 requests over rate
# nodelay  : reject past that, no delay</span>
proxy_pass http://backend;
  }
}</pre>
    <ul class="points tight">
      <li><code>burst</code> <b>is</b> the leaky bucket's queue size — this directive is a leaky bucket by another name.</li>
      <li><span class="chip">load balancing</span> round robin (default), <code>least_conn</code>, <code>ip_hash</code> (sticky sessions), or <code>weight=N</code> sit right alongside it in the same upstream block.</li>
      <li><span class="chip">Kong / Envoy</span> centralize the same idea as a plugin/config shared across every gateway node — no per-service code to write.</li>
    </ul>
  </div>
  <div class="notes"><p>Infrastructure-layer limiting is coarse — it only knows the IP, never the user or their subscription tier. That gap is exactly what the application layer fills next.</p></div>
  <div class="foot"><span>12 / 45</span><span>nginx · config &amp; load balancing</span></div>
</section>

<section class="slide" data-section="app-middleware">
  <div class="eyebrow"><svg class="ic"><use href="#ic-key"/></svg>2.3 · Application / middleware</div>
  <h2>Where business context lives that infrastructure can't see</h2>
  <div class="split code-left">
    <pre class="code">val tier = userService.getTier(userId)
<span class="c">// free / pro / enterprise</span>

val limit = when (tier) {
  "enterprise" -&gt; 10_000
  "pro"        -&gt; 1_000
  else         -&gt; <span class="hl">100</span>      <span class="c">// free</span>
}

val result = rateLimiter.check(
  key = "$userId:$endpoint", limit = limit)</pre>
    <ul class="points tight">
      <li><b>Tier-based limits</b> — a VIP or paying customer gets a materially higher budget than a free account.</li>
      <li><b>Per-endpoint limits</b> — a slow <code>/export</code> gets its own, tighter budget than a cheap read.</li>
      <li><b>Per-API-key, not per-IP</b> — many users legitimately share one office IP; a key identifies the actual user.</li>
    </ul>
  </div>
  <div class="notes"><p>Infrastructure rate limiting is thick and coarse; application-layer limiting is where product decisions — who gets more, what costs more — actually get enforced.</p></div>
  <div class="foot"><span>13 / 45</span><span>application layer · business logic</span></div>
</section>
`, () => {
    const { fmt, $, rng, histogram } = window.Charts;

    function herd() {
      const CLIENTS = 1000, BASES = [30, 60, 120];
      const schedule = (jitter) => {
        const r = rng(7), out = [];
        for (let i = 0; i < CLIENTS; i++) {
          let t = 0;
          BASES.forEach((base) => { t += jitter(base, r); out.push(t); });
        }
        return out;
      };
      histogram({
        svg: $('herd'), seg: $('herd-seg'), readout: $('herd-readout'),
        domain: [0, 300], bin: 5, ymax: 1000, yStep: 250, xStep: 30, xUnit: 's',
        modes: {
          none: () => schedule((base) => base),
          equal: () => schedule((base, r) => base / 2 + r() * (base / 2)),
          full: () => schedule((base, r) => r() * base),
        },
        describe: (peak, at) => `Peak: <b>${fmt(peak)}</b> requests in one 5-second bin, starting at t = ${at}s`,
      });
    }

    function retryAfter() {
      const JOBS = 400, RETRY_AFTER = 60;
      histogram({
        svg: $('ra'), seg: $('ra-seg'), readout: $('ra-readout'),
        domain: [55, 80], bin: 1, ymax: 400, yStep: 100, xStep: 5, xUnit: 's',
        modes: {
          exact: () => new Array(JOBS).fill(RETRY_AFTER),
          jitter: () => { const r = rng(11); return Array.from({ length: JOBS }, () => RETRY_AFTER + r() * RETRY_AFTER * 0.2); },
        },
        describe: (peak, at) => `Peak: <b>${fmt(peak)}</b> retries in one 1-second bin, at t = ${at}s`,
      });
    }

    herd();
    retryAfter();
});
