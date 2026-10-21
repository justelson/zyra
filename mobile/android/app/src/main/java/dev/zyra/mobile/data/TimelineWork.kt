package dev.zyra.mobile.data

import org.json.JSONObject

sealed interface ChatRailRow {
    val id: String
    data class Message(val item: TimelineItem) : ChatRailRow { override val id get() = item.id }
    data class Work(override val id: String, val entries: List<TimelineItem>, val running: Boolean,
        val finalVisible: Boolean, val actions: List<WorkAction>, val startedAt: Long? = null, val completedAt: Long? = null) : ChatRailRow
}

/** Native projection of Desktop's assistant-turn-work and assistant-action-presentation.
 * Canonical rows stay intact; final replies and actionable prompts never disappear
 * into a work disclosure. Parsing is cached because text deltas retain the same raw envelope.
 */
class TimelineWork {
    private val parsed = mutableMapOf<String, Pair<String, JSONObject>>()
    private data class CachedAction(val item: TimelineItem, val call: Pair<String, JSONObject>?, val batch: String?, val value: WorkAction)
    private val actionCache = mutableMapOf<String, CachedAction>()
    private val emptyArguments = JSONObject()
    private var owner: String? = null
    private var groupIds: Map<String, String> = emptyMap()
    private fun raw(item: TimelineItem): JSONObject {
        parsed[item.id]?.takeIf { it.first == item.raw }?.let { return it.second }
        return runCatching { JSONObject(item.raw) }.getOrDefault(JSONObject()).also { parsed[item.id] = item.raw to it }
    }
    private fun action(item: TimelineItem, call: Pair<String, JSONObject>?, batch: String?): WorkAction {
        // Calls come from the parsed envelope cache, so their argument objects
        // remain identical until that canonical envelope changes.
        actionCache[item.id]?.takeIf { it.item == item && it.call == call && it.batch == batch }?.let { return it.value }
        return WorkActions.project(item, call, batch).also { actionCache[item.id] = CachedAction(item, call, batch, it) }
    }
    private fun voice(item: TimelineItem): Boolean {
        val value = raw(item); val message = value.optJSONObject("message") ?: value
        return item.id.removePrefix("message:").startsWith("voice_") || message.optJSONObject("zyraCanonicalMessage")?.optString("modality") == "voice"
    }
    private fun reply(item: TimelineItem): Boolean {
        if (item.text.isNotBlank()) return true
        val value = raw(item); val message = value.optJSONObject("message") ?: value
        val content = message.optJSONArray("content") ?: return false
        return (0 until content.length()).any { content.optJSONObject(it)?.optString("type") == "image" }
    }
    private fun hiddenTitleMetadata(item: TimelineItem): Boolean {
        val value = raw(item); val message = value.optJSONObject("message") ?: value
        if (MessageContent.hiddenMetadataTool(value.optString("toolName")) ||
            MessageContent.hiddenMetadataTool(message.optString("toolName")) ||
            (item.kind == "tool" || item.kind == "deferred") && MessageContent.hiddenMetadataTool(item.text.substringBefore('\n'))) return true
        val content = message.optJSONArray("content") ?: return false
        return item.role == "assistant" && item.text.isBlank() && item.reasoning.isBlank() && content.length() > 0 &&
            (0 until content.length()).all { index -> content.optJSONObject(index)?.let {
                it.optString("type") == "toolCall" && MessageContent.hiddenMetadataTool(it.optString("name"))
            } == true }
    }
    fun rows(view: SessionView): List<ChatRailRow> {
        if (owner != view.id) {
            owner = view.id; parsed.clear(); actionCache.clear(); groupIds = emptyMap()
        }
        val retained = view.items.map { it.id }.toSet()
        parsed.keys.retainAll(retained)
        actionCache.keys.retainAll(retained)
        val calls = mutableMapOf<String, Pair<String, JSONObject>>()
        val batches = mutableMapOf<String, String?>()
        var batch: String? = null
        for (item in view.items) {
            if (item.role == "user" || item.role == "assistant" && item.text.isNotBlank()) batch = null
            val value = raw(item); val message = value.optJSONObject("message") ?: value
            val content = message.optJSONArray("content")
            for (i in 0 until (content?.length() ?: 0)) {
                val part = content?.optJSONObject(i) ?: continue
                if (part.optString("type") != "toolCall") continue
                val name = part.optString("name"); val args = part.optJSONObject("arguments") ?: emptyArguments
                if (MessageContent.hiddenMetadataTool(name)) continue
                val key = "tool:" + part.optString("id")
                calls[key] = name to args
                if (name == "begin_action_batch") batch = args.optString("title").trim().takeIf(String::isNotBlank)
                batches[key] = batch
            }
            if (value.optString("type") == "tool_execution_start") {
                val name = value.optString("toolName"); val args = value.optJSONObject("args") ?: emptyArguments
                if (MessageContent.hiddenMetadataTool(name)) continue
                calls[item.id] = name to args
                if (name == "begin_action_batch") batch = args.optString("title").trim().takeIf(String::isNotBlank)
                batches[item.id] = batch
            }
        }
        val result = mutableListOf<ChatRailRow>()
        val nextGroupIds = mutableMapOf<String, String>()
        val usedGroupIds = mutableSetOf<String>()
        val boundaries = view.items.indices.filter { view.items[it].role == "user" }.toMutableList()
        if (boundaries.firstOrNull() != 0) boundaries.add(0, 0)
        boundaries.add(view.items.size)
        for (part in 0 until boundaries.lastIndex) {
            // Anonymous result echoes remain in SessionView/cache for inspection,
            // but are not another visible action, count, heading or narration row.
            val segment = view.items.subList(boundaries[part], boundaries[part + 1]).filterNot { item ->
                hiddenTitleMetadata(item) || (item.kind == "tool" || item.kind == "deferred") && action(item, calls[item.id], batches[item.id]).let {
                    it.toolName.equals("Tool output", ignoreCase = true) && it.title.equals("Using Tool output", ignoreCase = true)
                }
            }
            if (segment.isEmpty()) continue
            val interrupted = segment.any { item ->
                val value = raw(item); val message = value.optJSONObject("message") ?: value
                message.optString("stopReason") in setOf("aborted", "interrupted") || value.optString("outcome") == "interrupted"
            }
            val running = view.running && part == boundaries.lastIndex - 1
            val toolIndex = segment.indexOfLast { it.kind == "tool" || it.kind == "deferred" }
            val finalIndex = segment.indexOfLast { it.role == "assistant" && reply(it) && !voice(it) }
                .takeIf { it >= 0 && !running }
            val work = segment.filterIndexed { index, item ->
                !voice(item) && (item.kind == "work_status" || item.kind == "tool" || item.kind == "deferred" || item.kind == "user_input_requested" || item.kind == "resolved" && raw(item).has("questions") || item.role == "assistant" &&
                    (item.reasoning.isNotBlank() || index != finalIndex && (toolIndex >= 0 || item.text.isBlank())))
            }.filter { calls[it.id]?.first != "begin_action_batch" && it.text.substringBefore('\n') != "begin_action_batch" }
                .map { if (finalIndex != null && it.id == segment[finalIndex].id) it.copy(text = "") else it }
            val workIds = work.map { it.id }.toSet()
            val actions = work.filter { it.kind == "tool" || it.kind == "deferred" }.map { action(it, calls[it.id], batches[it.id]) }
            var emitted = false
            for ((index, item) in segment.withIndex()) {
                if (item.kind == "turn_outcome") continue
                if (work.isNotEmpty() && (item.id in workIds || index == finalIndex) && !emitted) {
                    // Older pages can reveal the user boundary of a work group
                    // already being read. Retain its key and disclosure state.
                    val id = work.firstNotNullOfOrNull { entry -> groupIds[entry.id]?.takeUnless { it in usedGroupIds } }
                        ?: "work:" + segment.first().id
                    usedGroupIds.add(id)
                    work.forEach { nextGroupIds[it.id] = id }
                    val started = segment.firstNotNullOfOrNull { WorkActions.timestamp(raw(it)) }
                    val completed = segment.asReversed().firstNotNullOfOrNull { WorkActions.timestamp(raw(it), true) }
                    result.add(ChatRailRow.Work(id, work, running, finalIndex != null, actions, started, completed)); emitted = true
                }
                if (calls[item.id]?.first == "begin_action_batch" || item.kind == "tool" && item.text.substringBefore('\n') == "begin_action_batch") continue
                if (item.id !in workIds || index == finalIndex) {
                    // Tool-call-only assistant envelopes have no separate bubble.
                    if (item.role == "assistant" && item.text.isBlank() && item.reasoning.isBlank() && item.toolNames.isNotEmpty()) continue
                    result.add(ChatRailRow.Message(if (item.id in workIds && index == finalIndex) item.copy(reasoning = "") else item))
                }
            }
            if (interrupted && !running) result.add(ChatRailRow.Message(TimelineItem(
                "interrupted:" + segment.first().id, "system", "Interrupted", "interrupted")))
        }
        groupIds = nextGroupIds
        return result
    }
}


