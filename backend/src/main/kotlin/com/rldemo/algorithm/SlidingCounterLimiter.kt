package com.rldemo.algorithm

import com.rldemo.model.RateLimitResult
import io.lettuce.core.api.StatefulRedisConnection
import jakarta.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Sliding Window Counter (Approximate)
 *
 * Dùng 2 counter: prev_window và curr_window
 *   Keys: rl:{userId}:sc:{windowIndex-1}  (prev)
 *         rl:{userId}:sc:{windowIndex}     (curr)
 *
 * Công thức ước lượng:
 *   weight   = 1 - (elapsed / window_ms)  ← phần trăm window cũ còn nằm trong cửa sổ hiện tại
 *   estimate = prev_count × weight + curr_count
 *
 * Ví dụ: window=10s, tại T=7s (đã qua 7/10 của window hiện tại)
 *   weight = 1 - 7/10 = 30% — còn 30% của window cũ nằm trong cửa sổ trượt
 *   estimate = prev_count × 0.3 + curr_count
 *
 * Worst case: burst 4 req lúc cuối window cũ + burst 4 req lúc cuối window mới
 *   = 8 req thực, nhưng estimate = 4 × (1/10s) + 4 ≈ 4.4 → cho qua
 *   (với limit=5 thì ổn, nhưng hiểu nguyên lý là vẫn có thể vượt)
 *
 * Return từ Lua: [allowed(1/0), estimate, prev_count, curr_count, weight_pct]
 */
@Singleton
class SlidingCounterLimiter(
    private val connection: StatefulRedisConnection<String, String>
) : RateLimiter {

    override val name = "sliding_counter"

    private val script = """
        local prev_key   = KEYS[1]
        local curr_key   = KEYS[2]
        local now        = tonumber(ARGV[1])
        local window_ms  = tonumber(ARGV[2])
        local limit      = tonumber(ARGV[3])

        -- Tính elapsed = bao nhiêu ms đã trôi qua trong window hiện tại
        local window_start = math.floor(now / window_ms) * window_ms
        local elapsed      = now - window_start
        local weight       = 1.0 - (elapsed / window_ms)

        local prev_count = tonumber(redis.call('GET', prev_key)) or 0
        local curr_count = tonumber(redis.call('GET', curr_key)) or 0

        -- floor để tránh floating point artifacts
        local estimate = math.floor(prev_count * weight + curr_count)

        if estimate < limit then
            local new_count = redis.call('INCR', curr_key)
            if new_count == 1 then
                -- TTL = 2 window: window hiện tại + 1 window nữa (key sẽ là prev rồi)
                redis.call('PEXPIRE', curr_key, window_ms * 2)
            end
            local weight_pct = math.floor(weight * 100)
            return {1, estimate + 1, prev_count, curr_count, weight_pct}
        else
            local weight_pct = math.floor(weight * 100)
            return {0, estimate, prev_count, curr_count, weight_pct}
        end
    """.trimIndent()

    override suspend fun check(userId: String, params: Map<String, Double>): RateLimitResult =
        withContext(Dispatchers.IO) {
            val windowMs = ((params["window_seconds"] ?: 10.0) * 1000).toLong()
            val limit    = (params["limit"] ?: 5.0).toLong()
            val nowMs    = System.currentTimeMillis()

            val currIndex = nowMs / windowMs
            val prevIndex = currIndex - 1

            // Hash tag {userId} đảm bảo cả 2 key (prev và curr) vào cùng slot Redis
            val prevKey = "rl:{${userId}}:sc:${prevIndex}"
            val currKey = "rl:{${userId}}:sc:${currIndex}"

            val sync = connection.sync()

            @Suppress("UNCHECKED_CAST")
            val result = sync.eval<List<Long>>(
                script,
                io.lettuce.core.ScriptOutputType.MULTI,
                arrayOf(prevKey, currKey),
                nowMs.toString(),
                windowMs.toString(),
                limit.toString()
            )

            val allowed    = result[0] == 1L
            val estimate   = result[1]
            val prevCount  = result[2]
            val currCount  = result[3]
            val weightPct  = result[4]

            RateLimitResult(
                allowed = allowed,
                // Retry-after thô: chờ đến cuối window hiện tại
                retryAfterMs = if (allowed) 0L else windowMs - (nowMs % windowMs),
                stateSnapshot = mapOf(
                    "estimate"   to estimate,
                    "prev_count" to prevCount,
                    "curr_count" to currCount,
                    "weight_pct" to weightPct,
                    "limit"      to limit
                )
            )
        }
}
