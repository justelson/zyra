package dev.zyra.mobile

import dev.zyra.mobile.data.ResponseTimings
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ResponseTimingsTest {
    private fun event(type: String, extra: JSONObject = JSONObject()) = JSONObject().put("requestContext", JSONObject().put("turnId", "mobile:one")).put("event", extra.put("type", type))
    @Test fun skewedClocksKeepProviderReceiptAndActualDisplaySeparate() {
        var clock = 1000L
        val timing = ResponseTimings({ clock }, { 1_000_000 })
        timing.start("mobile:one", "private/custom-model", "variant:private-effort")
        clock += 5; timing.dispatch("mobile:one")
        clock += 95; timing.observe(event("zyra_server_prompt_accepted", JSONObject().put("timingStartedAt", 50_000_000)))
        clock += 30; timing.observe(event("model_request_progress", JSONObject().put("progress", JSONObject().put("requestId", "private-request").put("startedAt", 50_000_010).put("firstEventAt", 50_000_030).put("firstTextAt", 50_000_045))))
        timing.observe(event("text_delta", JSONObject().put("delta", "Private response text")))
        var row = timing.read().getJSONObject(0)
        assertEquals(30, row.getInt("firstEventMs")); assertEquals(45, row.getInt("firstTextMs"))
        assertEquals(130, row.getInt("firstTextReceivedMs")); assertTrue(row.isNull("firstDisplayMs"))
        clock += 20; assertTrue(timing.displayed("mobile:one")); assertFalse(timing.displayed("mobile:one"))
        timing.observe(event("zyra_server_turn_completed", JSONObject().put("outcome", "completed")))
        row = timing.read().getJSONObject(0)
        assertEquals(150, row.getInt("firstDisplayMs")); assertEquals("other", row.getString("model")); assertEquals("unknown", row.getString("effort"))
        assertFalse(timing.read().toString().contains("Private response")); assertFalse(timing.read().toString().contains("private-request"))
        assertFalse(timing.summary("mobile:one").toString().contains("mobile:one"))
    }
    @Test fun unknownHostOriginAndRestoredActiveTurnsRemainTruthfullyUnobserved() {
        val timing = ResponseTimings({ 1000 })
        timing.start("mobile:one", "gpt-6.1-sol", "high")
        timing.observe(event("model_request_progress", JSONObject().put("progress", JSONObject().put("requestId", "one").put("startedAt", 100).put("firstTextAt", 125))))
        val row = timing.read().getJSONObject(0)
        assertTrue(row.isNull("firstTextMs")); assertEquals(25, row.getJSONArray("requests").getJSONObject(0).getInt("firstTextMs"))
        row.put("privatePrompt", "Private history")
        val restored = ResponseTimings({ 2000 }); restored.restore(JSONArray().put(row))
        assertEquals("unfinished", restored.read().getJSONObject(0).getString("outcome"))
        assertFalse(restored.read().toString().contains("Private history")); assertFalse(restored.displayed("mobile:one"))
    }
    @Test fun retryCompactionAndBoundedRetentionDoNotSaveHistory() {
        var clock = 1000L
        val timing = ResponseTimings({ clock }, { clock })
        timing.start("mobile:one", "gpt-6.1-sol", "high")
        timing.observe(event("compaction_start")); clock += 20; timing.observe(event("compaction_end"))
        repeat(2) { timing.observe(event("auto_retry_start", JSONObject().put("attempt", 1).put("recoveryKind", "provider"))) }
        timing.finish("mobile:one", "cancelled")
        assertEquals(20, timing.read().getJSONObject(0).getInt("compactionMs")); assertEquals(1, timing.read().getJSONObject(0).getInt("retryCount"))
        repeat(205) { clock++; timing.start("turn:$it", "gpt-6.1-sol", "high"); timing.finish("turn:$it", "completed") }
        assertEquals(200, timing.read().length())
    }
    @Test fun recoveredCompletionHasAnOutcomeWithoutInventingACompletionTimestamp() {
        val timings = ResponseTimings(now = { 100L })
        timings.start("mobile:offline", "gpt-6.1-sol", "high")
        timings.reconcile(JSONObject().put("latestTurn", JSONObject().put("id", "mobile:offline").put("state", "completed")))
        assertEquals("completed", timings.read().getJSONObject(0).getString("outcome"))
        assertTrue(timings.read().getJSONObject(0).isNull("completedMs"))
        timings.start("mobile:failed", "gpt-6.1-sol", "high")
        timings.reconcile(JSONObject().put("latestTurn", JSONObject().put("id", "mobile:failed").put("state", "error")))
        val rows = timings.read()
        assertEquals("failed", (0 until rows.length()).map { rows.getJSONObject(it) }.first { it.getString("turnId") == "mobile:failed" }.getString("outcome"))
    }
}
