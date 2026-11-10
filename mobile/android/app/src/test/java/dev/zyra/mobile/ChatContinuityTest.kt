package dev.zyra.mobile

import dev.zyra.mobile.data.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ChatContinuityTest {
    private fun user(id: String, root: String? = null) = TimelineItem("message:$id", "user", id, raw = JSONObject().put("message",
        JSONObject().put("id", id).put("role", "user").apply { root?.let { put("zyraUserTurn", JSONObject().put("version", 1).put("rootMessageId", it)) } }).toString())
    private fun event(seq: Long, type: String, turn: String? = "turn", extra: JSONObject = JSONObject()) = JSONObject().put("sequence", seq)
        .apply { turn?.let { put("requestContext", JSONObject().put("turnId", it)) } }.put("event", extra.put("type", type))

    @Test fun steeringSharesOriginalWorkButLegacyAndNewTurnsKeepTheirBoundaries() {
        val initial = listOf(user("root"), TimelineItem("tool:a", "tool", "read", "tool"))
        val steering = initial + user("steer", "root") + TimelineItem("tool:b", "tool", "bash", "tool")
        val projector = TimelineWork()
        val first = projector.rows(SessionView("chat", items = initial, running = true)).filterIsInstance<ChatRailRow.Work>().single()
        val rows = projector.rows(SessionView("chat", items = steering, running = true))
        assertEquals(first.id, rows.filterIsInstance<ChatRailRow.Work>().single().id)
        assertEquals(2, rows.filterIsInstance<ChatRailRow.Message>().count { it.item.role == "user" })
        assertEquals(2, TimelineWork().rows(SessionView("chat", items = initial + user("legacy") + steering.last())).filterIsInstance<ChatRailRow.Work>().size)
        assertEquals(2, TimelineWork().rows(SessionView("chat", items = initial + user("new", "new") + steering.last())).filterIsInstance<ChatRailRow.Work>().size)
    }

    @Test fun explicitReadingSurvivesCompletionAndNewStreamingUpdates() {
        assertTrue(workDisclosureAfterUpdate(true, false, true, true))
        assertFalse(workDisclosureAfterUpdate(false, true, false, true))
        assertFalse(workDisclosureAfterUpdate(true, false, true, false))
        assertTrue(workDisclosureAfterUpdate(false, true, false, false))
    }

    @Test fun canonicalCompletionOwnsRunningAndStopRetainsPartialWork() {
        var view = TimelineReducer.apply(SessionView("chat", items = listOf(user("root")), canonicalTurnCompletion = true), event(1, "agent_start"))
        view = TimelineReducer.apply(view, event(2, "tool_execution_start", extra = JSONObject().put("toolCallId", "a").put("toolName", "bash")))
        view = TimelineReducer.apply(view, event(3, "text_delta", extra = JSONObject().put("delta", "Partial answer")))
        view = TimelineReducer.apply(view, event(4, "agent_end"))
        assertTrue(view.running)
        view = TimelineReducer.apply(view, event(5, "zyra_agent_interruption", extra = JSONObject().put("interruption", JSONObject().put("kind", "stopped").put("source", "user"))))
        assertEquals("Stopping", view.items.last().text)
        view = TimelineReducer.apply(view, event(6, "zyra_server_turn_completed", "old"))
        assertTrue(view.running)
        val cached = TimelineReducer.decode(TimelineReducer.encode(view))
        assertEquals("turn", cached.activeTurnId)
        view = TimelineReducer.apply(cached, event(7, "zyra_server_turn_completed", extra = JSONObject().put("outcome", "interrupted").put("interruption", JSONObject().put("kind", "stopped"))))
        assertFalse(view.running)
        assertTrue(view.items.any { it.text == "Partial answer" })
        assertFalse(view.items.any { it.pending })
        assertEquals("Stopped", TimelineWork().rows(view).filterIsInstance<ChatRailRow.Message>().last().item.text)
    }

    @Test fun legacyAgentEndStillSettles() {
        assertFalse(TimelineReducer.apply(SessionView("chat", running = true), event(1, "agent_end", null)).running)
        assertFalse(TimelineReducer.apply(SessionView("chat", running = true, activeTurnId = "turn"), event(1, "agent_end")).running)
    }
}
