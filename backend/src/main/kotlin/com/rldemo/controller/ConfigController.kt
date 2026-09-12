package com.rldemo.controller

import com.rldemo.model.Config
import com.rldemo.service.ConfigService
import io.micronaut.http.annotation.*
import io.micronaut.scheduling.TaskExecutors
import io.micronaut.scheduling.annotation.ExecuteOn

/**
 * ConfigController — quản lý algo + params
 *
 * GET  /config         → trả config hiện tại (algo + params)
 * POST /config         → đổi config, tự clear state cũ
 * POST /config/reset   → chỉ clear state, giữ config
 *
 * @ExecuteOn(IO) bắt buộc với suspend function — nếu không có,
 * suspend function chạy trên Netty event loop → block event loop → bug.
 */
@Controller("/config")
@ExecuteOn(TaskExecutors.IO)
class ConfigController(
    private val configService: ConfigService
) {
    @Get
    suspend fun get(): Config = configService.getConfig()

    @Post
    suspend fun set(@Body config: Config): Map<String, Any> {
        configService.setConfig(config)
        return mapOf(
            "status" to "ok",
            "algo"   to config.algo,
            "params" to config.params
        )
    }

    @Post("/reset")
    suspend fun reset(): Map<String, String> {
        configService.resetState()
        return mapOf("status" to "reset")
    }
}
