package com.rldemo.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.rldemo.model.SseEvent
import io.micronaut.http.sse.Event
import jakarta.inject.Singleton
import org.slf4j.LoggerFactory
import reactor.core.publisher.Flux
import reactor.core.publisher.Sinks

/**
 * SseEmitterService — broadcast events đến tất cả client đang subscribe /events.
 *
 * Dùng Reactor Sinks.Many (hot observable):
 *   - hot = phát sóng ngay khi emit, dù có subscriber hay không
 *   - nhiều subscriber cùng nhận cùng 1 event
 *   - directBestEffort() = drop event nếu buffer đầy, không throw exception
 *
 * Flow:
 *   POST /api/hello → RateLimiter check → sseEmitterService.emit(event)
 *   GET /events → return sink.asFlux() → browser nhận SSE
 *
 * Lưu ý: SSE connection là long-lived HTTP connection, giữ mãi cho đến khi
 *   client disconnect. Netty handle bằng event-driven nên không tốn thread.
 */
@Singleton
class SseEmitterService(
    private val objectMapper: ObjectMapper
) {
    private val log = LoggerFactory.getLogger(SseEmitterService::class.java)

    // Sink kiểu multicast = nhiều subscriber, directBestEffort = không block khi emit
    private val sink: Sinks.Many<Event<String>> =
        Sinks.many().multicast().directBestEffort()

    /**
     * Gọi từ RateLimitController sau mỗi request check.
     * Serialize SseEvent → JSON string → wrap trong SSE Event → emit vào sink.
     */
    fun emit(event: SseEvent) {
        try {
            val json = objectMapper.writeValueAsString(event)
            // Event.of() = basic SSE, browser nhận: "data: {...}\n\n"
            val sseEvent = Event.of(json)
            sink.tryEmitNext(sseEvent)
        } catch (e: Exception) {
            log.warn("Failed to emit SSE event", e)
        }
    }

    /**
     * Trả về Flux để controller expose qua GET /events.
     * Mỗi subscriber (browser tab mở /events) nhận riêng 1 Flux từ cùng sink.
     */
    fun stream(): Flux<Event<String>> = sink.asFlux()
}
