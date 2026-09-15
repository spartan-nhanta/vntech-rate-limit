import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import './App.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type RequestTag = 'probe' | 'burst-1' | 'burst-2'

interface RequestResult {
  ts: string
  status: number
  algo: string
  retryAfterMs?: number
  state: Record<string, unknown>
  tag?: RequestTag
}

interface WindowInfo {
  resetInMs: number    // reset_in_ms từ backend lúc nhận response
  receivedAt: number   // Date.now() lúc nhận — dùng để extrapolate remaining
  limit: number        // limit của algo (nếu có)
}

// ─── Constants ────────────────────────────────────────────────────────────────

const USER_PRESETS = ['user_A', 'user_B', 'user_C']

function formatStateCompact(state: Record<string, unknown>): string {
  // window_id hiển thị riêng thành badge, window_start_ms là chi tiết kỹ thuật
  const skip = new Set(['window_start_ms', 'window_id'])
  return Object.entries(state)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => {
      // tokens luôn hiện 2 chữ số lẻ (JSON 4.0 parse ra 4 → phải format riêng)
      const val = typeof v === 'number'
        ? (k === 'tokens' || !Number.isInteger(v) ? v.toFixed(2) : v)
        : v
      return `${k.replace(/_/g, ' ')}: ${val}`
    })
    .join('  ·  ')
}

/** window_id là số rất lớn (nowMs/windowMs) — rút gọn cho dễ đọc */
function windowIdOf(state: Record<string, unknown>): number | null {
  return typeof state.window_id === 'number' ? state.window_id : null
}
function shortWindowId(id: number): string {
  return `W${id % 1000}`
}

function now(): string {
  const d = new Date()
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':')
    + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Đồng hồ HH:MM:ss cho audience canh thời điểm click */
