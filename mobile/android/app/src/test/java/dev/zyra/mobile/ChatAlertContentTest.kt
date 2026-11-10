package dev.zyra.mobile

import dev.zyra.mobile.data.*
import dev.zyra.mobile.notifications.ChatAlertPolicy
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ChatAlertContentTest {
    private fun chat(kind: String = "completed", state: String = "completed", turn: String = "turn", token: String = "notice") = Chat(
        "chat", "Project", "/project", if (state == "running") "running" else "ready", null, false,
        lastTurnState = state, lastTurnId = "turn", lastTurnCompletedAt = "2026-11-10T10:00:00Z",
        notification = ChatNotification(token, kind, turn, "Checks passed", "The fix is ready to review.", "2026-11-10T10:00:00Z"))
    @Test fun authoredContentSurvivesCatalogParsingAndIsDeliveredOnce() {
        val policy = ChatAlertPolicy(linkedMapOf(), 0)
        assertEquals("The fix is ready to review.", policy.observe(chat(), null))
        assertNull(policy.observe(chat(), null))
        val notice = ChatNotification.parse(JSONObject().put("token", "one").put("kind", "completed").put("turnId", "turn").put("title", "Safe\u202E title").put("body", "x".repeat(500)))!!
        assertEquals("Safe title", notice.title); assertEquals(400, notice.body.length)
    }
    @Test fun oldHiddenAndAlreadyReadContentNeverAlerts() {
        assertNull(chat(turn = "old").currentNotification())
        assertNull(ChatAlertPolicy(linkedMapOf(), Long.MAX_VALUE).observe(chat(), null))
        assertNull(ChatAlertPolicy(linkedMapOf(), 0).observe(chat().copy(viewed = true), null))
        assertNull(ChatAlertPolicy(linkedMapOf(), 0).observe(chat(), chat().key))
        assertNull(ChatAlertPolicy(linkedMapOf(), 0).observe(chat().copy(lastSeenCompletedTurnId = "turn"), null))
        assertNull(chat("approval", "running").currentNotification())
        assertNull(chat("input", "running").currentNotification())
        assertNotNull(chat("input", "running").copy(pendingQuestionCount = 1).currentNotification())
    }
    @Test fun agentUpdatesCanNotifyDuringWorkWithoutClaimingCompletion() {
        val policy = ChatAlertPolicy(linkedMapOf(), 0)
        assertEquals("The fix is ready to review.", policy.observe(chat("update", "running"), null))
        assertNull(policy.observe(chat("update", "running"), null))
        assertNull(chat("completed", "running").currentNotification())
        assertEquals("The fix is ready to review.", policy.observe(chat(token = "done"), null))
    }
}
