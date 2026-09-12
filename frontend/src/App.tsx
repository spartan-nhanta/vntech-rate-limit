import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AlgoParam {
  key: string
  label: string
  default: number
  step: number
  min: number
}

interface AlgoMeta {
  label: string
  desc: string
  params: AlgoParam[]
}

interface Config {
  algo: string
  params: Record<string, number>
}

interface SseEvent {
  ts: string
  user_id: string
  algo: string
  status: number
  retry_after_ms?: number | null
  state_snapshot: Record<string, unknown>
}

// ─── Algorithm definitions ────────────────────────────────────────────────────

const ALGOS: Record<string, AlgoMeta> = {
  token_bucket: {
    label: 'Token Bucket',
    desc: 'Bucket chứa token, refill liên tục. Cho phép burst ngắn hạn. Lazy refill — chỉ tính khi có request.',
    params: [
      { key: 'capacity',        label: 'Capacity (tokens)',   default: 5,   step: 1,   min: 1   },
      { key: 'rate_per_second', label: 'Refill rate (tok/s)', default: 0.5, step: 0.1, min: 0.1 },
    ],
  },
  leaky_bucket: {
    label: 'Leaky Bucket',
    desc: 'Queue với tốc độ drain cố định. Output đều đặn, không cho burst. Lazy drain — chỉ drain khi có request.',
    params: [
      { key: 'capacity',             label: 'Capacity (queue)',   default: 5,   step: 1,   min: 1   },
      { key: 'drain_rate_per_second', label: 'Drain rate (req/s)', default: 1.0, step: 0.1, min: 0.1 },
    ],
  },
  fixed_window: {
    label: 'Fixed Window',
    desc: 'Đếm trong cửa sổ cố định, reset mỗi window. Đơn giản nhưng có boundary spike.',
    params: [
      { key: 'limit',     label: 'Limit (requests)', default: 5,     step: 1,    min: 1    },
      { key: 'window_ms', label: 'Window (ms)',       default: 10000, step: 1000, min: 1000 },
    ],
  },
  sliding_log: {
    label: 'Sliding Log',
    desc: 'Lưu timestamp mỗi request trong sorted set. Chính xác tuyệt đối, nhưng memory O(n).',
    params: [
      { key: 'limit',     label: 'Limit (requests)', default: 5,     step: 1,    min: 1    },
      { key: 'window_ms', label: 'Window (ms)',       default: 10000, step: 1000, min: 1000 },
    ],
  },
  sliding_counter: {
    label: 'Sliding Counter',
    desc: 'Ước lượng có trọng số từ 2 window. Memory O(1). Chuẩn production — Cloudflare, Stripe dùng.',
    params: [
      { key: 'limit',     label: 'Limit (requests)', default: 5,     step: 1,    min: 1    },
      { key: 'window_ms', label: 'Window (ms)',       default: 10000, step: 1000, min: 1000 },
    ],
  },
}

