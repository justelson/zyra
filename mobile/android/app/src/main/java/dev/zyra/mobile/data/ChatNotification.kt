package dev.zyra.mobile.data

import org.json.JSONObject

data class ChatNotification(val token: String, val kind: String, val turnId: String, val title: String, val body: String, val occurredAt: String) {
    companion object {
        fun parse(value: JSONObject?): ChatNotification? {
            value ?: return null
            fun text(key: String, limit: Int) = (value.opt(key) as? String).orEmpty().filterNot { it.code < 32 || it.code in 127..159 || it.code in 0x202A..0x202E || it.code in 0x2066..0x2069 }.trim().take(limit)
            val token = text("token", 1024); val kind = text("kind", 20); val turn = text("turnId", 256)
            if (token.isBlank() || turn.isBlank() || kind !in setOf("completed", "update", "input", "approval")) return null
            return ChatNotification(token, kind, turn, text("title", 80), text("body", 400), text("occurredAt", 40))
        }
    }
}

fun Chat.currentNotification(): ChatNotification? = notification?.takeIf {
    it.turnId == lastTurnId && when (it.kind) {
        "completed" -> lastTurnState == "completed"
        "update" -> working
        "input" -> (attention == "user-input" || pendingQuestionCount > 0)
        "approval" -> working && attention == "approval"
        else -> false
    }
}
