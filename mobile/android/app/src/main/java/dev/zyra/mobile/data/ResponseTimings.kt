package dev.zyra.mobile.data

import org.json.JSONArray
import org.json.JSONObject

/** Provider stages share a host origin. Receipt/display share a client monotonic
 * origin. Clock skew between a phone and PC must never become response latency. */
class ResponseTimings(private val now: () -> Long, private val wall: () -> Long = System::currentTimeMillis,
    private val changed: (Boolean) -> Unit = {}, private val settled: (String) -> Unit = {}) {
    private data class Active(val row: JSONObject, var anchor: Double? = null, var request: String? = null, var compactingAt: Long? = null, val retries: MutableSet<String> = mutableSetOf())
    private val records = linkedMapOf<String, JSONObject>()
    private val active = mutableMapOf<String, Active>()
    private val starts = mutableMapOf<String, Long>()
    private val fields = listOf("mainReceivedMs", "dispatchMs", "acceptedMs", "firstEventMs", "firstTextMs", "firstTextReceivedMs", "firstDisplayMs", "completedMs", "requestCount", "retryCount", "compactionCount", "compactionMs", "maxStreamingGapMs", "stallCount", "mainStallMs", "rendererStallMs", "maxStallMs")
    private val models = setOf("gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.5")
    private val efforts = setOf("default", "off", "minimal", "low", "medium", "high", "xhigh", "max")
    private fun ms(value: Number) = value.toDouble().coerceIn(0.0, 86_400_000.0).toLong()
    private fun first(row: JSONObject, key: String, value: Number) { if (row.isNull(key) && value.toDouble().isFinite()) row.put(key, ms(value)) }
    private fun sanitizeModel(value: String) = value.substringAfterLast('/').takeIf { it in models } ?: "other"
    private fun sanitizeEffort(value: String) = value.takeIf { it in efforts } ?: "unknown"
    private fun row(id: String, model: String, effort: String) = JSONObject().put("turnId", id).put("startedAt", wall()).put("model", sanitizeModel(model)).put("effort", sanitizeEffort(effort)).put("outcome", "running")
        .put("providerTimingOrigin", "host-acceptance").put("displayKind", "paint-opportunity").put("requests", JSONArray()).apply {
            fields.forEach { key -> put(key, if (key in setOf("requestCount", "retryCount", "compactionCount", "mainReceivedMs", "compactionMs")) 0 else JSONObject.NULL) }
        }
    fun start(id: String, model: String, effort: String) {
        if (!Regex("[a-zA-Z0-9:._-]{1,256}").matches(id) || records.containsKey(id)) return
        val value = row(id, model, effort); records[id] = value; active[id] = Active(value); starts[id] = now()
        if (active.size > 64) finish(active.keys.first(), "unfinished")
        trim(); changed(true)
    }
    fun dispatch(id: String) { active[id]?.row?.let { first(it, "dispatchMs", now() - starts.getValue(id)); changed(true) } }
    fun observe(envelope: JSONObject) {
        val event = envelope.optJSONObject("event") ?: return
        val id = TimelineStatus.turnId(envelope)
        val state = active[id] ?: return
        val row = state.row; val elapsed = now() - starts.getValue(id); val type = event.optString("type")
        val hadText = !row.isNull("firstTextReceivedMs")
        if (type == "zyra_server_prompt_accepted") {
            first(row, "acceptedMs", elapsed)
            state.anchor = state.anchor ?: (event.opt("timingStartedAt") as? Number)?.toDouble()?.takeIf { it.isFinite() }
        }
        if (type == "model_request_progress") {
            val p = event.optJSONObject("progress")
            if (p == null) state.request = null else {
                val requestId = p.optString("requestId"); val started = p.optDouble("startedAt", Double.NaN)
                if (requestId.isNotBlank() && started.isFinite()) {
                    var requests = row.getJSONArray("requests")
                    if (state.request != requestId) {
                        state.request = requestId; row.put("requestCount", row.optInt("requestCount") + 1)
                        requests.put(JSONObject().put("startedMs", state.anchor?.let { ms(started - it) } ?: JSONObject.NULL)
                            .put("firstEventMs", JSONObject.NULL).put("firstTextMs", JSONObject.NULL).put("lastEventMs", JSONObject.NULL).put("durationMs", JSONObject.NULL).put("maxGapMs", JSONObject.NULL))
                        if (requests.length() > 32) { requests = JSONArray((1 until requests.length()).map { requests.get(it) }); row.put("requests", requests) }
                    }
                    val request = requests.getJSONObject(requests.length() - 1)
                    for ((source, target) in listOf("firstEventAt" to "firstEventMs", "firstTextAt" to "firstTextMs")) {
                        val at = p.optDouble(source, Double.NaN)
                        if (at.isFinite()) { first(request, target, at - started); state.anchor?.let { first(row, target, at - it) } }
                    }
                    p.optDouble("lastActivityAt", Double.NaN).takeIf { it.isFinite() }?.let { request.put("lastEventMs", ms(it - started)) }
                    p.optDouble("maxActivityGapMs", Double.NaN).takeIf { it.isFinite() }?.let { request.put("maxGapMs", ms(it)); row.put("maxStreamingGapMs", maxOf(row.optLong("maxStreamingGapMs"), ms(it))) }
                }
            }
        }
        val message = event.optJSONObject("message")
        val messageText = message?.let { if (it.optString("role") == "assistant") MessageContent.read(it.opt("content")).text else "" }.orEmpty()
        if ((type in setOf("message_start", "message_update", "message_end") && messageText.isNotBlank()) || type == "text_delta" && event.optString("delta").isNotEmpty()) first(row, "firstTextReceivedMs", elapsed)
        if (type == "compaction_start" && state.compactingAt == null) { state.compactingAt = now(); row.put("compactionCount", row.optInt("compactionCount") + 1) }
        if (type == "compaction_end") state.compactingAt?.let { row.put("compactionMs", row.optLong("compactionMs") + ms(now() - it)); state.compactingAt = null }
        if (type == "auto_retry_start" && !event.optBoolean("transportOnly") && state.retries.add("${event.optString("recoveryKind")}:${event.optInt("attempt")}")) row.put("retryCount", row.optInt("retryCount") + 1)
        if (type == "zyra_server_turn_completed") { finish(id, when (event.optString("outcome")) { "interrupted" -> "cancelled"; "failed" -> "failed"; else -> "completed" }); return }
        changed(!hadText && !row.isNull("firstTextReceivedMs") || type == "zyra_server_prompt_accepted")
    }
    fun displayed(id: String): Boolean {
        val row = records[id] ?: return false; val start = starts[id] ?: return false
        if (row.isNull("firstTextReceivedMs") || !row.isNull("firstDisplayMs")) return false
        first(row, "firstDisplayMs", now() - start); changed(true); return true
    }
    fun reconcile(presence: JSONObject?) {
        val turn = presence?.optJSONObject("latestTurn") ?: return
        val id = turn.optString("id"); val outcome = turn.optString("state")
        if (outcome in setOf("completed", "error", "failed", "interrupted")) finish(id, when (outcome) { "interrupted" -> "cancelled"; "error" -> "failed"; else -> outcome }, false)
    }
    fun finish(id: String, outcome: String, observed: Boolean = true) {
        val state = active.remove(id) ?: return
        state.row.put("outcome", outcome.takeIf { it in setOf("completed", "failed", "cancelled") } ?: "unfinished")
        state.row.put("completedMs", if (observed) ms(now() - starts.getValue(id)) else JSONObject.NULL)
        state.compactingAt?.let { state.row.put("compactionMs", state.row.optLong("compactionMs") + ms(now() - it)) }
        changed(true); settled(id); trim()
    }
    fun summary(id: String): JSONObject? = records[id]?.let { row ->
        JSONObject().put("model_name", row.optString("model")).put("effort", row.optString("effort")).put("outcome", row.optString("outcome")).apply {
            val mapping = mapOf("mainReceivedMs" to "main_received_ms", "dispatchMs" to "dispatch_ms", "acceptedMs" to "accepted_ms", "firstEventMs" to "first_event_ms", "firstTextMs" to "first_text_ms", "firstTextReceivedMs" to "first_text_received_ms", "firstDisplayMs" to "first_display_ms", "completedMs" to "duration_ms", "requestCount" to "request_count", "retryCount" to "retry_count", "compactionCount" to "compaction_count", "compactionMs" to "compaction_ms", "maxStreamingGapMs" to "max_streaming_gap_ms")
            mapping.forEach { (source, target) -> if (!row.isNull(source)) put(target, row.getLong(source)) }
        }
    }
    fun read(): JSONArray = JSONArray(records.values.sortedByDescending { it.optLong("startedAt") }.map { JSONObject(it.toString()) })
    fun restore(rows: JSONArray) {
        for (i in 0 until minOf(200, rows.length())) {
            val input = rows.optJSONObject(i) ?: continue
            val id = input.opt("turnId") as? String ?: continue
            if (!Regex("[a-zA-Z0-9:._-]{1,256}").matches(id) || records.containsKey(id) || input.opt("startedAt") !is Number) continue
            val output = row(id, input.optString("model"), input.optString("effort")).put("startedAt", input.optLong("startedAt"))
                .put("outcome", input.optString("outcome").takeIf { it in setOf("completed", "failed", "cancelled") } ?: "unfinished")
            fields.forEach { key -> (input.opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() }?.let { output.put(key, ms(it)) } }
            val requests = input.optJSONArray("requests") ?: JSONArray()
            output.put("requests", JSONArray((maxOf(0, requests.length() - 32) until requests.length()).mapNotNull { index -> requests.optJSONObject(index)?.let { request -> JSONObject().apply {
                for (key in listOf("startedMs", "firstEventMs", "firstTextMs", "lastEventMs", "durationMs", "maxGapMs")) put(key, (request.opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() }?.let { ms(it) } ?: JSONObject.NULL)
            } } }))
            records[id] = output
        }
        trim()
    }
    private fun trim() {
        val keep = active.keys + records.values.filter { it.optString("turnId") !in active }.sortedByDescending { it.optLong("startedAt") }.take(200 - active.size).map { it.optString("turnId") }
        records.keys.toList().filterNot { it in keep }.forEach { records.remove(it); starts.remove(it) }
    }
}
