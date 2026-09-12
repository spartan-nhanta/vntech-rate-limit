package com.rldemo.algorithm

import com.rldemo.model.RateLimitResult
import io.lettuce.core.api.StatefulRedisConnection
import jakarta.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Token Bucket
 *
 * State trong Redis: Hash với 2 field
 *   rl:{userId}:tb → { tokens: Double, ts: Long(ms) }
 *
 * Cơ chế "lazy refill":
 *   - Không có background job nạp token
 *   - Mỗi khi có request, tính elapsed = now - last_ts
 *   - new_tokens = min(capacity, tokens + elapsed × rate_per_ms)
 *   - Nếu new_tokens >= 1 → cho qua, tokens--
 *
 * Tại sao HMGET → HMSET cần Lua:
 *   Nếu không có Lua, 2 pod có thể cùng đọc tokens=3, cùng thấy >= 1,
 *   cùng ghi tokens=2 → mất 1 lần trừ.
 *
 * Params: capacity (số token tối đa), rate_per_second (token/giây)
 * Return từ Lua: [allowed(1/0), tokens_remaining_floor, retry_after_ms]
 */
@Singleton
class TokenBucketLimiter(
    private val connection: StatefulRedisConnection<String, String>
) : RateLimiter {

    override val name = "token_bucket"

    private val script = """
        local key       = KEYS[1]
        local now       = tonumber(ARGV[1])   -- ms
        local rate_ms   = tonumber(ARGV[2])   -- token per ms = rate_per_second / 1000
        local capacity  = tonumber(ARGV[3])

        -- Đọc state hiện tại
        local state    = redis.call('HMGET', key, 'tokens', 'ts')
        local tokens   = tonumber(state[1]) or capacity
        local last_ts  = tonumber(state[2]) or now

        -- Tính token tích lũy từ lần trước đến giờ (lazy refill)
        local elapsed   = now - last_ts
        local new_tokens = math.min(capacity, tokens + elapsed * rate_ms)

        if new_tokens >= 1.0 then
            local remaining = new_tokens - 1.0
            redis.call('HMSET', key, 'tokens', remaining, 'ts', now)
            -- TTL: thời gian để fill đầy bucket từ 0 → capacity
            local ttl_ms = math.ceil(capacity / rate_ms)
            redis.call('PEXPIRE', key, ttl_ms)
            return {1, math.floor(remaining), 0}
        else
            -- Cần thêm bao nhiêu ms để có đủ 1 token
            local retry_ms = math.ceil((1.0 - new_tokens) / rate_ms)
            return {0, 0, retry_ms}
        end
    """.trimIndent()

    override suspend fun check(userId: String, params: Map<String, Double>): RateLimitResult =
        withContext(Dispatchers.IO) {
            val capacity       = (params["capacity"] ?: 5.0)
            val ratePerSecond  = (params["rate_per_second"] ?: 0.5)
            // Chuyển rate sang token/ms để Lua tính elapsed (ms)
            val ratePerMs      = ratePerSecond / 1000.0
            val nowMs          = System.currentTimeMillis()
            val key            = "rl:{${userId}}:tb"

            val sync = connection.sync()

            @Suppress("UNCHECKED_CAST")
            val result = sync.eval<List<Long>>(
                script,
                io.lettuce.core.ScriptOutputType.MULTI,
                arrayOf(key),
                nowMs.toString(),
                ratePerMs.toString(),
                capacity.toString()
            )

            val allowed        = result[0] == 1L
            val tokensFloor    = result[1]
            val retryAfterMs   = result[2]

            RateLimitResult(
                allowed = allowed,
                retryAfterMs = if (allowed) 0L else retryAfterMs,
                stateSnapshot = mapOf(
                    "tokens"   to tokensFloor,
                    "capacity" to capacity.toLong()
                )
            )
        }
}
