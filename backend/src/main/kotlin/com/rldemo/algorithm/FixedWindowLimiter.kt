package com.rldemo.algorithm

import com.rldemo.model.RateLimitResult
import io.lettuce.core.api.StatefulRedisConnection
import jakarta.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Fixed Window Counter
 *
 * Key: rl:{userId}:fw:{windowIndex}
 *   - windowIndex = floor(nowMs / windowMs) → đổi mới mỗi window
 *   - Hash tag {userId} đảm bảo tất cả key của cùng 1 user vào cùng 1 Redis slot
 *     (quan trọng khi dùng Redis Cluster, demo single node thì không cần)
 *
 * Lua script thay vì 2 lệnh riêng:
 *   INCR là atomic, nhưng INCR + PEXPIRE thì không — nếu pod crash sau INCR
 *   thì key sống mãi không có TTL. Lua làm 2 lệnh thành 1 unit.
 *
 * Return từ Lua: [allowed(1/0), current_count, reset_in_ms]
 */
@Singleton
class FixedWindowLimiter(
    private val connection: StatefulRedisConnection<String, String>
) : RateLimiter {

    override val name = "fixed_window"

    // Script lưu dưới dạng String constant, load lên Redis 1 lần rồi gọi bằng SHA
    private val script = """
        local key        = KEYS[1]
        local limit      = tonumber(ARGV[1])
        local window_ms  = tonumber(ARGV[2])

        local count = redis.call('INCR', key)
        -- Chỉ set TTL lần đầu (count==1) để tránh ghi đè TTL mỗi request
        if count == 1 then
            redis.call('PEXPIRE', key, window_ms)
        end

        local reset_in_ms = redis.call('PTTL', key)
        if reset_in_ms < 0 then reset_in_ms = window_ms end

        if count <= limit then
            return {1, count, reset_in_ms}
        else
            return {0, count, reset_in_ms}
        end
    """.trimIndent()

    override suspend fun check(userId: String, params: Map<String, Double>): RateLimitResult =
        withContext(Dispatchers.IO) {
            val windowMs  = ((params["window_seconds"] ?: 10.0) * 1000).toLong()
            val limit     = (params["limit"] ?: 5.0).toLong()
            val nowMs     = System.currentTimeMillis()

            // window_index xác định key nào đang active
            // Ví dụ: window=10s, T=12345000ms → index=1234500 → key reset mỗi 10s
            val windowIndex = nowMs / windowMs
            val key = "rl:{${userId}}:fw:${windowIndex}"

            val sync = connection.sync()

            @Suppress("UNCHECKED_CAST")
            val result = sync.eval<List<Long>>(
                script,
                io.lettuce.core.ScriptOutputType.MULTI,
                arrayOf(key),
                limit.toString(),
                windowMs.toString()
            )

            val allowed      = result[0] == 1L
            val count        = result[1]
            val resetInMs    = result[2]

            RateLimitResult(
                allowed = allowed,
                retryAfterMs = if (allowed) 0L else resetInMs,
                stateSnapshot = mapOf(
                    "count"        to count,
                    "limit"        to limit,
                    "reset_in_ms"  to resetInMs,
                    // window_start giúp frontend tính countdown timer
                    "window_start_ms" to windowIndex * windowMs
                )
            )
        }
}
