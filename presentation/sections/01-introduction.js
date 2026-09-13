// Slides for this section. Chart code for these slides, if any, goes in the init function after the HTML.
Deck.section(`
<!-- ============ SECTION 1 — INTRODUCTION ============ -->
<section class="slide divider" data-section="divider-01">
  <div class="divider-num">01</div>
  <div class="section-tag"><i></i>SECTION 1</div>
  <h2>Introduction</h2>
  <p class="lead">What rate limiting is, the two concepts people conflate with it, and how a client is told to back off.</p>
  <div class="notes"><p>Set up the vocabulary before any mechanism — this is the section that keeps "throttling" and "rate limiting" from being used as synonyms for the rest of the deck.</p></div>
  <div class="foot"><span>2 / 45</span><span>act i · introduction</span></div>
</section>

<section class="slide" data-section="three-concepts">
  <div class="eyebrow"><svg class="ic"><use href="#ic-gauge"/></svg>Three concepts, one confusion</div>
  <h2>Rate limiting, throttling, and load shedding aren't the same thing</h2>
  <div class="body meter" style="justify-content:center;">
    <table class="tbl">
      <thead><tr><th>Concept</th><th>Behavior once past the threshold</th><th>Where it actually lives</th></tr></thead>
      <tbody>
        <tr><td class="name">Rate limiting</td><td>Reject immediately — <code>429</code></td><td>HTTP API servers</td></tr>
        <tr><td class="name">Throttling</td><td>Delay — hold the item, process it later</td><td>Async workers, queue consumers</td></tr>
        <tr><td class="name">Load shedding</td><td>Reject selectively when the whole system is overloaded</td><td>Circuit breakers, infrastructure</td></tr>
      </tbody>
    </table>
  </div>
  <ul class="points tight" data-step="1">
    <li>AWS, Stripe, and GitHub all call their <code>429</code> behavior "rate limiting" even though, strictly, it's a reject — not a delay. In plain HTTP APIs the two words get used interchangeably.</li>
    <li><b>Real throttling</b> shows up in async systems: a worker pulling off a Kafka topic paces itself against a shared limiter before pushing to a downstream SMS gateway — it <i>sleeps</i>, it doesn't reject, and there's no HTTP client waiting on the other end.</li>
  </ul>
  <div class="notes"><p>Get this distinction settled early — every later slide about client behavior (backoff, retry, circuit gates) depends on knowing whether the client is being rejected or merely delayed.</p></div>
  <div class="foot"><span>3 / 45</span><span>rate limiting vs. throttling vs. load shedding</span></div>
</section>

<section class="slide" data-section="status-codes">
  <div class="eyebrow"><svg class="ic"><use href="#ic-log"/></svg>The vocabulary in HTTP</div>
  <h2>Three status codes that get confused</h2>
  <div class="split code-left">
    <pre class="code"><span class="hl">429</span> Too Many Requests   <span class="c">// rate limit — client sent too much</span>
<span class="hl">503</span> Service Unavailable <span class="c">// load shedding — server is overloaded</span>
<span class="hl">403</span> Forbidden           <span class="c">// authorization — NOT rate limiting</span>

Retry-After: 30                <span class="c">// seconds to wait</span>
X-RateLimit-Limit: 100         <span class="c">// the configured limit</span>
X-RateLimit-Remaining: 0       <span class="c">// how much is left</span>
X-RateLimit-Reset: 1704067320  <span class="c">// epoch time of the next reset</span></pre>
    <ul class="points tight">
      <li><b>429</b> is the client's fault — they can fix it by slowing down.</li>
      <li><b>503</b> is the server's problem — retrying won't necessarily help until it recovers.</li>
      <li><b>403</b> means "no," permanently, regardless of rate — retrying is never the fix.</li>
    </ul>
  </div>
  <div class="notes"><p>A surprising number of production incidents come from a client retrying a 403 as if it were a 429 — reading the code, not just the fact that something failed, matters.</p></div>
  <div class="foot"><span>4 / 45</span><span>status codes &amp; headers</span></div>
</section>
`);
