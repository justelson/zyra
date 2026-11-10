package dev.zyra.mobile.data

import org.json.JSONObject
import org.json.JSONArray

val legacyChatConfigurationFields = setOf("model", "thinking", "profile", "runtimeMode", "webSearch", "webFetch")
data class ChatConfiguration(val model: String = "", val thinking: String = "", val runtimeMode: String = "", val webSearch: Boolean = false, val webFetch: Boolean = false, val profile: String = "",
    val codexServiceTier: String = "", val supportedFields: Set<String> = legacyChatConfigurationFields) {
    fun merge(source: JSONObject): ChatConfiguration {
        val value = source.optJSONObject("config") ?: source
        fun text(key: String, previous: String) = if (value.has(key) && !value.isNull(key)) value.optString(key) else previous
        val modelValue = value.optJSONObject("model")
        val fields = value.optJSONArray("configurationFields")
        return copy(model = modelValue?.optString("id") ?: text("model", model), thinking = text("thinking", thinking), runtimeMode = text("runtimeMode", runtimeMode), profile = text("profile", profile), codexServiceTier = text("codexServiceTier", codexServiceTier),
            supportedFields = fields?.let { (0 until it.length()).map { i -> it.optString(i) }.filter(String::isNotBlank).toSet() } ?: supportedFields,
            webSearch = if (value.has("webSearch")) value.optBoolean("webSearch") else webSearch, webFetch = if (value.has("webFetch")) value.optBoolean("webFetch") else webFetch)
    }
    fun encode(): JSONObject = JSONObject().put("model", model).put("thinking", thinking).put("runtimeMode", runtimeMode).put("webSearch", webSearch).put("webFetch", webFetch).put("profile", profile).put("codexServiceTier", codexServiceTier).put("configurationFields", JSONArray(supportedFields.toList()))
}

/** Unknown or not-yet-loaded permissions must never look like granted access. */
fun permissionLabel(mode: String): String = when (mode) {
    "approval-required" -> "Supervised"
    "auto-review" -> "Auto review"
    "edits-only" -> "Edits only"
    "full-access" -> "Full access"
    else -> "Permissions unavailable"
}
