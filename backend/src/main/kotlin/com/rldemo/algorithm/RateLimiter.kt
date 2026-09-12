package com.rldemo.algorithm

import com.rldemo.model.RateLimitResult

/**
 * Interface chung cho 5 thuật toán.
 * Mỗi implementation nhận [userId] + [params] map từ Config
 * và trả về RateLimitResult với state snapshot để visualize.
 */
interface RateLimiter {
    val name: String
    suspend fun check(userId: String, params: Map<String, Double>): RateLimitResult
}
