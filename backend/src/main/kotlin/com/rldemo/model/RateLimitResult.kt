package com.rldemo.model

/**
 * Kết quả trả về từ mỗi rate limiter algorithm.
 *
 * [allowed] — true = cho qua (HTTP 200), false = chặn (HTTP 429)
 * [retryAfterMs] — bao nhiêu ms nữa thì được phép thử lại (0 nếu allowed)
 * [stateSnapshot] — state hiện tại của bucket/counter để hiển thị trên Admin visualizer
 *   Nội dung khác nhau theo algo:
 *   - fixed_window:    { count, limit, reset_in_ms }
 *   - token_bucket:    { tokens, capacity }
 *   - sliding_log:     { count, limit }
 *   - sliding_counter: { estimate, prev_count, curr_count, weight_pct }
 *   - leaky_bucket:    { queue_size, capacity }
 */
data class RateLimitResult(
    val allowed: Boolean,
    val retryAfterMs: Long = 0L,
    val stateSnapshot: Map<String, Any> = emptyMap()
)
