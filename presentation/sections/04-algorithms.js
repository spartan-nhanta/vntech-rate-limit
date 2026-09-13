// Slides for this section. Chart code for these slides, if any, goes in the init function after the HTML.
Deck.section(`
<!-- ============ SECTION 4 — ALGORITHMS ============ -->
<section class="slide divider" data-section="divider-04">
  <div class="divider-num">04</div>
  <div class="section-tag"><i></i>SECTION 4</div>
  <h2>Algorithms</h2>
  <p class="lead">Two families. Windows count requests per slice of time; buckets split <b>burst</b> and <b>rate</b> into separate params.</p>
  <div class="notes"><p>Window family first (fixed window → sliding log → sliding counter), then the bucket family (token bucket → leaky bucket, with GCRA as the one-field rewrite of token bucket). Before the windows, define burst and rate — that distinction is what separates the two families.</p></div>
  <div class="foot"><span>19 / 45</span><span>act iv · algorithms</span></div>
</section>

<section class="slide" data-section="window-family">
  <div class="eyebrow"><svg class="ic"><use href="#ic-window"/></svg>Family 1 · Windows</div>
  <h2>Burst and rate are two different questions</h2>
  <div class="two" style="gap:22px;">
    <div class="card">
      <div class="k">Rate</div>
      <div class="t">How much, on average, over time</div>
      <p>Long-run throughput a client is allowed: <code>100 req/min</code>.</p>
    </div>
    <div class="card">
      <div class="k">Burst</div>
      <div class="t">How many at once, back to back</div>
      <p>Max requests landing back to back in one instant: <code>20 at once</code>.</p>
    </div>
  </div>
  <div class="chart meter" data-step="1">
    <svg viewBox="0 0 1100 118" aria-label="Two traffic shapes, both allowed by a 10 per minute window">
      <line class="sv-grid" x1="220" x2="220" y1="8" y2="88" /><line class="sv-grid" x1="430" x2="430" y1="8" y2="88" />
      <line class="sv-grid" x1="640" x2="640" y1="8" y2="88" /><line class="sv-grid" x1="850" x2="850" y1="8" y2="88" />
      <line class="sv-grid" x1="1060" x2="1060" y1="8" y2="88" />
      <line class="sv-axis" x1="220" x2="1060" y1="88" y2="88" />
      <text class="sv-lbl" x="200" y="30" text-anchor="end">Spread out</text>
      <text class="sv-lbl" x="200" y="70" text-anchor="end">All at once</text>
      <g class="sv-ink">
        <circle cx="241" cy="26" r="6" /><circle cx="325" cy="26" r="6" /><circle cx="409" cy="26" r="6" /><circle cx="493" cy="26" r="6" /><circle cx="577" cy="26" r="6" />
        <circle cx="661" cy="26" r="6" /><circle cx="745" cy="26" r="6" /><circle cx="829" cy="26" r="6" /><circle cx="913" cy="26" r="6" /><circle cx="997" cy="26" r="6" />
      </g>
      <g class="sv-mark">
        <circle cx="226" cy="66" r="6" /><circle cx="236" cy="66" r="6" /><circle cx="246" cy="66" r="6" /><circle cx="256" cy="66" r="6" /><circle cx="266" cy="66" r="6" />
        <circle cx="276" cy="66" r="6" /><circle cx="286" cy="66" r="6" /><circle cx="296" cy="66" r="6" /><circle cx="306" cy="66" r="6" /><circle cx="316" cy="66" r="6" />
      </g>
      <text class="sv-hot" x="340" y="71">10 requests in ~1 s</text>
      <text class="sv-tick" x="220" y="112" text-anchor="middle">0s</text><text class="sv-tick" x="430" y="112" text-anchor="middle">15s</text>
      <text class="sv-tick" x="640" y="112" text-anchor="middle">30s</text><text class="sv-tick" x="850" y="112" text-anchor="middle">45s</text>
      <text class="sv-tick" x="1060" y="112" text-anchor="middle">60s</text>
    </svg>
    <figcaption>A <code>10 / minute</code> window accepts both rows: it has <b>one</b> number, so burst is always the whole limit.</figcaption>
  </div>
  <div class="notes"><p>Define the two terms before any algorithm. Rate is the average over time; burst is how many can arrive together. Every window algorithm has one param — N per window — so N is simultaneously the rate and the maximum burst. Keep this in mind: the three window algorithms differ in how they handle the boundary and memory, not in separating burst from rate.</p></div>
  <div class="foot"><span>20 / 45</span><span>window family · burst vs. rate</span></div>
</section>

<section class="slide" data-section="fixed-window">
  <div class="eyebrow"><svg class="ic"><use href="#ic-window"/></svg>4.1 · Fixed window counter</div>
  <h2>One counter per window, reset at the boundary</h2>
  <div class="split even">
    <div class="chart meter">
      <svg id="fixed"></svg>
      <figcaption>A window keyed off "time since first hit" rather than the wall clock: two keys can each open their own 20-second window and never see it collide with anyone else's.</figcaption>
    </div>
    <ul class="points">
      <li><span class="chip ok">simplest</span> The easiest limiter to write, O(1) memory: one counter per key, reset on a timer. <code>INCR</code> + <code>EXPIRE</code> — doesn't even need Lua, since <code>INCR</code> is already atomic on its own.</li>
      <li><span class="chip risk">boundary attack</span> A client that spends the limit at the end of window A and again at the start of window B gets 2× the limit packed into a few seconds.</li>
      <li>If the counter's TTL is set only on the first hit and never refreshed, the window is anchored to that client's own history, not to a shared clock — which is what makes two windows able to abut like this.</li>
    </ul>
  </div>
  <div class="notes"><p>This is the classic fixed-window failure mode: burst at the trailing edge of one window, burst again at the leading edge of the next, and the two combine into a spike the limit was never meant to allow.</p></div>
  <div class="foot"><span>21 / 45</span><span>fixed window counter</span></div>
</section>

<section class="slide" data-section="inbound-table">
  <div class="eyebrow"><svg class="ic"><use href="#ic-window"/></svg>Fixed window · in the wild</div>
  <h2>Where this shows up in a typical product</h2>
  <div class="body meter" style="justify-content:center;">
    <table class="tbl">
      <thead><tr><th>Surface</th><th>Window</th><th class="num">Limit</th><th>Key</th><th>On breach</th></tr></thead>
      <tbody>
        <tr><td class="name">Login<span>brute-force throttling</span></td><td>15 min</td><td class="num">10 / pair · 30 / IP</td><td class="mono">email + IP</td><td><span class="chip">401, not 429</span></td></tr>
        <tr><td class="name">Form submission<span>spam / abuse guard</span></td><td>10 min</td><td class="num">10</td><td class="mono">tenant:IP</td><td><span class="chip hot">429</span></td></tr>
        <tr><td class="name">One-time code<span>OTP verification</span></td><td>6 min</td><td class="num">5 wrong tries</td><td class="mono">account id</td><td><span class="chip risk">lockout, 5 min</span></td></tr>
      </tbody>
    </table>
  </div>
  <div class="notes"><p>All three are fixed-window counters underneath. What differs is where the count lives — in-process, or in a store shared across every instance of the service.</p></div>
  <div class="foot"><span>22 / 45</span><span>fixed window · common surfaces</span></div>
</section>

<section class="slide" data-section="sliding-log">
  <div class="eyebrow"><svg class="ic"><use href="#ic-log"/></svg>4.2 · Sliding window log</div>
  <h2>Exact count, O(N) memory per key</h2>
  <div class="split">
    <div class="chart meter">
      <svg id="swlog"></svg>
      <figcaption>Every request is a timestamp. Anything older than the window is trimmed before the remaining ones are counted.</figcaption>
    </div>
    <ul class="points">
      <li>A Redis sorted set per key: <code>ZREMRANGEBYSCORE</code> trims anything older than the window, <code>ZCARD</code> counts what's left, <code>ZADD</code> writes the new timestamp.</li>
      <li><span class="chip ok">fixes the boundary</span> The window truly slides, so there's no clock edge to exploit — no spike at the boundary.</li>
      <li><span class="chip risk">O(N) memory</span> Memory per key scales with request volume, not with a constant. 100 req/min per user × 1M users = 100M sorted-set entries.</li>
    </ul>
  </div>
  <div class="notes"><p>Sliding window log is the gold standard for accuracy and the worst choice for memory. It earns its keep only where correctness genuinely outweighs the cost — billing is the canonical example.</p></div>
  <div class="foot"><span>23 / 45</span><span>sliding window log</span></div>
</section>

<section class="slide" data-section="sliding-counter">
  <div class="eyebrow"><svg class="ic"><use href="#ic-gauge"/></svg>4.3 · Sliding window counter</div>
  <h2>Estimate from two counters</h2>
  <div class="split">
    <div class="stack">
      <svg id="sw-bar" style="width:100%;height:210px;overflow:visible;"></svg>
      <div class="legend"><span><i class="lg-dot ink"></i>previous, still counted</span><span><i class="lg-dot old"></i>previous, aged out</span><span><i class="lg-dot"></i>real, this window</span><span><i class="lg-dot carry"></i>carried over — computed</span></div>
      <div class="formula" id="sw-calc">3 + 8 × (1 − 5/15) = <b>8.3</b></div>
      <div class="verdict">Result: <span class="chip ok" id="sw-verdict">Allowed</span><span class="readout">estimate <b id="sw-est">8.3</b> / 10</span></div>
    </div>
    <div class="stack">
      <div class="sliders">
        <label>Previous window's count <output id="sw-prev-o">8</output>
          <input id="sw-prev" type="range" min="0" max="15" value="8" /></label>
        <label>Current window's count <output id="sw-curr-o">3</output>
          <input id="sw-curr" type="range" min="0" max="15" value="3" /></label>
        <label>Elapsed into current window <output id="sw-el-o">5 min</output>
          <input id="sw-el" type="range" min="0" max="15" value="5" /></label>
      </div>
      <p class="caption">Drag the sliders to see <code>current + previous × (1 − elapsed / window)</code> respond — a 10-per-15-minute limit, the same shape as the login example. The balance between the two: O(1) memory like fixed window, most of the boundary protection of the log. Worst case is still ~2× the limit — but smeared across the window, not packed into a few seconds at the boundary.</p>
    </div>
  </div>
  <div class="notes"><p>The compromise of the window family: two integers per key instead of a growing log. Worst case can still reach 2× the limit, but spread across time instead of concentrated at the boundary like fixed window. Still one param, though — burst and rate stay tied together, which is what the bucket family fixes.</p></div>
  <div class="foot"><span>24 / 45</span><span>sliding window counter</span></div>
</section>

<section class="slide" data-section="bucket-family">
  <div class="eyebrow"><svg class="ic"><use href="#ic-bucket"/></svg>Family 2 · Buckets</div>
  <h2>Two params: capacity and rate</h2>
  <div class="body meter" style="justify-content:center;">
    <table class="tbl">
      <thead><tr><th></th><th>Window family</th><th>Bucket family</th></tr></thead>
      <tbody>
        <tr><td class="name">Params<span>what you configure</span></td><td><code>limit</code> per <code>window</code> — one number</td><td><code>capacity</code> <b>and</b> <code>rate</code> — two numbers</td></tr>
        <tr><td class="name">Burst<span>max at once</span></td><td>Always the whole limit</td><td><code>capacity</code></td></tr>
        <tr><td class="name">Rate<span>long-run average</span></td><td><code>limit / window</code></td><td><code>rate</code> (refill or leak)</td></tr>
        <tr><td class="name">"100 / min, but never more than 5 at once"<span>a common product ask</span></td><td><span class="chip risk">can't express it</span></td><td><span class="chip ok">capacity 5, rate 100/min</span></td></tr>
      </tbody>
    </table>
  </div>
  <div class="notes"><p>This is the pivot of the section. Windows fuse burst and rate into one number; buckets pull them apart. Capacity decides how big a spike is tolerated, rate decides the sustained throughput. Token bucket and leaky bucket are two views of the same algorithm.</p></div>
  <div class="foot"><span>25 / 45</span><span>bucket family · burst and rate split</span></div>
</section>

<section class="slide" data-section="token-bucket">
  <div class="eyebrow"><svg class="ic"><use href="#ic-bucket"/></svg>4.4 · Token bucket</div>
  <h2>Capacity caps the burst, rate caps the throughput</h2>
  <div class="split">
    <div class="chart meter">
      <svg id="gantt"></svg>
      <div class="legend"><span><i class="lg-dot ink"></i>called immediately</span><span><i class="lg-bar"></i>waiting out its own deficit</span></div>
      <figcaption>Ten requests hit <code>acquire()</code> at the same instant. The first five spend the bucket's five tokens and go through immediately; from the sixth on, each request is paced 200 ms apart. <a href="diagrams/token-bucket-flow.html" target="_blank" rel="noopener">Open the interactive flow ↗</a></figcaption>
    </div>
    <ul class="points tight">
      <li><span class="chip ok">most used</span> O(1) memory — two numbers per key — easy to write and easy to explain. <code>capacity</code> is the burst, <code>rate</code> is the rate.</li>
      <li><span class="chip hot">lazy refill</span> No background thread tops up the bucket. Each call computes <code>tokens = min(capacity, tokens + elapsed × rate)</code> on the spot.</li>
      <li><span class="chip">borrow ahead</span> When the bucket is empty, let the count go negative and sleep exactly the deficit — instead of parking every request until the next refill and having them race each other.</li>
      <li><span class="chip risk">bounded wait</span> If the computed wait exceeds a cap, fail fast instead of queuing indefinitely — an oversubscribed path should fail fast, not stall a batch job.</li>
    </ul>
  </div>
  <div class="notes"><p>Allows controlled bursts, O(1), gives an exact Retry-After, no boundary spike — the generally recommended default. Needs two tuned parameters: capacity and rate.</p></div>
  <div class="foot"><span>26 / 45</span><span>token bucket</span></div>
</section>

<section class="slide" data-section="pacer-code">
  <div class="eyebrow"><svg class="ic"><use href="#ic-bucket"/></svg>Token bucket · mechanics</div>
  <h2>Reserve the token, then wait outside the lock</h2>
  <div class="split code-left">
    <pre class="code">function acquire():
  lock:
refill()
deficit = 1 - tokens
wait = deficit &lt;= 0 ? 0
     : ceil(deficit / rate * 1000)  <span class="c">// ms</span>
if wait &gt; MAX_WAIT:
  raise RateLimitExceeded(wait)
<span class="hl">tokens -= 1</span>  <span class="c">// reserved before sleeping, can go negative</span>
  if wait &gt; 0:
sleep(wait)</pre>
    <ul class="points tight">
      <li data-step="1"><b>Decrement before sleeping.</b> The next request sees the bucket already negative and computes a longer wait of its own — no two requests ever land on the same wake-up moment.</li>
      <li data-step="2"><b>The lock only covers the arithmetic, not the sleep.</b> Reserving a token happens inside the critical section; sleeping happens outside it, so waiting requests never block each other.</li>
      <li data-step="3"><b>The bounded-wait exception is the one signal that matters.</b> A window that's genuinely oversubscribed should surface as a fast, explicit failure — not a batch job that quietly hangs.</li>
    </ul>
  </div>
  <div class="notes"><p>This is how ten concurrent requests end up queued 200 ms apart instead of all waking on the same refill tick and stampeding for the same token.</p></div>
  <div class="foot"><span>27 / 45</span><span>token bucket · pseudocode</span></div>
</section>

<section class="slide" data-section="leaky-bucket">
  <div class="eyebrow"><svg class="ic"><use href="#ic-pipe"/></svg>4.5 · Leaky bucket</div>
  <h2>Smooth the output, not the input</h2>
  <div class="split">
    <div class="chart meter">
      <svg id="leaky"></svg>
      <figcaption>An ideal leaky bucket drains at a fixed rate, one item every <code>1/k</code> seconds. A worker that schedules with <code>delay = index / k</code> — integer division — drains in small batches instead.</figcaption>
    </div>
    <ul class="points tight">
      <li><span class="chip hot">same algorithm</span> The mirror image of token bucket: instead of tokens refilling, water drains out at a fixed rate. Different names, flipped formula — next slide.</li>
      <li>Instead of enqueuing thousands of jobs at once, each one gets a delay proportional to its position in the queue: <code>delay = index / jobsPerSecond</code>.</li>
      <li>A durable queue plays the role of the bucket, draining downstream at a constant, predictable rate no matter how bursty the enqueue was.</li>
      <li><span class="chip">counter vs. queue</span> A counter-based leaky bucket isn't a true smoother — it can still let a burst through if the queue has room. Genuinely smooth output needs a real FIFO queue, like a worker pulling off Kafka.</li>
    </ul>
  </div>
  <div class="notes"><p>Leaky bucket is the traffic-shaping half of the pair — it protects whatever is downstream from ever seeing a spike, at the cost of some added latency for the items at the back of the queue.</p></div>
  <div class="foot"><span>28 / 45</span><span>leaky bucket</span></div>
</section>

<section class="slide" data-section="token-vs-leaky">
  <div class="eyebrow"><svg class="ic"><use href="#ic-scale"/></svg>Token bucket vs. leaky bucket</div>
  <h2>Same algorithm, opposite state variable</h2>
  <div class="split even">
    <div class="stack">
      <div class="code-label">token bucket · counts what's left</div>
      <pre class="code">tokens = min(capacity,
         tokens + elapsed × <span class="hl">refill_rate</span>)
if tokens &lt; 1: reject
tokens -= 1</pre>
      <div class="code-label">leaky bucket · counts what's used</div>
      <pre class="code">water = max(0,
        water - elapsed × <span class="hl">leak_rate</span>)
if water + 1 &gt; capacity: reject
water += 1</pre>
    </div>
    <ul class="points tight">
      <li><span class="chip">naming</span> Token bucket speaks of <code>tokens</code> and a <code>refill_rate</code>; leaky bucket of <code>water</code> (or queue size) and a <code>leak_rate</code>.</li>
      <li><span class="chip">formula</span> One adds and clamps at the top, the other subtracts and clamps at zero. At every moment <code>tokens = capacity − water</code>.</li>
      <li><span class="chip hot">same decisions</span> Given the same capacity and rate, the counter versions allow and reject exactly the same requests.</li>
      <li><span class="chip risk">where they differ</span> Leaky bucket as a <b>real queue</b> delays requests instead of rejecting them — that's what makes output smooth.</li>
    </ul>
  </div>
  <div class="notes"><p>Don't let the metaphors suggest two different algorithms. As counters they're identical up to a change of variable. The practical difference only appears when leaky bucket is implemented as a queue that holds and releases work at a fixed rate, which is what Nginx does.</p></div>
  <div class="foot"><span>29 / 45</span><span>token vs. leaky bucket</span></div>
</section>

<section class="slide" data-section="gcra">
  <div class="eyebrow"><svg class="ic"><use href="#ic-clock"/></svg>4.6 · GCRA</div>
  <h2>Token bucket stored as a single timestamp</h2>
  <div class="split code-left">
    <pre class="code"><span class="c">// tat = "theoretical arrival time" — one field,</span>
<span class="c">// not {tokens, last_ts}</span>
now  = current_time()
tat  = max(GET(key), now)
allow_at = tat - burst_window

if now &gt;= allow_at:
  <span class="hl">SET(key, tat + emission_interval)</span>
  return ALLOWED
else:
  return DENIED, retry_after = allow_at - now</pre>
    <ul class="points tight">
      <li>Mathematically equivalent to token bucket — same burst allowance, same steady rate — but stores <b>one</b> value instead of two.</li>
      <li>Used inside <code>redis-cell</code>, a native Redis module that implements this in C.</li>
      <li>Rarely hand-rolled in application code: token bucket is easier to reason about and just as capable. Worth knowing GCRA exists as "the one-field version."</li>
    </ul>
  </div>
  <div class="notes"><p>Generic Cell Rate Algorithm — originally from ATM network traffic control, repurposed for API rate limiting. The name is the least intuitive part; the mechanism is a direct restatement of token bucket.</p></div>
  <div class="foot"><span>30 / 45</span><span>gcra · generic cell rate algorithm</span></div>
</section>

<section class="slide" data-section="algo-comparison">
  <div class="eyebrow"><svg class="ic"><use href="#ic-scale"/></svg>Six algorithms, compared</div>
  <h2>There's a default, and it's token bucket</h2>
  <div class="body meter" style="justify-content:center;">
    <table class="tbl">
      <thead><tr><th>Algorithm</th><th>Memory</th><th>Boundary spike</th><th>Allows burst</th><th>Exact Retry-After</th><th>Best for</th></tr></thead>
      <tbody>
        <tr><td class="name">Fixed Window</td><td class="mono">O(1)</td><td><span class="chip risk">up to 2×</span></td><td>—</td><td>—</td><td>Simple, low-stakes limits</td></tr>
        <tr><td class="name">Sliding Log</td><td class="mono">O(N)</td><td><span class="chip ok">none</span></td><td>—</td><td>—</td><td>Billing, exact accounting</td></tr>
        <tr><td class="name">Sliding Counter</td><td class="mono">O(1)</td><td><span class="chip hot">~2× worst case</span></td><td>—</td><td>—</td><td>Most public APIs</td></tr>
        <tr><td class="name">Token Bucket</td><td class="mono">O(1)</td><td><span class="chip ok">none</span></td><td><span class="chip ok">yes</span></td><td><span class="chip ok">yes</span></td><td><b>Default choice</b></td></tr>
        <tr><td class="name">Leaky Bucket</td><td class="mono">O(1)</td><td><span class="chip ok">none</span></td><td>—</td><td><span class="chip ok">yes</span></td><td>Protecting a downstream system</td></tr>
        <tr><td class="name">GCRA</td><td class="mono">O(1), 1 field</td><td><span class="chip ok">none</span></td><td><span class="chip ok">yes</span></td><td><span class="chip ok">yes</span></td><td>Same as token bucket, tighter storage</td></tr>
      </tbody>
    </table>
  </div>
  <div class="notes"><p>When in doubt, reach for token bucket. Reach for sliding log only when the accuracy genuinely has to be exact, and for leaky bucket specifically when the thing you're protecting is downstream, not yourself.</p></div>
  <div class="foot"><span>31 / 45</span><span>algorithm comparison</span></div>
</section>
`, () => {
    const { el, scale, fmt, $ } = window.Charts;

    // Slide 3: 10 requests hit acquire() at t=0 against a 5-token bucket refilled at 5/s.
    function tokenGantt(svg) {
      const W = 600, H = 330, L = 96, R = 40, T = 10, B = 40;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      const x = scale(0, 1200, L, W - R);
      const rows = 10, rh = (H - T - B) / rows;
      for (let t = 0; t <= 1200; t += 200) {
        el('line', { x1: x(t), x2: x(t), y1: T, y2: H - B, class: 'sv-grid' }, svg);
        el('text', { x: x(t), y: H - B + 24, class: 'sv-tick', 'text-anchor': 'middle' }, svg, `${t} ms`);
      }
      el('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'sv-axis' }, svg);
      for (let i = 0; i < rows; i++) {
        // Tokens after the first five reservations go negative; each request sleeps its own deficit.
        const wait = i < 5 ? 0 : (i - 4) * 200;
        const cy = T + rh * i + rh / 2;
        const g = el('g', i < 5 ? {} : { 'data-step': 1 }, svg);
        el('text', { x: L - 14, y: cy + 4.5, class: 'sv-tick', 'text-anchor': 'end' }, g, `request ${i + 1}`);
        if (wait > 0) el('rect', { x: x(0), y: cy - 5, width: x(wait) - x(0), height: 10, rx: 5, class: 'sv-wait' }, g);
        el('circle', { cx: x(wait), cy, r: 7, class: 'sv-mark' }, g);
      }
    }

    // Slide 5: ideal leaky bucket vs. a sweep that batches with integer division (delay = i / k).
    function leaky(svg) {
      const W = 600, H = 250, L = 168, R = 24, T = 14, B = 40, k = 3, n = 20;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      const x = scale(0, 7, L, W - R);
      for (let s = 0; s <= 7; s++) {
        el('line', { x1: x(s), x2: x(s), y1: T, y2: H - B, class: 'sv-grid' }, svg);
        el('text', { x: x(s), y: H - B + 24, class: 'sv-tick', 'text-anchor': 'middle' }, svg, `${s}s`);
      }
      el('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'sv-axis' }, svg);

      const y1 = 58, y2 = 150;
      el('text', { x: L - 16, y: y1 - 2, class: 'sv-lbl', 'text-anchor': 'end' }, svg, 'Ideal leaky bucket');
      el('text', { x: L - 16, y: y1 + 16, class: 'sv-lbl-sm', 'text-anchor': 'end' }, svg, 'even, every 333 ms');
      el('text', { x: L - 16, y: y2 - 2, class: 'sv-lbl', 'text-anchor': 'end' }, svg, 'Batched sweep');
      el('text', { x: L - 16, y: y2 + 16, class: 'sv-lbl-sm', 'text-anchor': 'end' }, svg, `groups of ${k} per second`);
      for (let i = 0; i < n; i++) {
        el('circle', { cx: x(i / k), cy: y1 + 4, r: 6, class: 'sv-ink' }, svg);
        const sec = Math.floor(i / k);
        el('circle', { cx: x(sec), cy: y2 - 14 + (i % k) * 18, r: 6, class: 'sv-mark' }, svg);
      }
    }

    // Slide 6: a naive expireAfterWrite window starts at the key's first hit, not on the clock.
    function fixedWindow(svg) {
      const W = 600, H = 330, L = 44, R = 76, T = 40, B = 44;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      const x = scale(0, 40, L, W - R); // seconds after 09:59:40
      const y = scale(0, 11, H - B, T);
      el('rect', { x: x(0), y: T, width: x(20) - x(0), height: H - B - T, class: 'sv-band' }, svg);
      el('text', { x: x(0) + 8, y: T + 18, class: 'sv-lbl-sm' }, svg, 'Window A · opened 09:45:00');
      const bandB = el('g', { 'data-step': 1 }, svg);
      el('rect', { x: x(25), y: T, width: x(40) - x(25), height: H - B - T, class: 'sv-band-hot' }, bandB);
      el('text', { x: x(25) + 8, y: T + 18, class: 'sv-lbl-sm' }, bandB, 'Window B · opened 10:00:05');

      for (let c = 0; c <= 10; c += 2) {
        el('line', { x1: L, x2: W - R, y1: y(c), y2: y(c), class: 'sv-grid' }, svg);
        el('text', { x: L - 10, y: y(c) + 4.5, class: 'sv-tick', 'text-anchor': 'end' }, svg, c);
      }
      const ticks = [[0, '09:59:40'], [10, '09:59:50'], [20, '10:00:00'], [30, '10:00:10'], [40, '10:00:20']];
      ticks.forEach(([s, label]) => el('text', { x: x(s), y: H - B + 24, class: 'sv-tick', 'text-anchor': 'middle' }, svg, label));
      el('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'sv-axis' }, svg);
      el('line', { x1: L, x2: W - R, y1: y(10), y2: y(10), class: 'sv-limit' }, svg);
      el('text', { x: W - R + 8, y: y(10) + 5, class: 'sv-hot' }, svg, 'limit 10');

      el('text', { x: x(0) + 8, y: y(1) + 4, class: 'sv-lbl-sm' }, svg, '← 1st hit at 09:45:00');
      const gap = 0.75;
      for (let c = 2; c <= 10; c++) el('circle', { cx: x(10 + (c - 2) * gap), cy: y(c), r: 5.5, class: 'sv-ink' }, svg);
      const stepB = el('g', { 'data-step': 1 }, svg);
      for (let c = 1; c <= 10; c++) el('circle', { cx: x(25 + (c - 1) * gap), cy: y(c), r: 5.5, class: 'sv-mark' }, stepB);

      const first = 10, last = 25 + 9 * gap;
      const brace = el('g', { 'data-step': 2 }, svg);
      const by = y(10) - 20;
      el('path', { d: `M${x(first)} ${by + 8} V${by} H${x(last)} V${by + 8}`, class: 'sv-line' }, brace);
      el('text', { x: (x(first) + x(last)) / 2, y: by - 8, class: 'sv-lbl', 'text-anchor': 'middle' }, brace,
        `19 hits in ${Math.round(last - first)} seconds, none of them rejected`);
    }

    // Slide 9: request timestamps kept in a sorted set; anything older than now − 15m is trimmed.
    function slidingLog(svg) {
      const W = 600, H = 190, L = 20, R = 20, T = 30, B = 44;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      const x = scale(0, 30, L, W - R);
      const times = [2, 4.5, 6, 9, 11.5, 13.5, 16, 17.5, 19, 22, 23.5, 26, 27.5, 29.2];
      el('rect', { x: x(15), y: T, width: x(30) - x(15), height: H - B - T, rx: 10, class: 'sv-band-hot' }, svg);
      const live = times.filter((t) => t >= 15).length;
      el('text', { x: x(15) + 10, y: T + 20, class: 'sv-lbl' }, svg, `last 15 minutes: ${live} timestamps`);
      el('text', { x: x(0) + 4, y: T + 20, class: 'sv-lbl-sm' }, svg, 'trimmed by score');
      el('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'sv-axis' }, svg);
      times.forEach((t) => {
        const old = t < 15;
        el('circle', { cx: x(t), cy: T + 62, r: 7, class: old ? 'sv-old' : 'sv-mark' }, svg);
        if (old) el('line', { x1: x(t) - 7, x2: x(t) + 7, y1: T + 69, y2: T + 55, class: 'sv-strike' }, svg);
      });
      [[0, 'now − 30 min', 'start'], [15, 'now − 15 min', 'middle'], [30, 'now', 'end']].forEach(([t, label, anchor]) =>
        el('text', { x: x(t), y: H - B + 24, class: 'sv-tick', 'text-anchor': anchor }, svg, label));
    }

    // Slide 10: estimate = current + previous × (1 − elapsed / window).
    function slidingCounter() {
      const prev = $('sw-prev'), curr = $('sw-curr'), elapsed = $('sw-el');
      const svg = $('sw-bar');
      const W = 520, H = 210, WIN = 15, LIMIT = 10, MAX = 20;
      const PX0 = 6, PX1 = 226, CX0 = 294, CX1 = 514;   // two window panels
      const TOP = 24, BASE = 156;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      // Bar height encodes the count; bar width spans the whole window — which is
      // exactly the algorithm's assumption that requests are spread evenly.
      const yv = (v) => BASE - (Math.min(v, MAX) / MAX) * (BASE - TOP);

      el('text', { x: (PX0 + PX1) / 2, y: 14, class: 'sv-lbl-sm', 'text-anchor': 'middle' }, svg, 'previous window');
      el('text', { x: (CX0 + CX1) / 2, y: 14, class: 'sv-lbl-sm', 'text-anchor': 'middle' }, svg, 'current window');
      el('rect', { x: PX0, y: TOP - 4, width: PX1 - PX0, height: BASE - TOP + 4, rx: 8, class: 'sv-box' }, svg);
      el('rect', { x: CX0, y: TOP - 4, width: CX1 - CX0, height: BASE - TOP + 4, rx: 8, class: 'sv-box' }, svg);

      const bAged  = el('rect', { class: 'sv-old' }, svg);
      const bKeep  = el('rect', { class: 'sv-bar-ink' }, svg);
      const pSplit = el('line', { class: 'sv-grid' }, svg);
      const pVal   = el('text', { class: 'sv-hot', 'text-anchor': 'middle' }, svg);
      const pNote  = el('text', { class: 'sv-tick', 'text-anchor': 'middle', y: BASE + 18 }, svg);

      const arrow = el('path', { class: 'sv-line-soft' }, svg);
      const aLbl  = el('text', { x: (PX1 + CX0) / 2, y: 78, class: 'sv-hot', 'text-anchor': 'middle' }, svg);

      const bReal  = el('rect', { x: CX0, width: CX1 - CX0, class: 'sv-mark' }, svg);
      const bCarry = el('rect', { x: CX0, width: CX1 - CX0, class: 'sv-carry' }, svg);
      const nowLn  = el('line', { class: 'sv-axis', 'stroke-dasharray': '3 3' }, svg);
      const nowLbl = el('text', { class: 'sv-tick', 'text-anchor': 'middle', y: BASE + 18 }, svg);
      const cReal  = el('text', { class: 'sv-tick', x: CX0 + 10 }, svg);
      const cCarry = el('text', { class: 'sv-hot', x: CX0 + 10 }, svg);

      el('line', { x1: CX0, x2: CX1, y1: yv(LIMIT), y2: yv(LIMIT), class: 'sv-limit' }, svg);
      el('text', { x: CX1 - 6, y: yv(LIMIT) - 7, class: 'sv-hot', 'text-anchor': 'end' }, svg, 'limit 10');

      function update() {
        const p = Number(prev.value), c = Number(curr.value), e = Number(elapsed.value);
        const frac = e / WIN;                 // how far into the current window
        const w = 1 - frac;                   // share of the previous window still in view
        const weighted = p * w;
        const est = c + weighted;
        $('sw-prev-o').textContent = p;
        $('sw-curr-o').textContent = c;
        $('sw-el-o').textContent = `${e} min`;

        // Previous window: split along time. Left of the boundary has aged out of the
        // 15-minute lookback; right of it is what still gets counted.
        const pw = PX1 - PX0, splitX = PX0 + pw * frac;
        const py = yv(p), ph = BASE - py;
        bAged.setAttribute('x', PX0);  bAged.setAttribute('width', pw * frac);
        bAged.setAttribute('y', py);   bAged.setAttribute('height', ph);
        bKeep.setAttribute('x', splitX); bKeep.setAttribute('width', pw * w);
        bKeep.setAttribute('y', py);   bKeep.setAttribute('height', ph);
        pSplit.setAttribute('x1', splitX); pSplit.setAttribute('x2', splitX);
        pSplit.setAttribute('y1', TOP - 4); pSplit.setAttribute('y2', BASE);
        pVal.setAttribute('x', PX0 + pw / 2); pVal.setAttribute('y', py - 7);
        pVal.textContent = p > 0 ? `${p} requests` : 'no requests';
        pNote.setAttribute('x', PX0 + pw / 2);
        pNote.textContent = `${Math.round(w * 100)}% still counted`;

        const mid = (TOP + BASE) / 2;
        arrow.setAttribute('d', `M${PX1 + 8} ${mid} H${CX0 - 16} m-7 -5 l7 5 l-7 5`);
        aLbl.textContent = `× ${fmt(w, 2)}`;

        // Current window: real requests solid, carried-over estimate dashed on top.
        const cy = yv(c), ey = yv(est), carryH = Math.max(0, cy - ey);
        bReal.setAttribute('y', cy);  bReal.setAttribute('height', BASE - cy);
        bCarry.setAttribute('y', ey); bCarry.setAttribute('height', carryH);
        cReal.setAttribute('y', cy + 20);
        cReal.textContent = BASE - cy > 26 ? `${c} real` : '';
        cCarry.setAttribute('y', ey + 20);
        cCarry.textContent = carryH > 26 ? `+ ${fmt(weighted, 1)} carried` : '';

        const nx = CX0 + (CX1 - CX0) * frac;
        nowLn.setAttribute('x1', nx); nowLn.setAttribute('x2', nx);
        nowLn.setAttribute('y1', TOP - 4); nowLn.setAttribute('y2', BASE);
        nowLbl.setAttribute('x', nx); nowLbl.textContent = 'now';

        $('sw-est').textContent = fmt(est, 1);
        $('sw-calc').innerHTML = `${c} + ${p} × (1 − ${e}/15) = <b>${fmt(est, 1)}</b>`;
        const pass = est < LIMIT;
        const v = $('sw-verdict');
        v.textContent = pass ? 'Allowed' : 'Rejected';
        v.className = pass ? 'chip ok' : 'chip risk';
      }
      [prev, curr, elapsed].forEach((i) => i.addEventListener('input', update));
      update();
    }

    tokenGantt($('gantt'));
    leaky($('leaky'));
    fixedWindow($('fixed'));
    slidingLog($('swlog'));
    slidingCounter();
});
