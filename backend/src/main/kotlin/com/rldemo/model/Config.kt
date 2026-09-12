package com.rldemo.model

/**
 * Config của rate limiter, lưu trong Redis key "rl:config" dưới dạng JSON.
 *
 * [algo] — một trong: fixed_window | sliding_log | sliding_counter | token_bucket | leaky_bucket
 * [params] — map số, ý nghĩa tùy algo:
 *   - fixed_window / sliding_log / sliding_counter: window_seconds, limit
 *   - token_bucket: capacity, rate_per_second
 *   - leaky_bucket: capacity, drain_rate_per_second
 *
 * Dùng Double cho tất cả để tránh ép kiểu khi Jackson parse JSON number.
 */
data class Config(
    val algo: String = "token_bucket",
    val params: Map<String, Double> = mapOf(
        "capacity" to 5.0,
        "rate_per_second" to 0.5
    )
)
