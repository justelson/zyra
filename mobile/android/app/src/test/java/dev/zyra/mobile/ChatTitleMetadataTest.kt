package dev.zyra.mobile

import dev.zyra.mobile.data.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ChatTitleMetadataTest {
    private val history = JSONObject("""{"entries":[
        {"type":"message","message":{"id":"u","role":"user","content":"Fix startup"}},
        {"type":"message","message":{"id":"title-call","role":"assistant","content":[{"type":"toolCall","id":"title","name":"set_chat_title","arguments":{"title":"Metadata only"}}]}},
        {"type":"message","message":{"role":"toolResult","toolCallId":"title","toolName":"set_chat_title","content":"Metadata only"}},
        {"type":"message","message":{"id":"answer","role":"assistant","content":"Visible answer"}}
    ]}""")
    private fun event(sequence: Int, value: JSONObject) = JSONObject().put("sequence", sequence).put("event", value)

    @Test fun titleMetadataIsHiddenAfterHistoryAndCacheReplay() {
        val view = TimelineReducer.history("chat", history)
        for (state in listOf(view, TimelineReducer.decode(TimelineReducer.encode(view)))) {
            val rows = TimelineWork().rows(state)
            assertTrue(rows.none { it is ChatRailRow.Work })
            assertEquals(listOf("Fix startup", "Visible answer"), rows.filterIsInstance<ChatRailRow.Message>().map { it.item.text })
            assertTrue(state.items.none { it.role == "toolResult" })
        }
    }
    @Test fun liveTitleEventsNeverProduceActionsOrReplyText() {
        var state = SessionView("chat")
        for ((index, type) in listOf("tool_execution_start", "tool_execution_update", "tool_execution_end").withIndex()) {
            state = TimelineReducer.apply(state, event(index + 1, JSONObject().put("type", type).put("toolName", "set_chat_title").put("toolCallId", "title")))
            assertTrue(state.items.isEmpty())
        }
        val message = history.getJSONArray("entries").getJSONObject(1).getJSONObject("message")
        state = TimelineReducer.apply(state, event(4, JSONObject().put("type", "message_end").put("message", message)))
        assertTrue(TimelineWork().rows(state).isEmpty())
        assertTrue(MessageContent.read(message.getJSONArray("content")).tools.isEmpty())
        assertEquals("", TimelineReducer.text(message.getJSONArray("content")))
    }
    @Test fun ordinaryToolsAndLiteralTitleToolNamesRemainVisible() {
        val view = SessionView("chat", items = listOf(
            TimelineItem("user", "user", "set_chat_title"),
            TimelineItem("tool:read", "tool", "read\nEvidence", "tool"),
            TimelineItem("answer", "assistant", "set_chat_title")
        ))
        val rows = TimelineWork().rows(view)
        assertEquals(1, rows.filterIsInstance<ChatRailRow.Work>().single().actions.size)
        assertEquals(listOf("set_chat_title", "set_chat_title"), rows.filterIsInstance<ChatRailRow.Message>().map { it.item.text })
    }
}
