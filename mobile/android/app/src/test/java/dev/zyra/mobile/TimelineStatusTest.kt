package dev.zyra.mobile

import dev.zyra.mobile.data.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TimelineStatusTest {
    private fun event(sequence: Long, type: String, turn: String = "turn-1", extra: JSONObject = JSONObject()) = JSONObject()
        .put("sequence", sequence).put("occurredAt", 1700000000000L + sequence * 1000)
        .put("requestContext", JSONObject().put("turnId", turn)).put("event", extra.put("type", type))
    private fun user(id: String = "canonical-user") = JSONObject().put("id", id).put("role", "user")
        .put("content", JSONArray().put(JSONObject().put("type", "text").put("text", "Continue")))
    private fun apply(state: SessionView, sequence: Long, type: String, extra: JSONObject = JSONObject(), turn: String = "turn-1") =
        TimelineReducer.apply(state, event(sequence, type, turn, extra))

    @Test fun acceptedPromptIsVisibleBeforeCompactionAndCanonicalUserKeepsItsPosition() {
        var state = apply(SessionView("chat", canonicalTurnCompletion = true), 1, "zyra_server_prompt_accepted", JSONObject().put("message", user()))
        assertEquals("accepted:turn-1", state.items.single().id); assertTrue(state.running)
        state = apply(state, 2, "compaction_start", JSONObject().put("reason", "threshold"))
        val projector = TimelineWork()
        val working = projector.rows(state).filterIsInstance<ChatRailRow.Work>().single()
        assertEquals("Compacting context", working.entries.single().text)
        assertTrue(working.entries.single().pending)
        state = apply(state, 3, "message_end", JSONObject().put("message", user()))
        assertEquals(listOf("message:canonical-user", "event:2"), state.items.map { it.id })
        assertEquals(working.id, projector.rows(state).filterIsInstance<ChatRailRow.Work>().single().id)
        assertFalse(state.items.first().pending)
        state = apply(state, 4, "compaction_end", JSONObject().put("result", JSONObject().put("tokensBefore", 4000)))
        assertEquals(2, state.items.size)
        assertEquals("Context compacted", state.items.last().text)
        assertEquals(4000, JSONObject(state.items.last().raw).getJSONObject("result").getInt("tokensBefore"))
        assertEquals("threshold", JSONObject(working.entries.single().raw).getString("reason"))
    }

    @Test fun acceptedReconciliationIsTurnScopedAndWorksForEveryCanonicalMessagePhase() {
        for (phase in listOf("message_start", "message_update", "message_end")) {
            var state = apply(SessionView("chat", canonicalTurnCompletion = true), 1, "zyra_server_prompt_accepted", JSONObject().put("message", user()), "first")
            state = apply(state, 2, "zyra_server_prompt_accepted", JSONObject().put("message", user()), "second")
            state = apply(state, 3, phase, JSONObject().put("message", user()), "second")
            assertEquals(listOf("accepted:first", "message:canonical-user"), state.items.map { it.id })
            state = apply(state, 4, "zyra_server_prompt_accepted", JSONObject().put("message", user()), "second")
            assertEquals(2, state.items.size)
        }
    }

    @Test fun newerHistoryAndAcceptedSnapshotConvergeInPlaceForEveryCanonicalPhase() {
        for (phase in listOf("message_start", "message_update", "message_end")) {
            val history = JSONObject().put("entries", JSONArray()
                .put(JSONObject().put("type", "message").put("historyEntryIndex", 12).put("message", user()))
                .put(JSONObject().put("type", "message").put("message", JSONObject().put("id", "following").put("role", "assistant").put("content", "Later row"))))
            var state = TimelineReducer.history("chat", history)
            state = TimelineReducer.apply(state, event(1, "zyra_server_prompt_accepted", extra = JSONObject().put("message", user())), force = true)
            state = apply(state, 2, "zyra_server_prompt_accepted", JSONObject().put("message", user("other")), "other-turn")
            val canonical = user().put("content", "Canonical content")
            state = apply(state, 3, phase, JSONObject().put("message", canonical))
            assertEquals(listOf("message:canonical-user", "message:following", "accepted:other-turn"), state.items.map { it.id })
            assertEquals("Canonical content", state.items.first().text)
            assertEquals(12L, state.items.first().historyIndex)
            assertEquals("turn-1", JSONObject(state.items.first().raw).getString("_mobileTurnId"))
            assertFalse(state.items.first().pending)
        }
    }

    @Test fun imageOnlyAcceptedPromptRetainsProjectedMediaAndCanonicalWithoutIdentityConverges() {
        val message = JSONObject().put("role", "user").put("content", JSONArray().put(JSONObject().put("type", "image").put("mediaRef", JSONObject().put("sha256", "safe-ref"))))
        var state = apply(SessionView("chat", canonicalTurnCompletion = true), 1, "zyra_server_prompt_accepted", JSONObject().put("message", message))
        assertEquals("", state.items.single().text)
        assertTrue(JSONObject(state.items.single().raw).getJSONObject("message").getJSONArray("content").getJSONObject(0).has("mediaRef"))
        state = apply(state, 2, "message_end", JSONObject().put("message", message))
        assertEquals(1, state.items.size); assertFalse(state.items.single().id.startsWith("accepted:"))
        assertFalse(state.items.single().pending)
    }

    @Test fun postTurnCompactionDoesNotRestartCompletedTurnOrHideFinalAnswer() {
        var state = apply(SessionView("chat", canonicalTurnCompletion = true), 1, "message_start", JSONObject().put("message", user()))
        state = apply(state, 2, "message_end", JSONObject().put("message", JSONObject().put("id", "answer").put("role", "assistant").put("content", "Finished")))
        state = apply(state, 3, "agent_end")
        state = apply(state, 4, "compaction_start")
        assertFalse(state.running)
        val rows = TimelineWork().rows(state)
        val work = rows.filterIsInstance<ChatRailRow.Work>().single()
        assertFalse(work.running); assertTrue(work.finalVisible); assertTrue(work.entries.single().pending)
        assertEquals("Finished", (rows.last() as ChatRailRow.Message).item.text)
        state = apply(state, 5, "compaction_end")
        assertFalse(state.running); assertFalse(state.items.last().pending)
    }

    @Test fun recoveryAndFailureStayInWorkBlockWithoutRenderingRawServerError() {
        var state = apply(SessionView("chat", canonicalTurnCompletion = true), 1, "message_start", JSONObject().put("message", user()))
        state = apply(state, 2, "agent_start")
        state = apply(state, 3, "auto_retry_start", JSONObject().put("recoveryKind", "network").put("attempt", 2).put("maxAttempts", 5).put("errorMessage", "private endpoint detail"))
        state = apply(state, 4, "agent_end", JSONObject().put("willRetry", true))
        assertTrue(state.running)
        assertEquals("Reconnecting · 2 of 5", state.items.last().text)
        state = apply(state, 5, "auto_retry_end", JSONObject().put("success", false).put("finalError", "private endpoint detail"))
        assertTrue(state.running)
        assertEquals("Connection interrupted", state.items.last().text)
        val rows = TimelineWork().rows(state)
        assertEquals(1, rows.filterIsInstance<ChatRailRow.Message>().size)
        assertTrue(TimelineStatus.failed(rows.filterIsInstance<ChatRailRow.Work>().single().entries.single()))
        assertEquals("private endpoint detail", JSONObject(state.items.last().raw).getString("finalError"))
        state = apply(state, 6, "zyra_server_turn_completed")
        assertFalse(state.running)
        val restored = TimelineReducer.decode(TimelineReducer.encode(state))
        assertEquals(state, restored)
    }

    @Test fun deferredOperationalMetadataNeverCreatesASeparateToolOutput() {
        for (type in listOf("compaction_start", "compaction_end", "auto_retry_start", "auto_retry_end", "zyra_server_turn_completed")) {
            val extra = JSONObject().put("deferred", JSONObject().put("sha256", "safe-large-ref"))
                .put("outcome", "failed").put("success", false)
            val initial = apply(SessionView("chat", canonicalTurnCompletion = true), 1, "message_start", JSONObject().put("message", user()))
            val state = apply(initial, 2, type, extra)
            val work = TimelineWork().rows(state).filterIsInstance<ChatRailRow.Work>().single()
            assertEquals(1, work.entries.size)
            assertEquals("work_status", work.entries.single().kind)
            assertTrue(JSONObject(work.entries.single().raw).has("deferred"))
            assertTrue(work.actions.isEmpty())
            assertFalse(state.items.any { it.kind == "deferred" || it.kind == "tool" })
        }
    }

    @Test fun terminalFailureRetainsMetadataInsideWorkAndFinishesPendingStatuses() {
        var state = apply(SessionView("chat", canonicalTurnCompletion = true), 1, "message_start", JSONObject().put("message", user()))
        state = apply(state, 2, "compaction_start")
        state = apply(state, 3, "zyra_server_turn_completed", JSONObject().put("outcome", "failed").put("errorMessage", "sensitive provider payload"))
        val work = TimelineWork().rows(state).filterIsInstance<ChatRailRow.Work>().single()
        assertFalse(work.entries.any { it.pending })
        assertEquals("The turn failed", work.entries.last().text)
        assertEquals("sensitive provider payload", JSONObject(work.entries.last().raw).getString("errorMessage"))
        assertFalse(work.entries.any { it.text.contains("sensitive") })
    }
}
