package dev.zyra.mobile.data

import org.json.JSONArray
import org.json.JSONObject

object TimelineReducer {
    // Custom context is agent-only unless its producer explicitly opts into display.
    // Never infer visibility from words in user or assistant messages.
    private fun hiddenMessage(message: JSONObject): Boolean = message.opt("display") == false ||
        (message.optString("role") == "custom" && message.opt("display") != true) ||
        (message.optString("role") == "toolResult" && MessageContent.hiddenMetadataTool(message.optString("toolName")))
    private fun toolKey(id: String) = "tool:" + id
    private fun messageKey(message: JSONObject): String? {
        if (message.optString("role") == "toolResult") message.optString("toolCallId").takeUnless { it.isBlank() || it == "null" }?.let { return toolKey(it) }
        val id = message.optString("id").takeUnless { it.isBlank() || it == "null" }
        if (id != null) return "message:" + id
        val timestamp = message.opt("timestamp")
        val time = when (timestamp) {
            is Number -> timestamp.toLong().toString()
            is String -> timestamp.toLongOrNull()?.toString() ?: runCatching { java.time.Instant.parse(timestamp).toEpochMilli().toString() }.getOrNull()
            else -> null
        } ?: return null
        return "message:" + message.optString("role") + ":" + time + ":" + message.optString("toolCallId")
    }

