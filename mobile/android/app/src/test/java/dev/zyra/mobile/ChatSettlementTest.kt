package dev.zyra.mobile

import dev.zyra.mobile.data.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class ChatSettlementTest {
    private val finished = Chat("one", "Ready for review", "/project", "ready", null, false, "pc", lastTurnState = "completed", lastTurnId = "turn-1", lastTurnCompletedAt = Instant.now().toString())
    @Test fun settlingIsExplicitAndMachineAndTurnScoped() {
        assertFalse(ChatSettlement.isSettled(finished, emptyMap()))
        val values = ChatSettlement.update(emptyMap(), finished, true)
        assertTrue(ChatSettlement.isSettled(finished, values))
        assertFalse(ChatSettlement.isSettled(finished.copy(machineId = "other"), values))
        assertFalse(ChatSettlement.isSettled(finished.copy(lastTurnId = "turn-2"), values))
        assertEquals(listOf("Settled"), chatInboxSections(listOf(finished), values).map { it.first })
        assertEquals(listOf("Recent"), chatInboxSections(listOf(finished), emptyMap()).map { it.first })
        assertFalse(ChatSettlement.isSettled(finished, ChatSettlement.update(values, finished, false)))
    }
    @Test fun newWorkOrAttentionInvalidatesPersistedSettlement() {
        val values = ChatSettlement.update(emptyMap(), finished, true)
        for (chat in listOf(finished.copy(state = "running"), finished.copy(state = "background"), finished.copy(attention = "approval"), finished.copy(lastTurnId = "new"))) {
            assertNull(ChatSettlement.reconcile(values, listOf(chat))[finished.key])
            assertFalse(ChatSettlement.isSettled(chat, values))
        }
        assertEquals(values, ChatSettlement.reconcile(values, listOf(finished.copy(lastTurnId = "", lastTurnState = ""))))
        assertNull(ChatSettlement.marker(finished.copy(lastTurnId = "")))
        assertNull(ChatSettlement.marker(finished.copy(lastTurnCompletedAt = "")))
    }
    @Test fun settledRowsNeverHideFreshCompletionsOrErrorsByDefault() {
        val values = ChatSettlement.update(emptyMap(), finished, true)
        val fresh = finished.copy(id = "new", lastTurnId = "turn-2")
        val failed = finished.copy(id = "failed", lastTurnState = "error")
        val groups = chatInboxSections(listOf(fresh, finished, failed), values)
        assertEquals(listOf("new", "failed"), groups.first { it.first == "Recent" }.second.map { it.id })
        assertEquals(listOf("one"), groups.first { it.first == "Settled" }.second.map { it.id })
    }
    @Test fun runningTimerUsesOnlyMatchingCanonicalActiveTurn() {
        val payload = JSONObject("""{"canonicalChatId":"one","modifiedAt":"2026-09-17T10:00:00Z","presence":{"state":"running","activeTurnId":"turn-2","latestTurn":{"id":"turn-2","state":"running","startedAt":"2026-09-17T09:58:35Z"}}}""")
        val chat = Chat.parse(payload, "pc")
        assertEquals("1m 25s", chatWorkingDuration(chat, Instant.parse("2026-09-17T10:00:00Z").toEpochMilli()))
        payload.getJSONObject("presence").put("activeTurnId", "turn-other")
        assertNull(chatWorkingDuration(Chat.parse(payload), Instant.parse("2026-09-17T10:00:00Z").toEpochMilli()))
        assertNull(chatWorkingDuration(chat.copy(state = "ready")))
        assertNull(chatWorkingDuration(chat.copy(activeTurnStartedAt = "bad")))
        assertEquals("0s", chatWorkingDuration(chat, 0))
    }
    @Test fun savedSettlementRestoresAndInvalidDataFallsBackSafely() {
        val values = ChatSettlement.update(emptyMap(), finished, true)
        assertEquals(values, ChatSettlement.decode(ChatSettlement.encode(values)))
        assertTrue(ChatSettlement.isSettled(finished, ChatSettlement.decode(ChatSettlement.encode(values))))
        assertEquals(emptyMap<String, String>(), ChatSettlement.decode("bad json"))
        assertEquals(emptyMap<String, String>(), ChatSettlement.decode("{\"one\":null,\"two\":32}"))
    }
    @Test fun settlementStorageIsBounded() {
        var values = emptyMap<String, String>()
        repeat(520) { values = ChatSettlement.update(values, finished.copy(id = "chat-$it"), true) }
        assertEquals(512, values.size)
        assertFalse(values.containsKey("pc:chat-0"))
        assertTrue(values.containsKey("pc:chat-519"))
    }
}
