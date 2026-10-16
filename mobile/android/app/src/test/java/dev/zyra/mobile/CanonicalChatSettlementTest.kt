package dev.zyra.mobile

import dev.zyra.mobile.data.Chat
import dev.zyra.mobile.data.ChatSettlement
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CanonicalChatSettlementTest {
    private val chat = Chat("one", "Fixture", "/repo", "ready", null, false, "pc", modifiedAt = "2026-10-08T10:00:00Z", lastTurnState = "completed", lastTurnId = "turn", lastTurnCompletedAt = "2026-10-08T10:00:00Z")
    @Test fun canonicalTrueAndFalseWinAcrossSurfaces() {
        val localSettled = ChatSettlement.update(emptyMap(), chat, true)
        val localActive = ChatSettlement.update(emptyMap(), chat, false)
        assertFalse(ChatSettlement.isSettled(chat.copy(settled = false), localSettled))
        assertTrue(ChatSettlement.isSettled(chat.copy(settled = true), localActive))
        assertFalse(ChatSettlement.isSettled(chat.copy(settled = true, state = "running"), localSettled))
        assertFalse(ChatSettlement.isSettled(chat.copy(settled = true, attention = "input"), localSettled))
    }
    @Test fun canonicalParsingRetainsFalseAndManualMarker() {
        val value = JSONObject("""{"canonicalChatId":"one","settled":false,"settlementManual":true}""")
        assertEquals(false, Chat.parse(value).settled)
        assertEquals(true, Chat.parse(value).settlementManual)
        value.remove("settled"); assertNull(Chat.parse(value).settled)
        value.put("settled", "true"); assertNull(Chat.parse(value).settled)
    }
    @Test fun migrationUsesOnlyValidSavedChoices() {
        val localSettled = ChatSettlement.update(emptyMap(), chat, true)
        assertEquals(true, ChatSettlement.legacyChoice(chat, localSettled))
        assertEquals(false, ChatSettlement.legacyChoice(chat, ChatSettlement.update(emptyMap(), chat, false)))
        assertNull(ChatSettlement.legacyChoice(chat.copy(lastTurnId = "new-turn"), localSettled))
        assertNull(ChatSettlement.legacyChoice(chat.copy(state = "running"), localSettled))
        assertNull(ChatSettlement.legacyChoice(chat, emptyMap()))
    }
}
