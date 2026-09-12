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
    //
    // TTL truyền từ Kotlin (ttl_ms) = thời gian còn lại THẬT của window,
    // KHÔNG phải window_ms. Xem comment ở check() để hiểu vì sao.
    private val script = """
        local key    = KEYS[1]
        local limit  = tonumber(ARGV[1])
        local ttl_ms = tonumber(ARGV[2])

        local count = redis.call('INCR', key)
        -- Chỉ set TTL lần đầu (count==1) để tránh ghi đè TTL mỗi request
        if count == 1 then
            redis.call('PEXPIRE', key, ttl_ms)
        end

        if count <= limit then
            return {1, count}
        else
            return {0, count}
        end
    """.trimIndent()

    override suspend fun check(userId: String, params: Map<String, Double>): RateLimitResult =
        withContext(Dispatchers.IO) {
            val windowMs  = (params["window_ms"] ?: 10000.0).toLong()
            val limit     = (params["limit"] ?: 5.0).toLong()
            val nowMs     = System.currentTimeMillis()

            // window_index xác định key nào đang active
            // Ví dụ: window=10s, T=12345000ms → index=1234500 → key reset mỗi 10s
            val windowIndex   = nowMs / windowMs
            val windowStartMs = windowIndex * windowMs
            val key = "rl:{${userId}}:fw:${windowIndex}"

            // reset_in_ms phải tính từ BOUNDARY THẬT (windowStart + windowMs),
            // KHÔNG dùng PTTL. Lý do: PEXPIRE chạy khi request ĐẦU TIÊN của window
            // đến, nên PTTL = windowMs - (thời gian từ lúc tạo key), lệch so với
            // boundary thật đúng bằng offset của request đầu tiên vào trong window.
            //
            // VD: window=10s căn theo clock, boundary tại T=10.000s
            //     Request đầu đến T=0.408s → PEXPIRE 10000ms → key hết hạn T=10.408s
            //     PTTL trả 10000 nhưng boundary thật chỉ còn 9592ms → lệch 408ms
            val resetInMs = windowStartMs + windowMs - nowMs

            val sync = connection.sync()

            @Suppress("UNCHECKED_CAST")
            val result = sync.eval<List<Long>>(
                script,
                io.lettuce.core.ScriptOutputType.MULTI,
                arrayOf(key),
                limit.toString(),
                // TTL = thời gian còn lại thật, để key tự xóa đúng lúc boundary
                resetInMs.toString()
            )

            val allowed = result[0] == 1L
            val count   = result[1]

            RateLimitResult(
                allowed = allowed,
                retryAfterMs = if (allowed) 0L else resetInMs,
                stateSnapshot = mapOf(
                    "count"        to count,
                    "limit"        to limit,
                    "reset_in_ms"  to resetInMs,
                    // window_start giúp frontend tính countdown timer
                    "window_start_ms" to windowStartMs,
                    // window_id để frontend nhóm request theo window, thấy rõ boundary
                    "window_id"    to windowIndex
                )
            )
        }
}
