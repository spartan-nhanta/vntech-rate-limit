package com.rldemo.algorithm

import com.rldemo.model.RateLimitResult
import io.lettuce.core.api.StatefulRedisConnection
import jakarta.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Sliding Window Log
 *
 * Dữ liệu: Redis Sorted Set, mỗi member = timestamp của 1 request
 *   Key: rl:{userId}:sl
 *   Score = timestamp (ms)
 *   Member = timestamp.toString() (member phải unique)
 *     → Nếu 2 request cùng ms, dùng "ts:nanoOffset" để tránh trùng
 *
 * Flow:
 *   1. ZREMRANGEBYSCORE → xóa entry ngoài cửa sổ (< now - window_ms)
 *   2. ZCARD → đếm request trong cửa sổ
 *   3. Nếu count < limit → ZADD → ghi request mới
 *
 * Tại sao cần Lua: nếu không có Lua, giữa ZCARD và ZADD có thể có pod khác
 * ZADD trước → count thật sự vượt limit nhưng cả 2 pod đều thấy count < limit.
 *
 * Return từ Lua: [allowed(1/0), current_count, retry_after_ms]
 */
@Singleton
class SlidingLogLimiter(
    private val connection: StatefulRedisConnection<String, String>
) : RateLimiter {

    override val name = "sliding_log"

    private val script = """
        local key        = KEYS[1]
        local now        = tonumber(ARGV[1])
        local window_ms  = tonumber(ARGV[2])
        local limit      = tonumber(ARGV[3])

        local window_start = now - window_ms

        -- 1. Xóa các entry cũ hơn window
        redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

        -- 2. Đếm còn lại
        local count = redis.call('ZCARD', key)

        if count < limit then
            -- 3. Ghi timestamp mới. Member = "now:count" để tránh trùng nếu 2 req cùng ms
            local member = tostring(now) .. ':' .. tostring(count)
            redis.call('ZADD', key, now, member)
            redis.call('PEXPIRE', key, window_ms)
            return {1, count + 1, 0}
        else
            -- Retry after: timestamp cũ nhất + window_ms - now
            local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
            local retry_after = window_ms
            if #oldest >= 2 then
                local oldest_ts = tonumber(oldest[2])
                retry_after = math.max(0, oldest_ts + window_ms - now)
            end
            return {0, count, retry_after}
        end
    """.trimIndent()

    override suspend fun check(userId: String, params: Map<String, Double>): RateLimitResult =
        withContext(Dispatchers.IO) {
            val windowMs = ((params["window_seconds"] ?: 10.0) * 1000).toLong()
            val limit    = (params["limit"] ?: 5.0).toLong()
            val nowMs    = System.currentTimeMillis()
            val key      = "rl:{${userId}}:sl"

            val sync = connection.sync()

            @Suppress("UNCHECKED_CAST")
            val result = sync.eval<List<Long>>(
                script,
                io.lettuce.core.ScriptOutputType.MULTI,
                arrayOf(key),
                nowMs.toString(),
                windowMs.toString(),
                limit.toString()
            )

            val allowed      = result[0] == 1L
            val count        = result[1]
            val retryAfterMs = result[2]

            RateLimitResult(
                allowed = allowed,
                retryAfterMs = if (allowed) 0L else retryAfterMs,
                stateSnapshot = mapOf(
                    "count"  to count,
                    "limit"  to limit
                )
            )
        }
}
