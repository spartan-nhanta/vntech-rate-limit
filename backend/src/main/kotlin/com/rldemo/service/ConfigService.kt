package com.rldemo.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.rldemo.model.Config
import io.lettuce.core.ScanArgs
import io.lettuce.core.ScanCursor
import io.lettuce.core.api.StatefulRedisConnection
import jakarta.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.slf4j.LoggerFactory

/**
 * ConfigService quản lý:
 * 1. Config (algo + params) — lưu Redis key "rl:config", cache trong memory
 * 2. State reset — SCAN + DEL tất cả key "rl:*" trừ "rl:config"
 *
 * Cache in-memory (@Volatile):
 *   Tránh GET Redis mỗi request cho /api/hello.
 *   Khi POST /config → update Redis + update cache ngay.
 *   Khi restart → loadConfig() đọc lại từ Redis.
 */
@Singleton
class ConfigService(
    private val connection: StatefulRedisConnection<String, String>,
    private val objectMapper: ObjectMapper
) {
    private val log = LoggerFactory.getLogger(ConfigService::class.java)

    companion object {
        const val CONFIG_KEY = "rl:config"
    }

    // @Volatile để đảm bảo visibility khi nhiều coroutine đọc
    @Volatile
    private var cached: Config = Config()

    suspend fun getConfig(): Config = cached

    /**
     * Đổi algo + params: ghi Redis → update cache → clear toàn bộ state cũ.
     * Clear state để demo thấy algo mới bắt đầu từ sạch.
     */
    suspend fun setConfig(config: Config) = withContext(Dispatchers.IO) {
        val json = objectMapper.writeValueAsString(config)
        connection.sync().set(CONFIG_KEY, json)
        cached = config
        log.info("Config updated: algo=${config.algo} params=${config.params}")
        resetState()  // clear counter cũ khi đổi algo
    }

    /**
     * Chỉ clear state, giữ config.
     * Dùng khi muốn thử lại cùng algo từ đầu.
     *
     * SCAN thay vì KEYS vì:
     *   - KEYS block Redis toàn bộ trong khi scan
     *   - SCAN không block, trả về cursor để iterate
     *   - Cho demo thì KEYS cũng ổn, nhưng dùng SCAN là đúng practice
     */
    suspend fun resetState() = withContext(Dispatchers.IO) {
        val sync = connection.sync()
        var cursor: ScanCursor = ScanCursor.INITIAL
        val scanArgs = ScanArgs.Builder.matches("rl:*").limit(200)
        var deletedCount = 0

        do {
            val scanResult = sync.scan(cursor, scanArgs)
            val keysToDelete = scanResult.keys.filter { it != CONFIG_KEY }
            if (keysToDelete.isNotEmpty()) {
                sync.del(*keysToDelete.toTypedArray())
                deletedCount += keysToDelete.size
            }
            cursor = scanResult
        } while (!cursor.isFinished)

        log.info("State reset: deleted $deletedCount keys")
    }

    /**
     * Gọi khi server khởi động để restore config từ Redis (nếu đã có).
     * Nếu Redis trống → giữ default config.
     */
    suspend fun loadConfig() = withContext(Dispatchers.IO) {
        val json = connection.sync().get(CONFIG_KEY)
        if (json != null) {
            cached = objectMapper.readValue(json, Config::class.java)
            log.info("Config loaded from Redis: ${cached.algo}")
        } else {
            log.info("No config in Redis, using default: ${cached.algo}")
        }
    }
}
