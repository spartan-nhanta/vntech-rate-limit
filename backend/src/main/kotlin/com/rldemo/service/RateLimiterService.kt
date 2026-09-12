package com.rldemo.service

import com.rldemo.algorithm.*
import com.rldemo.model.Config
import com.rldemo.model.RateLimitResult
import jakarta.inject.Singleton

/**
 * RateLimiterService — dispatch đến đúng algorithm dựa trên config.algo.
 *
 * Pattern: Strategy — mỗi algo là 1 Singleton bean, service chọn đúng cái.
 * Không có if-else dài vì dùng when expression trên String.
 *
 * Tại sao inject 5 algo riêng thay vì Map<String, RateLimiter>?
 *   → Type-safe hơn, Micronaut DI rõ ràng hơn
 *   → Nếu muốn dùng Map thì: @Named("fixed_window") trong @Singleton của mỗi algo
 */
@Singleton
class RateLimiterService(
    private val fixedWindow: FixedWindowLimiter,
    private val slidingLog: SlidingLogLimiter,
    private val slidingCounter: SlidingCounterLimiter,
    private val tokenBucket: TokenBucketLimiter,
    private val leakyBucket: LeakyBucketLimiter
) {
    suspend fun check(userId: String, config: Config): RateLimitResult {
        return when (config.algo) {
            "fixed_window"    -> fixedWindow.check(userId, config.params)
            "sliding_log"     -> slidingLog.check(userId, config.params)
            "sliding_counter" -> slidingCounter.check(userId, config.params)
            "token_bucket"    -> tokenBucket.check(userId, config.params)
            "leaky_bucket"    -> leakyBucket.check(userId, config.params)
            // Unknown algo → fallback về token bucket, không crash
            else              -> tokenBucket.check(userId, config.params)
        }
    }
}
