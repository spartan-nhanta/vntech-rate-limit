package com.rldemo.algorithm

import com.rldemo.model.RateLimitResult
import io.lettuce.core.api.StatefulRedisConnection
import jakarta.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Leaky Bucket (Counter-based — Rate Limiting, không phải Throttling)
 *
 * State trong Redis: Hash với 2 field
 *   rl:{userId}:lb → { queue_size: Long, last_drain: Long(ms) }
 *
 * Cơ chế "lazy drain":
 *   - Không có worker drain thật sự
 *   - Mỗi request, tính drained = floor(elapsed × drain_rate_ms)
 *   - new_size = max(0, queue_size - drained)
 *   - Nếu new_size < capacity → cho vào queue (new_size + 1)
 *   - Ngược lại → 429
 *
 * Điểm quan trọng: đây là "counter-based" leaky bucket — không có FIFO queue thật.
 * Request không bị delay (throttle), chúng bị reject (429) nếu queue đầy.
 * Throttling thật (delay request) cần Kafka/queue riêng.
 *
 * Return từ Lua: [allowed(1/0), queue_size, retry_after_ms]
 */
@Singleton
class LeakyBucketLimiter(
    private val connection: StatefulRedisConnection<String, String>
) : RateLimiter {

    override val name = "leaky_bucket"

    private val script = """
        local key           = KEYS[1]
        local now           = tonumber(ARGV[1])       -- ms
        local drain_rate_ms = tonumber(ARGV[2])       -- req/ms = drain_rate_per_second / 1000
        local capacity      = tonumber(ARGV[3])

        local state      = redis.call('HMGET', key, 'queue_size', 'last_drain')
        local queue_size = tonumber(state[1]) or 0
        local last_drain = tonumber(state[2]) or now

        -- Lazy drain: tính số slot đã được xả từ lần check trước
        local elapsed    = now - last_drain
        local drained    = math.floor(elapsed * drain_rate_ms)
        local new_size   = math.max(0, queue_size - drained)

        if new_size < capacity then
            redis.call('HMSET', key, 'queue_size', new_size + 1, 'last_drain', now)
            local ttl_ms = math.ceil(capacity / drain_rate_ms)
            redis.call('PEXPIRE', key, ttl_ms)
            return {1, new_size + 1, 0}
        else
            -- Bao nhiêu slot phải drain để có chỗ trống?
            -- new_size = capacity → cần drain 1 slot → retry = ceil(1 / drain_rate_ms)
            local over      = new_size - capacity + 1
            local retry_ms  = math.ceil(over / drain_rate_ms)
            return {0, new_size, retry_ms}
        end
    """.trimIndent()

    override suspend fun check(userId: String, params: Map<String, Double>): RateLimitResult =
        withContext(Dispatchers.IO) {
            val capacity          = (params["capacity"] ?: 10.0)
            val drainRatePerSec   = (params["drain_rate_per_second"] ?: 0.5)
            val drainRatePerMs    = drainRatePerSec / 1000.0
            val nowMs             = System.currentTimeMillis()
            val key               = "rl:{${userId}}:lb"

            val sync = connection.sync()

            @Suppress("UNCHECKED_CAST")
            val result = sync.eval<List<Long>>(
                script,
                io.lettuce.core.ScriptOutputType.MULTI,
                arrayOf(key),
                nowMs.toString(),
                drainRatePerMs.toString(),
                capacity.toString()
            )

            val allowed      = result[0] == 1L
            val queueSize    = result[1]
            val retryAfterMs = result[2]

            RateLimitResult(
                allowed = allowed,
                retryAfterMs = if (allowed) 0L else retryAfterMs,
                stateSnapshot = mapOf(
                    "queue_size" to queueSize,
                    "capacity"   to capacity.toLong()
                )
            )
        }
}
