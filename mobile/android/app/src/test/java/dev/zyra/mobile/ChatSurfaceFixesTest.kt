package dev.zyra.mobile

import dev.zyra.mobile.data.*
import dev.zyra.mobile.notifications.ChatAlertPolicy
import org.junit.Assert.*
import org.junit.Test

class ChatSurfaceFixesTest {
    @Test fun canonicalReadAndOtherSurfaceVisibilitySuppressAlerts() {
        val done = Chat("c", "Title", "p", "ready", null, false, "pc", lastTurnId="one", lastTurnState="completed", lastTurnCompletedAt="1970-01-01T00:00:03Z")
        assertNull(ChatAlertPolicy(linkedMapOf(), 2000).observe(done.copy(lastSeenCompletedTurnId="one"), null))
        assertNull(ChatAlertPolicy(linkedMapOf(), 2000).observe(done.copy(viewed=true), null))
        assertNull(ChatAlertPolicy(linkedMapOf(), 2000).observe(done.copy(viewed=true, attention="user-input"), null))
        assertEquals("Response ready", ChatAlertPolicy(linkedMapOf(), 2000).observe(done, null))
        val parsed = Chat.parse(org.json.JSONObject().put("canonicalChatId", "c").put("lastSeenCompletedTurnId", "one")
            .put("presence", org.json.JSONObject().put("latestTurn", org.json.JSONObject().put("id", "one").put("state", "completed"))
                .put("viewers", org.json.JSONArray().put(org.json.JSONObject().put("surface", "desktop")))))
        assertEquals("one", parsed.lastSeenCompletedTurnId)
        assertTrue(parsed.viewed)
    }
    private val context = "<browser-context>{\"source\":\"Zyra Chrome sidebar\",\"targetId\":\"control-target:chrome-tab:abc-123\"}</browser-context>"
    @Test fun browserContextIsDisplayOnly() {
        val prompt = "Hello\n\n$context"
        assertEquals("Hello", BrowserContext.display(prompt))
        assertEquals("Hello", MessageAttachments.parse(prompt).body)
        assertTrue(prompt.contains("browser-context"))
        assertEquals("```\n$context\n```", BrowserContext.display("```\n$context\n```"))
        assertEquals("Hello\n\nAttached files (1):\nx", BrowserContext.display("$prompt\n\nAttached files (1):\nx"))
        assertEquals("<browser-context>invalid</browser-context>", BrowserContext.display("<browser-context>invalid</browser-context>"))
    }
    @Test fun titlesUpdateWithoutDependingOnTheListFilter() {
        val chat = Chat("c", "Generated title", "p", "idle", null, false, "pc")
        val pages = mapOf("pc" to ChatPage(listOf(chat), query="old search"), "other" to ChatPage(listOf(chat.copy(machineId="other", title="Wrong PC"))))
        assertEquals("Generated title", ChatTitles.current(pages, "pc", "c", "Old title"))
        assertEquals("Old title", ChatTitles.current(pages, "missing", "c", "Old title"))
        assertEquals("Old title", ChatTitles.current(mapOf("pc" to ChatPage(listOf(chat.copy(title="New chat")))), "pc", "c", "Old title"))
        assertEquals("Hello", ChatTitles.initial("New chat", "Hello\n\n$context"))
        assertEquals("Named chat", ChatTitles.initial("Named chat", "Hello"))
        assertEquals(80, ChatTitles.initial("New chat", "a".repeat(100)).length)
    }
    @Test fun notificationsFollowTransitionsAndDeduplicateAcrossRestarts() {
        val seen = linkedMapOf<String, String>()
        val policy = ChatAlertPolicy(seen, 2000)
        val chat = Chat("c", "Title", "p", "idle", null, false, "pc", lastTurnId="one", lastTurnState="completed", lastTurnCompletedAt="1970-01-01T00:00:01Z")
        assertNull(policy.observe(chat, null)) // no old completion flood
        val working = chat.copy(state="running", lastTurnState="running", lastTurnId="two")
        assertNull(policy.observe(working, null))
        val done = working.copy(state="idle", lastTurnState="completed", lastTurnCompletedAt="1970-01-01T00:00:03Z")
        assertEquals("Response ready", policy.observe(done, null))
        assertNull(policy.observe(done, null))
        assertNull(ChatAlertPolicy(seen, 5000).observe(done, null))
        val approval = done.copy(attention="approval")
        assertEquals("Approval needed", policy.observe(approval, null))
        assertNull(policy.observe(approval, null))
        assertNull(policy.observe(done, null)) // clearing approval is not another completion
        assertNull(policy.observe(done.copy(lastTurnId="three"), done.key))
        assertEquals("Your response is needed", policy.observe(done.copy(attention="question"), null))
        assertNull(policy.observe(done.copy(archived=true, lastTurnId="four"), null))
        assertEquals("Chat needs attention", policy.observe(done.copy(lastTurnState="failed"), null))
    }
}