function LiveClock() {
  const [time, setTime] = useState(() => now().slice(0, 8))
  useEffect(() => {
    // tick 200ms để không bị trễ/nhảy cóc giây
    const id = setInterval(() => setTime(now().slice(0, 8)), 200)
    return () => clearInterval(id)
  }, [])
  return <div className="live-clock">🕒 {time}</div>
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [userId, setUserId]           = useState('user_A')
  const [customId, setCustomId]       = useState('')
  const [isAutoFiring, setAutoFiring] = useState(false)
  const [fireRate, setFireRate]       = useState(2)
  const [totalTarget, setTotalTarget] = useState(20)
  const [batchSent, setBatchSent]     = useState(0)
  const [lastResult, setLastResult]   = useState<RequestResult | null>(null)
  const [results, setResults]         = useState<RequestResult[]>([])
  const [stats, setStats]             = useState({ ok: 0, fail: 0 })
  const [loading, setLoading]         = useState(false)

  // Window countdown (cho Fixed Window / Sliding Counter)
  const [windowInfo, setWindowInfo]   = useState<WindowInfo | null>(null)
  const [countdown, setCountdown]     = useState<number | null>(null)    // ms remaining

  // Boundary burst
  const [burstPhase, setBurstPhase]   = useState<string | null>(null)    // null = idle

  const batchCountRef = useRef(0)
  const activeId = customId.trim() !== '' ? customId.trim() : userId

  // ── Core send (không có loading guard — dùng cho auto-fire & burst) ─────────
  const doSend = useCallback(async (): Promise<RequestResult | null> => {
    try {
      const res = await fetch(`/api/hello?user_id=${encodeURIComponent(activeId)}`)
      const data = await res.json() as Record<string, unknown>

      const result: RequestResult = {
        ts:           now(),
        status:       res.status,
        algo:         (data.algo ?? data.error ?? '') as string,
        retryAfterMs: res.status !== 200
          ? (data.retry_after_ms as number | undefined)
          : undefined,
        state: (data.state ?? {}) as Record<string, unknown>,
      }

      setLastResult(result)
      setResults(prev => [result, ...prev].slice(0, 150))
      setStats(prev => ({
        ok:   prev.ok   + (res.status === 200 ? 1 : 0),
        fail: prev.fail + (res.status !== 200 ? 1 : 0),
      }))

      // Cập nhật window info nếu response có reset_in_ms (Fixed Window, Sliding Counter)
      const s = result.state
      if (typeof s.reset_in_ms === 'number' && s.reset_in_ms > 0) {
        setWindowInfo({
          resetInMs:  s.reset_in_ms,
          receivedAt: Date.now(),
          limit:      typeof s.limit === 'number' ? s.limit : 5,
        })
      }

      return result
    } catch {
      return null
    }
  }, [activeId])

  // ── Manual send button ────────────────────────────────────────────────────────
  const sendRequest = useCallback(async () => {
    if (loading) return
    setLoading(true)
    await doSend()
    setLoading(false)
  }, [loading, doSend])

  // Keep ref stable for interval
  const doSendRef = useRef(doSend)
  useEffect(() => { doSendRef.current = doSend }, [doSend])

  // ── Auto-fire interval ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAutoFiring) return
    batchCountRef.current = 0
    setBatchSent(0)

    const ms = Math.max(100, Math.round(1000 / fireRate))
    const id = setInterval(() => {
      if (batchCountRef.current >= totalTarget) {
        setAutoFiring(false)
        clearInterval(id)
        return
      }
      batchCountRef.current += 1
      setBatchSent(batchCountRef.current)
      void doSendRef.current()
    }, ms)

    return () => clearInterval(id)
  }, [isAutoFiring, fireRate, totalTarget])

  // Stop auto-fire khi đổi user
  useEffect(() => { setAutoFiring(false) }, [activeId])

  // ── Countdown ticker — đếm ngược từ windowInfo ────────────────────────────────
  useEffect(() => {
    if (!windowInfo) { setCountdown(null); return }

    const tick = () => {
      const elapsed = Date.now() - windowInfo.receivedAt
      const rem     = windowInfo.resetInMs - elapsed
      if (rem <= 0) {
        setCountdown(0)
        setWindowInfo(null) // clear — sẽ update từ request tiếp theo
      } else {
        setCountdown(rem)
      }
    }
    tick()
    const id = setInterval(tick, 50)
    return () => clearInterval(id)
  }, [windowInfo])

  // ── Boundary Burst ─────────────────────────────────────────────────────────────
  //
  // Dùng raw fetch để tránh React closure/stale-ref issues.
  // Live countdown update qua setInterval trong khi sleep chờ boundary.
  //
  const runBoundaryBurst = useCallback(async () => {
    if (burstPhase !== null) return
    setBurstPhase('🔍 Probing window state...')

    // Helper: gửi 1 request, cập nhật log + stats + lastResult
    const rawSend = async (tag: RequestTag): Promise<{ resetInMs: number; limit: number }> => {
      const res  = await fetch(`/api/hello?user_id=${encodeURIComponent(activeId)}`)
      const data = await res.json() as Record<string, unknown>
      const s    = (data.state ?? {}) as Record<string, unknown>

      const result: RequestResult = {
        ts:           now(),
        status:       res.status,
        algo:         (data.algo ?? '') as string,
        retryAfterMs: res.status !== 200 ? (data.retry_after_ms as number | undefined) : undefined,
        state:        s,
        tag,
      }
      setLastResult(result)
      setResults(prev => [result, ...prev].slice(0, 150))
      setStats(prev => ({
        ok:   prev.ok   + (res.status === 200 ? 1 : 0),
        fail: prev.fail + (res.status !== 200 ? 1 : 0),
      }))
      // Update window countdown
      if (typeof s.reset_in_ms === 'number' && s.reset_in_ms > 0) {
        setWindowInfo({ resetInMs: s.reset_in_ms, receivedAt: Date.now(), limit: typeof s.limit === 'number' ? s.limit : 5 })
      }
      return {
        resetInMs: typeof s.reset_in_ms === 'number' ? s.reset_in_ms : 0,
        limit:     typeof s.limit      === 'number' ? s.limit      : 5,
      }
    }

    // Bước 1: Probe để đọc reset_in_ms
    const { resetInMs, limit } = await rawSend('probe')

    if (resetInMs === 0) {
      setBurstPhase('❌ Algo không có window — dùng Fixed Window hoặc Sliding Counter')
      setTimeout(() => setBurstPhase(null), 3000)
      return
    }

    // Bước 1.5: Reset state — probe vừa chiếm 1 slot, phải trả lại cho burst.
    // Boundary căn theo clock (nowMs / windowMs) nên xóa key KHÔNG làm lệch timing.
    setBurstPhase('🧹 Reset state (trả lại slot của probe)...')
    await fetch('/config/reset', { method: 'POST' })

    // Bước 2: Chờ đến khi còn ~300ms trước boundary
    // Live countdown cập nhật mỗi 100ms qua setInterval riêng
    const probeAt = Date.now()
    const fireAt  = probeAt + resetInMs - 300   // thời điểm fire burst 1
    const waitMs  = Math.max(0, fireAt - Date.now())

    if (waitMs > 0) {
      // setInterval để update phase text live trong khi sleep chờ
      const ticker = setInterval(() => {
        const rem = Math.max(0, fireAt - Date.now())
        setBurstPhase(`⏳ Chờ boundary... ${(rem / 1000).toFixed(1)}s`)
      }, 100)
      await sleep(waitMs)
      clearInterval(ticker)
    }

    // Bước 3: Burst TRƯỚC reset (25ms giữa mỗi request cho log dễ đọc)
    setBurstPhase(`🔴 Burst 1: ${limit} req trước boundary`)
    for (let i = 0; i < limit; i++) {
      await rawSend('burst-1')
      if (i < limit - 1) await sleep(25)
    }

    // Bước 4: Chờ qua boundary
    setBurstPhase('⏳ Chờ window reset...')
    await sleep(400)

    // Bước 5: Burst SAU reset
    setBurstPhase(`🟢 Burst 2: ${limit} req sau boundary`)
    for (let i = 0; i < limit; i++) {
      await rawSend('burst-2')
      if (i < limit - 1) await sleep(25)
    }

    setBurstPhase(`✅ Done! ${limit * 2} requests ≈ ${(((limit * 2 * 25) + 400) / 1000).toFixed(1)}s`)
    setTimeout(() => setBurstPhase(null), 3000)
  }, [activeId, burstPhase])

  const handleClear = () => {
    setResults([])
    setStats({ ok: 0, fail: 0 })
    setLastResult(null)
    setWindowInfo(null)
    setCountdown(null)
  }

  // ── Derived ────────────────────────────────────────────────────────────────────
  const statusClass =
    lastResult === null         ? 'idle'
    : lastResult.status === 200 ? 'ok'
    : lastResult.status !== 0   ? 'fail'
    : 'net-err'

  const countdownSec  = countdown != null ? countdown / 1000 : null
  const windowMs      = windowInfo ? windowInfo.resetInMs : null
  const progressPct   = windowMs && countdown != null
    ? Math.max(0, Math.min(100, (countdown / windowMs) * 100))
    : null

  // ── Render ─────────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <span className="header-icon">🌐</span>
          <span>Rate Limit Client</span>
        </div>
        <LiveClock />
        <a className="admin-link" href="http://localhost:3000" target="_blank" rel="noreferrer">
          Open Admin →
        </a>
      </header>

      <div className="body">
        {/* User ID picker */}
        <section className="user-bar">
          <span className="user-label">User ID</span>
          <div className="user-presets">
            {USER_PRESETS.map(id => (
              <button
                key={id}
                className={`preset-btn ${activeId === id && customId === '' ? 'active' : ''}`}
                onClick={() => { setUserId(id); setCustomId('') }}
              >
                {id}
              </button>
            ))}
          </div>
          <input
            className="custom-input"
            type="text"
            placeholder="custom id…"
            value={customId}
            onChange={e => setCustomId(e.target.value)}
          />
          <span className="active-id-badge">→ {activeId}</span>
        </section>

        <div className="main-grid">
          {/* Status card */}
          <div className={`status-card ${statusClass}`}>
            <div className="status-emoji">
              {statusClass === 'idle' ? '⏳' : statusClass === 'ok' ? '✅' : statusClass === 'fail' ? '❌' : '⚠️'}
            </div>
            <div className="status-code">
              {lastResult === null ? '—' : lastResult.status === 0 ? 'ERR' : lastResult.status}
            </div>
            <div className="status-label">
              {lastResult === null      ? 'No requests yet'
               : statusClass === 'ok'  ? 'Request allowed'
               : statusClass === 'fail'? 'Rate limited'
               : 'Network error'}
            </div>
            {lastResult?.status === 200 && (
              <div className="status-state">{formatStateCompact(lastResult.state)}</div>
            )}
            {lastResult?.status !== 200 && lastResult?.retryAfterMs != null && (
              <div className="status-retry">retry after {lastResult.retryAfterMs} ms</div>
            )}
            <button
              className={`send-btn ${loading ? 'loading' : ''}`}
              onClick={() => { void sendRequest() }}
              disabled={loading}
            >
              {loading ? 'Sending…' : 'Send Request'}
            </button>
          </div>

          {/* Controls card */}
          <div className="controls-card">
            {/* ── Auto-fire ───────────────────────────────── */}
            <div className="card-title">Auto-fire</div>

            <div className="rate-row">
              <span className="rate-label">Rate</span>
              <input className="rate-slider" type="range" min={1} max={10} step={1}
                value={fireRate} disabled={isAutoFiring}
                onChange={e => setFireRate(Number(e.target.value))} />
              <span className="rate-value">{fireRate} req/s</span>
            </div>

            <div className="total-row">
              <span className="rate-label">Total</span>
              <input className="total-input" type="number" min={1} max={500} step={1}
                value={totalTarget} disabled={isAutoFiring}
                onChange={e => setTotalTarget(Math.max(1, Number(e.target.value)))} />
              <span className="interval-hint-inline">
                ≈ {(totalTarget / fireRate).toFixed(1)}s
              </span>
            </div>

            {isAutoFiring && (
              <div className="progress-wrap">
                <div className="progress-bar"
                  style={{ width: `${Math.min(100, (batchSent / totalTarget) * 100)}%` }} />
                <span className="progress-text">{batchSent} / {totalTarget}</span>
              </div>
            )}

            <button
              className={`autofire-btn ${isAutoFiring ? 'on' : 'off'}`}
              onClick={() => setAutoFiring(v => !v)}
            >
              {isAutoFiring ? `⏹ Stop  (${batchSent}/${totalTarget})` : '▶ Start Auto-fire'}
            </button>

            {/* ── Boundary Burst ──────────────────────────── */}
            <div className="divider" />
            <div className="card-title">Boundary Burst</div>
            <div className="burst-hint">
              Tự động fire burst trước + sau khi window reset.<br />
              Dùng với <strong>Fixed Window</strong> / <strong>Sliding Counter</strong>.
            </div>

            {/* Window countdown */}
            {countdownSec !== null && progressPct !== null && (
              <div className="window-countdown">
                <div className="window-bar-wrap">
                  <div className="window-bar" style={{ width: `${progressPct}%` }} />
                </div>
                <span className="window-remaining">
                  reset in {countdownSec.toFixed(2)}s
                </span>
              </div>
            )}
            {countdownSec === null && (
              <div className="window-no-info">
                Gửi 1 request để thấy countdown.
              </div>
            )}

            {burstPhase && (
              <div className="burst-phase">{burstPhase}</div>
            )}

            <button
              className="burst-btn"
              onClick={() => { void runBoundaryBurst() }}
              disabled={burstPhase !== null}
            >
              🎯 Run Boundary Burst
            </button>

            {/* ── Stats ──────────────────────────────────── */}
            <div className="divider" />
            <div className="stats-row">
              <div className="stat ok">
                <span className="stat-num">{stats.ok}</span>
                <span className="stat-lbl">✅ allowed</span>
              </div>
              <div className="stat fail">
                <span className="stat-num">{stats.fail}</span>
                <span className="stat-lbl">❌ blocked</span>
              </div>
              <div className="stat total">
                <span className="stat-num">{stats.ok + stats.fail}</span>
                <span className="stat-lbl">total</span>
              </div>
            </div>
          </div>
        </div>

        {/* Request log */}
        <div className="log-section">
          <div className="log-header">
            <span className="log-title">
              Request Log <span className="log-count">{results.length}</span>
            </span>
            <button className="btn-clear" onClick={handleClear}>Clear</button>
          </div>
          <div className="log-list">
            {results.length === 0 && (
              <div className="log-empty">No requests sent yet.</div>
            )}
            {results.map((r, i) => {
              const win     = windowIdOf(r.state)
              // results[] newest-first → phần tử i+1 là request CŨ hơn
              const olderWin = i + 1 < results.length ? windowIdOf(results[i + 1].state) : null
              const isBoundary = win != null && olderWin != null && win !== olderWin

              return (
                <Fragment key={i}>
                  <div className={`log-row ${r.status === 200 ? 'ok' : 'fail'}`}>
                    <span className="col-ts">{r.ts}</span>
                    {win != null && <span className="col-window">{shortWindowId(win)}</span>}
                    {r.tag && <span className={`col-tag tag-${r.tag}`}>{r.tag}</span>}
                    <span className={`col-status ${r.status === 200 ? 'ok' : 'fail'}`}>
                      {r.status === 200 ? '✅ 200' : r.status === 0 ? '⚠️ ERR' : '❌ 429'}
                    </span>
                    <span className="col-detail">
                      {r.status === 200
                        ? formatStateCompact(r.state)
                        : r.retryAfterMs != null ? `retry after ${r.retryAfterMs}ms` : r.algo}
                    </span>
                  </div>

                  {/* Divider giữa 2 window — audience thấy ngay boundary ở đâu */}
                  {isBoundary && (
                    <div className="window-divider">
                      <span className="divider-line" />
                      <span className="divider-label">
                        ⬆ {shortWindowId(win)}  ·  WINDOW BOUNDARY  ·  {shortWindowId(olderWin)} ⬇
                      </span>
                      <span className="divider-line" />
                    </div>
                  )}
                </Fragment>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
