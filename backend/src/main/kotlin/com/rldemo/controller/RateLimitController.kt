package com.rldemo.controller

import com.rldemo.model.SseEvent
import com.rldemo.service.ConfigService
import com.rldemo.service.RateLimiterService
import com.rldemo.service.SseEmitterService
import io.micronaut.http.HttpResponse
import io.micronaut.http.HttpStatus
import io.micronaut.http.MediaType
import io.micronaut.http.annotation.*
import io.micronaut.http.sse.Event
import io.micronaut.scheduling.TaskExecutors
import io.micronaut.scheduling.annotation.ExecuteOn
import org.slf4j.LoggerFactory
import reactor.core.publisher.Flux
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/**
 * RateLimitController — 2 endpoint chính:
 *
 * GET /api/hello?user_id=user_A
 *   - Đọc config (từ in-memory cache, không hit Redis)
 *   - Gọi RateLimiterService → Lua script trên Redis
 *   - Emit SSE event để Admin/Client page cập nhật realtime
 *   - Trả 200 hoặc 429 với Retry-After header
 *
 * GET /events
 *   - Trả Flux<Event<String>> — SSE stream
 *   - Browser dùng EventSource để nhận push từ server
 *   - Connection sống mãi cho đến khi client đóng tab
 *   - @ExecuteOn không cần cho /events vì không có suspend (Flux là non-blocking)
 */
@Controller
class RateLimitController(
    private val rateLimiterService: RateLimiterService,
    private val sseEmitterService: SseEmitterService,
    private val configService: ConfigService
) {
    private val log = LoggerFactory.getLogger(RateLimitController::class.java)
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm:ss.SSS")

    @Get("/api/hello")
    @ExecuteOn(TaskExecutors.IO)
    suspend fun hello(
        @QueryValue("user_id") userId: String
    ): HttpResponse<Map<String, Any>> {

        val config = configService.getConfig()
        val result = rateLimiterService.check(userId, config)

        // Timestamp đẹp cho log UI, không dùng epoch để dễ đọc
        val ts = LocalTime.now().format(timeFormatter)

        // Broadcast event đến tất cả subscriber SSE (Admin + Client page)
        sseEmitterService.emit(
            SseEvent(
                ts            = ts,
                userId        = userId,
                algo          = config.algo,
                status        = if (result.allowed) 200 else 429,
                retryAfterMs  = if (!result.allowed) result.retryAfterMs else null,
                stateSnapshot = result.stateSnapshot
            )
        )

        return if (result.allowed) {
            HttpResponse.ok(
                mapOf(
                    "message"  to "Hello, $userId!",
                    "algo"     to config.algo,
                    "state"    to result.stateSnapshot
                )
            )
        } else {
            val retryAfterSec = result.retryAfterMs / 1000

            log.debug("429 → userId=$userId algo=${config.algo} retry_after=${result.retryAfterMs}ms")

            HttpResponse.status<Map<String, Any>>(HttpStatus.TOO_MANY_REQUESTS)
                // Retry-After: số giây (RFC standard)
                .header("Retry-After", retryAfterSec.toString())
                // X-RateLimit-* là convention không chính thức nhưng phổ biến
                .header("X-RateLimit-Remaining", "0")
                .body(
                    mapOf(
                        "error"          to "Too many requests",
                        "algo"           to config.algo,
                        "retry_after_ms" to result.retryAfterMs,
                        "state"          to result.stateSnapshot
                    )
                )
        }
    }

    /**
     * SSE endpoint — trả Flux<Event<String>>
     *
     * Không cần @ExecuteOn(IO) vì:
     * - Không có blocking call ở đây
     * - Flux là non-blocking reactive stream
     * - Netty handle long-lived connection bằng event loop, không cần thread riêng
     *
     * Produces TEXT_EVENT_STREAM → Micronaut tự add header "Content-Type: text/event-stream"
     * Browser EventSource sẽ reconnect tự động nếu connection bị drop.
     */
    @Get("/events", produces = [MediaType.TEXT_EVENT_STREAM])
    fun events(): Flux<Event<String>> = sseEmitterService.stream()
}
