package dev.zyra.mobile
import dev.zyra.mobile.data.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ChatConfigurationTest {
    @Test fun optionalSettingsRequireHostCapabilitiesAndSurviveReload() {
        assertFalse("codexServiceTier" in ChatConfiguration().supportedFields)
        val config = ChatConfiguration().merge(JSONObject("""{"configurationFields":["model","codexServiceTier"],"codexServiceTier":"priority"}"""))
        assertEquals(setOf("model", "codexServiceTier"), config.supportedFields)
        assertEquals("priority", config.codexServiceTier)
        assertEquals(config, ChatConfiguration().merge(config.encode()))
        assertEquals("flex", config.merge(JSONObject().put("codexServiceTier", "flex")).codexServiceTier)
    }
    @Test fun hostChangesReplaceOnlySuppliedFieldsAndSurviveCache() {
        val initial = SessionView("chat", config = ChatConfiguration().merge(JSONObject("""{"config":{"model":{"id":"test-model"},"thinking":"high","runtimeMode":"auto-review","webSearch":true}}""")))
        val changed = TimelineReducer.apply(initial, JSONObject("""{"sequence":1,"event":{"type":"session_config","thinking":"low","webSearch":false}}"""))
        val restored = TimelineReducer.decode(TimelineReducer.encode(changed))
        assertEquals("test-model", restored.config.model)
        assertEquals("auto-review", restored.config.runtimeMode)
        assertEquals("low", restored.config.thinking)
        assertFalse(restored.config.webSearch)
        assertEquals(restored.config, TimelineReducer.apply(restored, JSONObject("""{"sequence":1,"event":{"type":"session_config","thinking":"high"}}""")).config)
    }
    @Test fun canonicalPermissionAndModelChangesReachVisibleStateWithoutHistoryReload() {
        var view = SessionView("chat", config = ChatConfiguration(model = "old/model", runtimeMode = "approval-required"))
        listOf("auto-review", "edits-only", "full-access", "approval-required").forEachIndexed { index, mode ->
            view = TimelineReducer.apply(view, JSONObject().put("sequence", index + 1).put("event", JSONObject()
                .put("type", "session_config").put("runtimeMode", mode).put("model", "provider/model-$index")))
            assertEquals(mode, view.config.runtimeMode)
            assertEquals("provider/model-$index", view.config.model)
            assertNotEquals("Permissions unavailable", permissionLabel(view.config.runtimeMode))
            assertEquals(view.config, TimelineReducer.decode(TimelineReducer.encode(view)).config)
        }
        assertEquals("Permissions unavailable", permissionLabel(""))
        assertEquals("Permissions unavailable", permissionLabel("future-mode"))
    }
}
