package com.rldemo

import com.rldemo.service.ConfigService
import io.micronaut.context.event.ApplicationEventListener
import io.micronaut.runtime.Micronaut
import io.micronaut.runtime.server.event.ServerStartupEvent
import jakarta.inject.Singleton
import kotlinx.coroutines.runBlocking

fun main(args: Array<String>) {
    Micronaut.build(*args)
        .packages("com.rldemo")
        .start()
}

/**
 * Khi server khởi động xong: load config từ Redis vào in-memory cache.
 * Nếu Redis trống → giữ default config (Token Bucket, capacity=5, rate=0.5/s).
 *
 * runBlocking dùng được ở đây vì:
 * - @EventListener không phải suspend function
 * - Chỉ gọi 1 lần lúc startup, không ảnh hưởng throughput
 */
@Singleton
class AppStartup(
    private val configService: ConfigService
) : ApplicationEventListener<ServerStartupEvent> {

    override fun onApplicationEvent(event: ServerStartupEvent) {
        runBlocking {
            configService.loadConfig()
        }
    }
}