    fun text(value: Any?): String = when (value) {
        null, JSONObject.NULL -> ""
        is String -> value
        is JSONArray -> (0 until value.length()).mapNotNull { index ->
            val block = value.optJSONObject(index)
            when (block?.optString("type")) {
                "text" -> block.optString("text")
                "thinking" -> block.optString("thinking")
                "toolCall" -> if (MessageContent.hiddenMetadataTool(block.optString("name"))) null else block.optString("name") + "\n" + (block.optJSONObject("arguments")?.toString(2) ?: "")
                "image" -> if (block.has("mediaRef") || block.has("unavailable")) null else "[Image attachment]"
                else -> null
            }
        }.joinToString("\n")
        else -> value.toString()
    }
    fun history(id: String, history: JSONObject): SessionView {
        val entries = history.optJSONArray("entries") ?: JSONArray()
        val items = (0 until entries.length()).mapNotNull { i ->
            val entry = entries.optJSONObject(i) ?: return@mapNotNull null
            if (entry.optString("type") != "message") return@mapNotNull null
            val message = entry.optJSONObject("message") ?: return@mapNotNull null
            if (hiddenMessage(message)) return@mapNotNull null
            val role = message.optString("role")
            val parts = if (role == "assistant") MessageContent.read(message.opt("content")) else MessageParts(text(message.opt("content")))
            TimelineItem(messageKey(message) ?: entry.optString("id", "history:$i"), role, (if (role == "toolResult") message.optString("toolName", "Tool output") + "\n" else "") + parts.text,
                kind = if (role == "toolResult") "tool" else "message", raw = entry.toString(), reasoning = parts.reasoning, toolNames = parts.tools,
                historyIndex = (entry.opt("historyEntryIndex") as? Number)?.toLong()?.takeIf { it >= 0 })
        }
        return SessionView(id, items = items, olderCursor = history.optJSONObject("pageInfo")?.optString("oldestCursor")?.takeUnless { it == "null" || it.isEmpty() })
    }
    fun apply(state: SessionView, envelope: JSONObject, force: Boolean = false): SessionView {
        val sequence = envelope.optLong("sequence")
        if (!force && sequence <= state.sequence) return state
        val event = envelope.optJSONObject("event") ?: return state.copy(sequence = sequence)
        val type = event.optString("type")
        if (type.startsWith("tool_execution_") && MessageContent.hiddenMetadataTool(event.optString("toolName"))) {
            val key = toolKey(event.optString("toolCallId"))
            return state.copy(sequence = maxOf(sequence, state.sequence), items = state.items.filterNot { it.id == key })
        }
        if (type == "session_config") return state.copy(sequence = maxOf(sequence, state.sequence), config = state.config.merge(event))
        if (event.optJSONObject("message")?.let(::hiddenMessage) == true) {
            val key = messageKey(event.getJSONObject("message"))
            return state.copy(sequence = maxOf(sequence, state.sequence), items = state.items.filterNot { key != null && it.id == key })
        }
        var items = state.items
        var running = state.running
        val turnId = TimelineStatus.turnId(envelope)
        val stamp = WorkActions.time(envelope.opt("occurredAt"))
        val raw = JSONObject(event.toString()).apply { if (turnId.isNotBlank()) put("_mobileTurnId", turnId); stamp?.let { put("_mobileCreatedAt", it); put("_mobileUpdatedAt", it) } }.toString()
        val eventId = "event:$sequence"
        val requestId = event.optString("requestId")
        when (type) {
            "zyra_server_prompt_accepted" -> {
                val message = event.optJSONObject("message")
                if (turnId.isNotBlank() && message?.optString("role") == "user") {
                    val id = "accepted:$turnId"
                    // Replayed acceptance must never replace an already canonical turn.
                    val canonical = items.any { it.role == "user" && it.id != id && runCatching { JSONObject(it.raw).optString("_mobileTurnId") }.getOrNull() == turnId }
                    if (!canonical && items.none { it.id == id }) items = items + TimelineItem(id, "user", text(message.opt("content")), "message", raw, pending = true)
                    if (!canonical) running = true
                }
            }
            "compaction_start", "compaction_end", "auto_retry_start", "auto_retry_end" -> {
                items = TimelineStatus.apply(items, type, event, raw, eventId, turnId)
                if (type == "auto_retry_end" && !event.optBoolean("success")) running = false
            }
            "agent_start" -> running = true
            "agent_end", "zyra_server_turn_completed" -> {
                if (type == "agent_end" && event.optBoolean("willRetry")) return state.copy(sequence = maxOf(sequence, state.sequence), running = true)
                running = false
                items = items.map { if (it.kind == "stream") it.copy(kind = "message") else if (turnId.isNotBlank() && it.id == "accepted:$turnId") it.copy(pending = false) else it }
                items = TimelineStatus.finish(items, turnId)
                if (event.optString("outcome") == "interrupted" && items.none { it.kind == "turn_outcome" && it.raw == raw })
                    items = items + TimelineItem(eventId, "system", "", "turn_outcome", raw)
                if (event.optString("outcome") == "failed") items = TimelineStatus.apply(items, type, event, raw, eventId, turnId)
            }
            "message_start" -> {
                val msg = event.optJSONObject("message") ?: JSONObject()
                val role = msg.optString("role", "assistant")
                val parts = if (role == "assistant") MessageContent.read(msg.opt("content")) else MessageParts(text(msg.opt("content")))
                val content = parts.text
                if (role == "user") items = items.filterNot { it.pending && it.role == "user" && !it.id.startsWith("accepted:") && it.text == content }
                val id = messageKey(msg) ?: eventId
                if (role != "toolResult") {
                    // A newer history snapshot can already contain this canonical user.
                    // Update that row in place before removing its accepted placeholder.
                    val canonical = if (role == "user") items.indexOfFirst { it.id == id && it.role == role } else -1
                    val index = if (canonical >= 0) canonical else if (role == "user") TimelineStatus.acceptedIndex(items, turnId) else -1
                    val item = TimelineItem(id, role, content, if (role == "assistant") "stream" else "message", retainActionStart(raw, items.getOrNull(index)), reasoning = parts.reasoning, toolNames = parts.tools)
                    items = if (index >= 0) items.toMutableList().also { it[index] = item }
                        else items.filterNot { it.id == id } + item
                }
            }
            "text_delta", "thinking_delta" -> {
                val index = items.indexOfLast { it.kind == "stream" && it.role == "assistant" }
                val lengths = envelope.optJSONArray("deltaLengths")
                val skip = (state.sequence - envelope.optLong("firstSequence", sequence) + 1).coerceAtLeast(0).toInt()
                val offset = if (lengths != null) (0 until minOf(skip, lengths.length())).sumOf { lengths.optInt(it).coerceAtLeast(0) } else 0
                val delta = event.optString("delta").drop(offset)
                val thinking = type == "thinking_delta"
                if (index >= 0) items = items.toMutableList().also { list ->
                    val item = list[index]
                    list[index] = if (thinking) item.copy(reasoning = (item.reasoning + delta).take(262144)) else item.copy(text = (item.text + delta).take(262144))
                }
                else items = items + TimelineItem(eventId, "assistant", if (thinking) "" else delta, "stream", reasoning = if (thinking) delta else "")
                running = true
            }
            "message_update", "message_end" -> {
                val message = event.optJSONObject("message") ?: JSONObject()
                if (!event.has("message")) return state.copy(sequence = maxOf(sequence, state.sequence))
                val role = message.optString("role", "assistant")
                val key = messageKey(message)
                val existing = items.indexOfLast { (key != null && it.id == key) || (!event.optBoolean("canonicalCommit") && it.kind == "stream" && it.role == role) }
                val index = if (existing >= 0) existing else if (role == "user") TimelineStatus.acceptedIndex(items, turnId) else -1
                val previous = items.getOrNull(index)
                var parts = if (role == "assistant") {
                    if (message.has("content")) MessageContent.read(message.opt("content"), previous?.reasoning.orEmpty())
                    else MessageParts(previous?.text.orEmpty(), previous?.reasoning.orEmpty(), previous?.toolNames.orEmpty())
                } else MessageParts(text(message.opt("content")))
                if (event.has("deferred") && previous != null && role == "assistant") {
                    parts = parts.copy(text = if (previous.text.length > parts.text.length) previous.text else parts.text,
                        reasoning = if (previous.reasoning.length > parts.reasoning.length) previous.reasoning else parts.reasoning)
                }
                val content = if (role == "toolResult") message.optString("toolName").ifBlank { previous?.text?.substringBefore('\n') ?: "Tool output" } + "\n" + parts.text else parts.text
                val item = TimelineItem(key ?: previous?.id?.takeUnless { it.startsWith("accepted:") } ?: eventId, role, content, if (role == "toolResult") "tool" else if (type == "message_end") "message" else "stream", retainActionStart(raw, previous), reasoning = parts.reasoning, toolNames = parts.tools,
                    historyIndex = (event.opt("historyEntryIndex") as? Number)?.toLong()?.takeIf { it >= 0 } ?: previous?.historyIndex)
                if (index >= 0) items = items.toMutableList().also { it[index] = item } else if (content.isNotBlank() || parts.reasoning.isNotBlank() || (message.optJSONArray("content")?.length() ?: 0) > 0) items = items + item
            }
            "approval_requested", "user_input_requested" -> {
                val title = if (type == "approval_requested") event.optString("command", event.optString("description", "Approval needed")) else "Zyra needs your answer"
                items = items.filterNot { it.id == requestId } + TimelineItem(requestId, "system", title, type, raw, true)
            }
            "approval_resolved", "user_input_resolved" -> items = items.map { if (it.id == requestId) {
                val resolved = JSONObject(it.raw).apply {
                    put("type", type)
                    event.optJSONObject("answers")?.let { put("answers", it) }
                    put("cancelled", event.optBoolean("cancelled"))
                }
                it.copy(pending = false, kind = "resolved", text = "Answered", raw = resolved.toString())
            } else it }
            "tool_execution_start" -> {
                val id = toolKey(event.optString("toolCallId", eventId))
                items = items.filterNot { it.id == id } + TimelineItem(id, "tool", event.optString("toolName", "Working"), "tool", raw, true)
            }
            "tool_execution_update", "tool_execution_end" -> {
                val id = toolKey(event.optString("toolCallId", eventId))
                val result = event.optJSONObject("result") ?: event.optJSONObject("partialResult")
                val detail = text(result?.opt("content") ?: event.opt("result"))
                val old = items.find { it.id == id }
                val item = TimelineItem(id, "tool", (old?.text?.substringBefore('\n') ?: event.optString("toolName", "Tool")) + "\n" + detail, "tool", retainActionStart(raw, old), type != "tool_execution_end")
                val index = items.indexOfFirst { it.id == id }
                items = if (index < 0) items + item else items.toMutableList().also { it[index] = item }
            }
        }
        if (type in setOf("message_start", "message_update", "message_end") && event.optJSONObject("message")?.optString("role") == "user" && turnId.isNotBlank()) {
            items = items.filterNot { it.id == "accepted:$turnId" }
        }
        if (event.has("deferred") && !event.has("message") && !type.startsWith("tool_execution_") && !TimelineStatus.handles(type)) items = items + TimelineItem(eventId, "tool", "Large output — tap to load", "deferred", raw)
        val previousLocators = state.items.mapNotNull { item -> item.historyIndex?.let { item.id to it } }.toMap()
        return state.copy(sequence = maxOf(sequence, state.sequence), items = items.map { item ->
            if (item.historyIndex == null && previousLocators.containsKey(item.id)) item.copy(historyIndex = previousLocators[item.id]) else item
        }, running = running)
    }
    private fun retainActionStart(raw: String, previous: TimelineItem?): String {
        if (previous == null || previous.raw.isBlank()) return raw
        val old = runCatching { JSONObject(previous.raw) }.getOrNull() ?: return raw
        return JSONObject(raw).apply {
            WorkActions.timestamp(old)?.let { put("_mobileCreatedAt", it) }
            for (key in listOf("args", "toolName")) if (!has(key) && old.has(key)) put(key, old.get(key))
        }.toString()
    }
    fun encode(state: SessionView): String = JSONObject().put("id", state.id).put("sequence", state.sequence).put("running", state.running).put("older", state.olderCursor).put("config", state.config.encode())
        .put("items", JSONArray().apply { state.items.forEach { put(JSONObject().put("id", it.id).put("role", it.role).put("text", it.text).put("kind", it.kind).put("raw", it.raw).put("pending", it.pending).put("reasoning", it.reasoning).put("tools", JSONArray(it.toolNames)).put("historyIndex", it.historyIndex)) } }).toString()
    fun decode(body: String): SessionView {
        val value = JSONObject(body); val array = value.getJSONArray("items")
        return SessionView(value.getString("id"), value.optLong("sequence"), (0 until array.length()).mapNotNull {
            val item = array.getJSONObject(it)
            val tools = item.optJSONArray("tools") ?: JSONArray()
            var restored = TimelineItem(item.getString("id"), item.getString("role"), item.getString("text"), item.optString("kind"), item.optString("raw"), item.optBoolean("pending"), item.optString("reasoning"), (0 until tools.length()).map { i -> tools.getString(i) })
            // Upgrade completed legacy cache entries only when canonical raw content proves the split.
            // Incomplete streamed caches keep all their text until the PC supplies a fresh snapshot.
            val message = MessageContent.fromRaw(restored.raw)
            if (hiddenMessage(message ?: JSONObject().put("role", restored.role))) return@mapNotNull null
            if (!item.has("reasoning") && restored.role == "assistant" && restored.kind != "stream" && message != null && restored.text == text(message.opt("content"))) {
                val parts = MessageContent.read(message.opt("content")); restored = restored.copy(text = parts.text, reasoning = parts.reasoning, toolNames = parts.tools)
            }
            if (restored.kind == "tool") {
                val call = if (message?.optString("role") == "toolResult") message.optString("toolCallId")
                    else runCatching { JSONObject(restored.raw).optString("toolCallId") }.getOrDefault("")
                if (call.isNotBlank() && call != "null") restored = restored.copy(id = toolKey(call))
            }
            val historyIndex = (item.opt("historyIndex") as? Number)?.toLong()
                ?: runCatching { (JSONObject(restored.raw).opt("historyEntryIndex") as? Number)?.toLong() }.getOrNull()
            restored.copy(historyIndex = historyIndex?.takeIf { it >= 0 })
        }.asReversed().distinctBy { it.id }.asReversed(), value.optBoolean("running"), value.optString("older").takeUnless { it.isBlank() || it == "null" }, ChatConfiguration().merge(value.optJSONObject("config") ?: JSONObject()))
    }
}
