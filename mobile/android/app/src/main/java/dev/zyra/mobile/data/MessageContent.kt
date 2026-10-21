package dev.zyra.mobile.data

import org.json.JSONArray
import org.json.JSONObject

/** Canonical reply content stays separate from reasoning and tool inspection. */
data class MessageParts(val text: String = "", val reasoning: String = "", val tools: List<String> = emptyList())
object MessageContent {
    fun hiddenMetadataTool(name: String): Boolean = name == "set_chat_title"
    private val leadingNewlines = Regex("^(?:\\r?\\n){1,2}")
    fun read(value: Any?, previousReasoning: String = ""): MessageParts {
        val text = mutableListOf<String>(); val thoughts = mutableListOf<String>(); val tools = mutableListOf<String>()
        var hasThinking = false
        when (value) {
            is String -> text.add(value)
            is JSONArray -> for (i in 0 until value.length()) {
                val block = value.optJSONObject(i) ?: continue
                when (block.optString("type")) {
                    "text" -> text.add(block.optString("text"))
                    "thinking" -> { hasThinking = true; thoughts.add(block.optString("thinking").ifBlank { block.optString("text") }) }
                    "toolCall" -> block.optString("name").takeUnless(::hiddenMetadataTool)?.let { tools.add(it.ifBlank { "Tool" }) }
                }
            }
        }
        val reasoning = if (hasThinking) thoughts.joinToString("\n") else previousReasoning
        return MessageParts(separate(reasoning, text.joinToString("\n")), reasoning, tools.distinct())
    }
    // Match Desktop's cumulative-snapshot recovery without a quadratic suffix scan.
    private fun separate(reasoning: String, text: String): String {
        if (reasoning.isEmpty() || text.isEmpty()) return text
        val size = minOf(reasoning.length, text.length)
        val prefix = text.take(size)
        val fallback = IntArray(size)
        var matched = 0
        for (i in 1 until size) {
            while (matched > 0 && prefix[i] != prefix[matched]) matched = fallback[matched - 1]
            if (prefix[i] == prefix[matched]) matched++
            fallback[i] = matched
        }
        matched = 0
        for (character in reasoning) {
            while (matched > 0 && (matched == size || character != prefix[matched])) matched = fallback[matched - 1]
            if (matched < size && character == prefix[matched]) matched++
        }
        val minimum = minOf(24, maxOf(8, (size * 0.25).toInt()))
        return if (matched >= minimum) text.drop(matched).replaceFirst(leadingNewlines, "") else text
    }
    fun fromRaw(raw: String): JSONObject? = runCatching { JSONObject(raw).optJSONObject("message") }.getOrNull()
}
