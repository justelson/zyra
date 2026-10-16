package dev.zyra.mobile.data

/** Desktop inbox policy: idle chats settle after three days; explicit choices expire on activity. */
object ChatSettlement {
    fun decode(raw: String): Map<String, String> = runCatching {
        val value = org.json.JSONObject(raw)
        value.keys().asSequence().take(512).mapNotNull { key -> (value.opt(key) as? String)?.let { key to it } }.toMap()
    }.getOrDefault(emptyMap())
    fun encode(values: Map<String, String>): String = org.json.JSONObject(values).toString()

    fun marker(chat: Chat): String? = if (!chat.working && chat.attention == null &&
        chat.lastTurnState in setOf("completed", "error", "failed", "interrupted") &&
        chat.lastTurnId.isNotBlank() && chat.lastTurnCompletedAt.isNotBlank())
        "${chat.lastTurnId}:${chat.lastTurnState}:${chat.lastTurnCompletedAt}" else null

    private fun activity(chat: Chat) = chat.modifiedAt.ifBlank { chat.lastTurnCompletedAt }
    private fun activeMarker(chat: Chat) = "active:" + (marker(chat) ?: activity(chat))
    fun legacyChoice(chat: Chat, values: Map<String, String>): Boolean? {
        if (chat.working || chat.attention != null) return null
        val saved = values[chat.key] ?: return null
        if (saved == activeMarker(chat)) return false
        return if (marker(chat) == saved) true else null
    }
    fun isSettled(chat: Chat, values: Map<String, String>) = isSettled(chat, values, System.currentTimeMillis())
    fun isSettled(chat: Chat, values: Map<String, String>, now: Long): Boolean {
        if (chat.working || chat.attention != null) return false
        chat.settled?.let { return it }
        if (values[chat.key] == activeMarker(chat)) return false
        if (marker(chat)?.let { values[chat.key] == it } == true) return true
        if (chat.lastTurnState in setOf("failed", "error", "interrupted") || chat.state in setOf("failed", "error")) return false
        val updated = runCatching { java.time.Instant.parse(activity(chat)).toEpochMilli() }.getOrNull() ?: return false
        return updated > 0 && now - updated >= 3L * 24 * 60 * 60 * 1000
    }
    fun update(values: Map<String, String>, chat: Chat, settled: Boolean): Map<String, String> {
        val next = LinkedHashMap(values)
        next.remove(chat.key)
        if (settled) marker(chat)?.let { next[chat.key] = it }
        else next[chat.key] = activeMarker(chat)
        while (next.size > 512) next.remove(next.keys.first())
        return next
    }
    fun reconcile(values: Map<String, String>, chats: List<Chat>): Map<String, String> {
        val invalid = chats.filter { chat -> chat.key in values &&
            (chat.working || chat.attention != null || marker(chat)?.let { values[chat.key] != it && values[chat.key] != activeMarker(chat) } == true) }.map { it.key }.toSet()
        return if (invalid.isEmpty()) values else values.filterKeys { it !in invalid }
    }
}
