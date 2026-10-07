package dev.zyra.mobile.data

import org.json.JSONObject
import java.net.URI
import java.util.Base64

data class Machine(val id: String, val deviceId: String, val name: String, val url: String, val fingerprint: String, val token: String) {
    fun json() = JSONObject().put("id", id).put("deviceId", deviceId).put("name", name).put("url", url).put("fingerprint", fingerprint).put("token", token)
    companion object {
        fun parse(v: JSONObject) = Machine(v.getString("id"), v.getString("deviceId"), v.getString("name"), v.getString("url"), v.getString("fingerprint"), v.getString("token"))
    }
}
data class Pairing(val hostId: String, val name: String, val url: String, val fingerprint: String, val secret: String, val expiresAt: Long) {
    companion object {
        fun parse(link: String, now: Long = System.currentTimeMillis()): Pairing {
            require(link.length <= 4096) { "Pairing code is too long." }
            val uri = URI(link.trim())
            require(uri.scheme == "zyra" && uri.host == "pair" && !uri.rawFragment.isNullOrEmpty()) { "Scan a Zyra pairing code from your PC." }
            val v = JSONObject(String(Base64.getUrlDecoder().decode(uri.rawFragment), Charsets.UTF_8))
            require(v.getInt("v") == 1) { "Update Zyra to use this pairing code." }
            val endpoint = URI(v.getString("url"))
            require(endpoint.scheme == "https" && !endpoint.host.isNullOrBlank() && endpoint.userInfo == null && endpoint.query == null && endpoint.fragment == null && endpoint.path.orEmpty() in listOf("", "/")) { "Pairing requires a secure host address." }
            val pin = v.getString("fingerprint").lowercase()
            require(Regex("[a-f0-9]{64}").matches(pin)) { "Invalid host fingerprint." }
            val expiry = v.getLong("expiresAt")
            require(expiry > now && expiry - now <= 300000) { "Pairing expired. Create a new code on your PC." }
            require(v.getString("secret").length in 32..128) { "Invalid pairing secret." }
            return Pairing(v.getString("hostId"), v.getString("name"), v.getString("url").trimEnd('/'), pin, v.getString("secret"), expiry)
        }
    }
}
data class Chat(val id: String, val title: String, val project: String, val state: String, val attention: String?, val archived: Boolean, val machineId: String = "", val modifiedAt: String = "", val model: String = "", val lastTurnState: String = "", val tuiOpen: Boolean = false, val hasChanges: Boolean? = null, val hasWork: Boolean? = null, val activeTurnStartedAt: String = "", val lastTurnId: String = "", val lastTurnCompletedAt: String = "", val lastSeenCompletedTurnId: String = "", val viewed: Boolean = false) {
    val key get() = "$machineId:$id"
    val working get() = state == "running" || state == "background"
    val modelLabel get() = model.substringAfter('/').ifBlank { "Assistant" }
    companion object {
        fun parse(v: JSONObject, machineId: String = ""): Chat {
            val presence = v.optJSONObject("presence")
            val turn = presence?.optJSONObject("latestTurn")
            val activeId = presence?.optString("activeTurnId").orEmpty()
            val startedAt = if (activeId.isNotBlank() && activeId != "null" && turn?.optString("id") == activeId && turn.optString("state") == "running")
                (turn.opt("startedAt") as? String).orEmpty() else ""
            return Chat(v.getString("canonicalChatId"), BrowserContext.display(v.optString("title", "Untitled chat")), v.optString("project"),
                presence?.optString("state") ?: "detached", presence?.optString("attention")?.takeUnless { it == "null" || it.isBlank() }, v.optBoolean("archived"), machineId, v.optString("modifiedAt"), chatModel(v.opt("model")),
                presence?.optJSONObject("latestTurn")?.optString("state").orEmpty().takeUnless { it == "null" }.orEmpty(),
                presence?.optJSONArray("clients")?.let { clients -> (0 until clients.length()).any { clients.optJSONObject(it)?.optString("surface") == "tui" } } ?: false, v.opt("hasChanges") as? Boolean, v.opt("hasWork") as? Boolean, startedAt, (turn?.opt("id") as? String).orEmpty(), (turn?.opt("completedAt") as? String).orEmpty(), (v.opt("lastSeenCompletedTurnId") as? String).orEmpty(), (presence?.optJSONArray("viewers")?.length() ?: 0) > 0)
        }
    }
}
fun chatModel(value: Any?): String {
    val raw = if (value is JSONObject) {
        val id = (value.opt("id") as? String ?: value.opt("modelId") as? String).orEmpty()
        val provider = (value.opt("provider") as? String).orEmpty()
        if (id.isBlank()) "" else if (provider.isNotBlank() && !id.startsWith("$provider/")) "$provider/$id" else id
    } else value as? String ?: ""
    return raw.takeIf { it.length <= 1025 && it.none { c -> c.code < 32 || c.code == 127 } }?.trim().orEmpty()
}
data class TimelineItem(val id: String, val role: String, val text: String, val kind: String = "message", val raw: String = "", val pending: Boolean = false, val reasoning: String = "", val toolNames: List<String> = emptyList(), val historyIndex: Long? = null)
data class SessionView(val id: String = "", val sequence: Long = 0, val items: List<TimelineItem> = emptyList(), val running: Boolean = false, val olderCursor: String? = null, val config: ChatConfiguration = ChatConfiguration())
enum class ConnectionState { Offline, Connecting, Connected, Reconnecting }

data class AvailableModel(val id: String, val label: String, val description: String, val efforts: List<String>, val contextWindow: Int) {
    companion object {
        fun parse(value: JSONObject): AvailableModel {
            val array = value.optJSONArray("supportedEfforts")
            return AvailableModel(value.getString("id"), value.optString("label", value.getString("id")), value.optString("description"),
                (0 until (array?.length() ?: 0)).map { array!!.getString(it) }, value.optInt("contextWindow"))
        }
    }
}

