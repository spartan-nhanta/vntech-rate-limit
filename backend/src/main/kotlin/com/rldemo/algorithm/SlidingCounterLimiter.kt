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
 * So với Fixed Window ở boundary (limit=5, window=5s):
 *   Fixed Window:    5 req cuối window cũ + 5 req đầu window mới = 10 req  ← spike 2× limit
 *   Sliding Counter: 5 req cuối window cũ + 1 req đầu window mới = 6 req
 *     vì ngay sau boundary weight ≈ 95% → estimate = floor(5 × 0.95) = 4 < 5 → lọt 1
 *     request tiếp theo: floor(5 × 0.94 + 1) = 5 → chặn
 *
 * Việc lọt thêm 1 request là do math.floor() làm tròn xuống. Đây là đánh đổi
 * có chủ đích: giữ O(1) memory (2 counter) thay vì lưu từng timestamp như Sliding Log.
 *
 * Return từ Lua: [allowed(1/0), estimate, prev_count, curr_count, weight_pct]
 *   estimate/prev_count/curr_count đều là giá trị TRƯỚC khi ghi, để snapshot
 *   phản ánh đúng phép so sánh đã chạy — audience verify được công thức.
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

        local weight_pct = math.floor(weight * 100)

        if estimate < limit then
            local new_count = redis.call('INCR', curr_key)
            if new_count == 1 then
                -- TTL = 2 window: window hiện tại + 1 window nữa (key sẽ là prev rồi)
                redis.call('PEXPIRE', curr_key, window_ms * 2)
            end
            -- Trả estimate TRƯỚC khi ghi (không +1) để cùng hệ quy chiếu với
            -- nhánh reject — snapshot khớp đúng phép so sánh estimate < limit
            return {1, estimate, prev_count, curr_count, weight_pct}
        else
            return {0, estimate, prev_count, curr_count, weight_pct}
        end
    """.trimIndent()

    override suspend fun check(userId: String, params: Map<String, Double>): RateLimitResult =
        withContext(Dispatchers.IO) {
            val windowMs = (params["window_ms"] ?: 10000.0).toLong()
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

            // Thời gian còn lại đến boundary của window hiện tại.
            // Tính từ clock alignment (nowMs % windowMs), không dùng PTTL —
            // xem comment trong FixedWindowLimiter về lý do.
            val resetInMs = windowMs - (nowMs % windowMs)

            RateLimitResult(
                allowed = allowed,
                retryAfterMs = if (allowed) 0L else resetInMs,
                stateSnapshot = mapOf(
                    "estimate"    to estimate,
                    "prev_count"  to prevCount,
                    "curr_count"  to currCount,
                    "weight_pct"  to weightPct,
                    "limit"       to limit,
                    // Cho frontend chạy countdown + boundary burst
                    "reset_in_ms" to resetInMs,
                    // window_id để frontend nhóm request theo window, thấy rõ boundary
                    "window_id"   to currIndex
                )
            )
        }
}
