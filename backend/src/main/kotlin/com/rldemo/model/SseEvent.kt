package com.rldemo.model

/**
 * Mỗi request đến /api/hello đều tạo 1 SseEvent và broadcast lên /events.
 * Cả Admin và Client đều subscribe SSE stream này.
 *
 * Jackson sẽ serialize thành JSON, property_naming_strategy = SNAKE_CASE
 * nên camelCase trong Kotlin → snake_case trong JSON tự động.
 */
data class SseEvent(
    val ts: String,                         // "12:01:05.123" — thời điểm request
    val userId: String,                     // "user_A"
    val algo: String,                       // "token_bucket"
    val status: Int,                        // 200 hoặc 429
    val retryAfterMs: Long?,                // null nếu 200, > 0 nếu 429
    val stateSnapshot: Map<String, Any>     // state của bucket/counter lúc đó
)