type AlgoKey = keyof typeof ALGOS

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatState(snapshot: Record<string, unknown>): string {
  // Bỏ qua các field kỹ thuật không cần show cho audience
  const skip = new Set(['window_start_ms'])
  return Object.entries(snapshot)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => {
      // Làm tên đẹp hơn
      const label = k.replace(/_/g, ' ')
      const val = typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : v
      return `${label}: ${val}`
    })
    .join('  ·  ')
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function App() {
  const [selectedAlgo, setSelectedAlgo] = useState<AlgoKey>('token_bucket')
  const [paramValues, setParamValues] = useState<Record<string, number>>(
    () => Object.fromEntries(ALGOS.token_bucket.params.map(p => [p.key, p.default]))
  )
  const [currentConfig, setCurrentConfig] = useState<Config | null>(null)
  const [events, setEvents] = useState<SseEvent[]>([])
  const [sseStatus, setSseStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const esRef  = useRef<EventSource | null>(null)

  // ── Fetch current config on mount ─────────────────────────────────────────
  useEffect(() => {
    fetch('/config')
      .then(r => r.json())
      .then((cfg: Config) => {
        setCurrentConfig(cfg)
        const key = cfg.algo as AlgoKey
        if (ALGOS[key]) {
          setSelectedAlgo(key)
          setParamValues(cfg.params)
        }
      })
      .catch(() => showToast('err', 'Cannot connect to backend — is it running?'))
  }, [])

  // ── SSE connection ─────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/events')
    esRef.current = es

    es.onopen = () => setSseStatus('connected')
    es.onerror = () => setSseStatus('error')
    es.onmessage = (e: MessageEvent) => {
      const event: SseEvent = JSON.parse(e.data as string)
      setEvents(prev => [event, ...prev].slice(0, 200)) // newest on top, max 200
    }

    return () => es.close()
  }, [])

  // ── Auto-scroll log xuống khi có event mới ────────────────────────────────
  // (events newest-on-top nên không cần scroll — người dùng thấy ngay ở trên)

  // ── Handlers ──────────────────────────────────────────────────────────────
  const showToast = useCallback((type: 'ok' | 'err', text: string) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 2500)
  }, [])

  const handleAlgoChange = (key: AlgoKey) => {
    setSelectedAlgo(key)
    setParamValues(Object.fromEntries(ALGOS[key].params.map(p => [p.key, p.default])))
  }

  const handleApply = async () => {
    try {
      await fetch('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ algo: selectedAlgo, params: paramValues }),
      })
      setCurrentConfig({ algo: selectedAlgo, params: { ...paramValues } })
      showToast('ok', `Applied: ${ALGOS[selectedAlgo].label}`)
    } catch {
      showToast('err', 'Apply failed')
    }
  }

  const handleReset = async () => {
    try {
      await fetch('/config/reset', { method: 'POST' })
      showToast('ok', 'State reset — Redis keys cleared')
    } catch {
      showToast('err', 'Reset failed')
    }
  }

  const handleParamChange = (key: string, raw: string) => {
    const val = parseFloat(raw)
    if (!isNaN(val)) setParamValues(prev => ({ ...prev, [key]: val }))
  }

  const algoMeta = ALGOS[selectedAlgo]

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-title">
          <span className="header-icon">⚡</span>
          <span>Rate Limit Admin</span>
        </div>
        <div className={`sse-pill ${sseStatus}`}>
          <span className="sse-dot" />
          {sseStatus === 'connected' ? 'SSE live' : sseStatus === 'connecting' ? 'Connecting…' : 'SSE error'}
        </div>
      </header>

      <div className="layout">
        {/* ── LEFT: Config panel ─────────────────────────────────────────── */}
        <aside className="sidebar">

          {/* Algo picker */}
          <section className="card">
            <div className="card-title">Algorithm</div>
            <div className="algo-list">
              {(Object.keys(ALGOS) as AlgoKey[]).map(key => (
                <button
                  key={key}
                  className={`algo-btn ${selectedAlgo === key ? 'selected' : ''}`}
                  onClick={() => handleAlgoChange(key)}
                >
                  {ALGOS[key].label}
                </button>
              ))}
            </div>
            <p className="algo-desc">{algoMeta.desc}</p>
          </section>

          {/* Params */}
          <section className="card">
            <div className="card-title">Parameters</div>
            <div className="param-list">
              {algoMeta.params.map(p => (
                <div key={p.key} className="param-row">
                  <label className="param-label">{p.label}</label>
                  <input
                    className="param-input"
                    type="number"
                    value={paramValues[p.key] ?? p.default}
                    step={p.step}
                    min={p.min}
                    onChange={e => handleParamChange(p.key, e.target.value)}
                  />
                </div>
              ))}
            </div>

            <div className="btn-row">
              <button className="btn-primary" onClick={handleApply}>Apply</button>
              <button className="btn-reset"   onClick={handleReset}>Reset State</button>
            </div>

            {toast && <div className={`toast ${toast.type}`}>{toast.text}</div>}
          </section>

          {/* Active config */}
          {currentConfig && (
            <section className="card">
              <div className="card-title">Active Config</div>
              <div className="config-kv">
                <div className="kv-row">
                  <span className="kv-key">algo</span>
                  <span className="kv-val algo-badge">{currentConfig.algo}</span>
                </div>
                {Object.entries(currentConfig.params).map(([k, v]) => (
                  <div key={k} className="kv-row">
                    <span className="kv-key">{k}</span>
                    <span className="kv-val">{v}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Test helper */}
          <section className="card hint-card">
            <div className="card-title">Test endpoint</div>
            <code className="hint-code">GET /api/hello?user_id=alice</code>
            <p className="hint-text">Fire nhiều lần để thấy 200 → 429 trong log.</p>
          </section>
        </aside>

        {/* ── RIGHT: Event log ───────────────────────────────────────────── */}
        <main className="log-panel">
          <div className="log-header">
            <span className="log-title">
              Event Log
              <span className="log-count">{events.length}</span>
            </span>
            <button className="btn-clear" onClick={() => setEvents([])}>Clear</button>
          </div>

          <div className="log-list" ref={logRef}>
            {events.length === 0 && (
              <div className="log-empty">
                No events yet — start sending requests to <code>/api/hello?user_id=alice</code>
              </div>
            )}
            {events.map((ev, i) => {
              const is429 = ev.status !== 200
              return (
                <div key={i} className={`log-row ${is429 ? 'fail' : 'ok'}`}>
                  <span className="col-ts">{ev.ts}</span>
                  <span className="col-user">{ev.user_id}</span>
                  <span className="col-algo">{ev.algo}</span>
                  <span className={`col-status ${is429 ? 'fail' : 'ok'}`}>
                    {is429 ? '❌ 429' : '✅ 200'}
                  </span>
                  <span className="col-state">
                    {is429
                      ? `retry after ${ev.retry_after_ms ?? '?'}ms`
                      : formatState(ev.state_snapshot)
                    }
                  </span>
                </div>
              )
            })}
          </div>
        </main>
      </div>
    </div>
  )
}
