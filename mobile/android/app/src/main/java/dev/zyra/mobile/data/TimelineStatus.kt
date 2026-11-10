package dev.zyra.mobile.data

import org.json.JSONObject

/** Operational events stay in their turn's work disclosure, never as agent prose. */
object TimelineStatus {
    private val eventTypes = setOf("compaction_start", "compaction_end", "auto_retry_start", "auto_retry_end", "agent_end", "zyra_server_turn_completed", "zyra_agent_interruption")
    fun handles(type: String): Boolean = type in eventTypes
    private fun raw(item: TimelineItem) = runCatching { JSONObject(item.raw) }.getOrDefault(JSONObject())
    fun family(item: TimelineItem): String = raw(item).optString("_mobileStatusFamily")
    fun failed(item: TimelineItem): Boolean = raw(item).optBoolean("_mobileStatusFailed")
    fun turnId(envelope: JSONObject): String = listOf(envelope.optJSONObject("requestContext")?.opt("turnId"), envelope.optJSONObject("event")?.opt("turnId"))
        .filterIsInstance<String>().firstOrNull { it.isNotBlank() }.orEmpty()
    fun acceptedIndex(items: List<TimelineItem>, turnId: String): Int =
        if (turnId.isBlank()) -1 else items.indexOfFirst { it.id == "accepted:$turnId" }

    fun apply(items: List<TimelineItem>, type: String, event: JSONObject, eventRaw: String, eventId: String, turnId: String): List<TimelineItem> {
        val category = when (type) { "zyra_agent_interruption" -> "stop"; "compaction_start", "compaction_end" -> "compaction"; "auto_retry_start", "auto_retry_end" -> "recovery"; else -> "error" }
        val scope = turnId.ifBlank { items.lastOrNull { it.role == "user" }?.id.orEmpty() }
        val pending = type.endsWith("_start") || type == "zyra_agent_interruption"
        val index = items.indexOfLast { it.kind == "work_status" && family(it) == category && raw(it).optString("_mobileStatusScope") == scope && (!pending || it.pending) }
        val previous = items.getOrNull(index)
        val failed = when (type) { "auto_retry_end" -> !event.optBoolean("success"); "compaction_end" -> event.optString("errorMessage").isNotBlank(); else -> category == "error" }
        val network = event.optString("recoveryKind") == "network" || previous?.let { raw(it).optBoolean("_mobileStatusNetwork") } == true
        val title = when (type) {
            "zyra_agent_interruption" -> "Stopping"
            "compaction_start" -> "Compacting context"
            "compaction_end" -> when { failed -> "Context compaction failed"; event.optBoolean("aborted") -> "Context compaction stopped"; else -> "Context compacted" }
            "auto_retry_start" -> (if (network) "Reconnecting" else "Retrying") + event.optInt("attempt").takeIf { it > 0 }?.let { attempt ->
                event.optInt("maxAttempts").takeIf { it >= attempt }?.let { " · $attempt of $it" } ?: " · $attempt"
            }.orEmpty()
            "auto_retry_end" -> if (failed) (if (network) "Connection interrupted" else "Retry failed") else if (network) "Reconnected" else "Retry complete"
            else -> "The turn failed"
        }
        val enriched = JSONObject(eventRaw).apply {
            put("_mobileStatusFamily", category); put("_mobileStatusScope", scope)
            put("_mobileStatusFailed", failed); put("_mobileStatusNetwork", network)
            previous?.let { WorkActions.timestamp(raw(it)) }?.let { put("_mobileCreatedAt", it) }
        }
        val item = TimelineItem(previous?.id ?: eventId, "system", title, "work_status", enriched.toString(), pending)
        return if (index >= 0) items.toMutableList().also { it[index] = item } else items + item
    }

    fun finish(items: List<TimelineItem>, turnId: String): List<TimelineItem> = items.map { item ->
        if (item.kind != "work_status" || !item.pending || turnId.isNotBlank() && raw(item).optString("_mobileTurnId") != turnId) item
        else item.copy(pending = false, text = when (family(item)) { "compaction" -> "Context compaction stopped"; "stop" -> "Stopped"; else -> "Recovery stopped" })
    }
}
