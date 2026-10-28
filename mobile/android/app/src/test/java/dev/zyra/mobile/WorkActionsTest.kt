package dev.zyra.mobile

import dev.zyra.mobile.data.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WorkActionsTest {
    private fun project(name: String, args: String = "{}", result: String = "{}", output: String = "", surface: String? = null): WorkAction {
        val raw=JSONObject().put("toolName",name).put("args",JSONObject(args)).put("result",JSONObject(result))
        if(surface!=null)raw.put("surface",JSONObject(surface))
        return WorkActions.project(TimelineItem("tool:one","tool",name+"\n"+output,"tool",raw.toString()))
    }
    @Test fun `desktop action families use intent instead of raw tool names`() {
        val cases = listOf(
            Triple("bash", """{"command":"npm run build"}""", "command" to "Building project"),
            Triple("read", """{"filePath":"C:/project/app.ts"}""", "read" to "Reading app.ts"),
            Triple("write", """{"paths":["a.ts","b.ts"]}""", "edit" to "Editing a.ts +1"),
            Triple("grep", """{"pattern":"sessionState"}""", "search" to "Searching sessionState"),
            Triple("web_search", """{"query":"Android navigation"}""", "web-search" to "Searching Android navigation"),
            Triple("web_fetch", """{"url":"https://developer.android.com/reference"}""", "web-fetch" to "Reading developer.android.com"),
            Triple("read", """{"path":"C:\\repo\\skills\\design-notes\\SKILL.md"}""", "skill" to "Loading design-notes"),
            Triple("agent", """{"action":"run","name":"Layout reviewer"}""", "agent" to "Starting Layout reviewer"),
            Triple("workflow", """{"action":"run","name":"Release checks"}""", "workflow" to "Running Release checks"),
            Triple("browser_navigate", """{"url":"https://www.example.com"}""", "browser" to "Opening example.com"),
            Triple("computer_list_windows", "{}", "computer" to "Finding an app window"),
            Triple("custom_tool", "{}", "tool" to "Using custom tool")
        )
        for ((name,args,expected) in cases) { val action=project(name,args);assertEquals(name,expected.first,action.family);assertEquals(name,expected.second,action.title) }
        assertEquals("Getting available tools",project("tool_search").title)
    }
    @Test fun `tool discovery is plain across current and legacy loaders`() {
        for (name in listOf("tool_search", "zyra_tool_search", "browser_use", "mcp__zyra__tool_search")) {
            val action = project(name)
            assertTrue(action.isToolDiscovery)
            assertEquals("Getting available tools", action.title)
            assertEquals("Couldn't get available tools", project(name, result="""{"isError":true}""").title)
        }
        assertFalse(project("computer_click").isToolDiscovery)
        assertFalse(project("browser_act").isToolDiscovery)
        assertFalse(project("mcp__another_plugin__tool_search").isToolDiscovery)
    }
    @Test fun `versioned canonical categories resolve opaque tool aliases`() {
        val value=project("bridge_adapter", "{}", surface="""{"version":1,"kind":"web-fetch","url":"https://example.com/page","lifecycle":"failed"}""")
        assertEquals("web-fetch",value.family);assertEquals("Reading example.com",value.title);assertTrue(value.failed)
    }
    @Test fun `web evidence stays structured and only supports ordinary browser URLs`() {
        val value=project("web_search",result="""{"details":{"results":[{"title":"Android","url":"https://developer.android.com","snippet":"Native navigation"},{"title":"Bad","url":"javascript:alert(1)"},{"title":"Credentials","url":"https://name:password@example.com"}]}}""")
        assertEquals(1,value.web.size);assertEquals("Native navigation",value.web.single().snippet)
        assertFalse(WorkActions.safeWebUrl("file:///C:/private"));assertFalse(WorkActions.safeWebUrl("intent://example"))
    }
    @Test fun `agent details and computer operations preserve their actual intent`() {
        val agent=project("agent","""{"action":"run","name":"Reviewer"}""",output="""{"agentRunId":"run-1","label":"Review layout","goal":"Check accessibility","status":"running"}""")
        assertEquals("Starting Review layout",agent.title);assertEquals("Check accessibility",agent.run?.goal);assertEquals("run-1",agent.run?.id)
        assertEquals("Drawing strokes",project("computer_action","""{"steps":[{"type":"stroke"},{"type":"drag"}]}""").title)
        assertEquals("Getting available tools",project("browser_use").title)
    }
    @Test fun `managed command wrappers are removed while ordinary output is preserved`() {
        val body="Command completed\nCommand: npm test\n\nCurrent output:\n\n3 tests passed\nTo check again, use bash status."
        assertEquals("3 tests passed",WorkActions.stripCommandEnvelope(body,"npm test"))
        assertEquals("Command completed\nAn ordinary log",WorkActions.stripCommandEnvelope("Command completed\nAn ordinary log",""))
    }
    private fun event(sequence: Int, event: String) = JSONObject().put("sequence",sequence).put("occurredAt","2026-09-14T12:00:0"+sequence+"Z").put("event",JSONObject(event))
    @Test fun `live updates retain call arguments creation time and row position through canonical commit`() {
        var view=TimelineReducer.apply(SessionView(),event(1,"""{"type":"tool_execution_start","toolCallId":"one","toolName":"bash","args":{"command":"npm test"}}"""))
        view=TimelineReducer.apply(view,event(2,"""{"type":"tool_execution_start","toolCallId":"two","toolName":"read","args":{"path":"a.ts"}}"""))
        view=TimelineReducer.apply(view,event(3,"""{"type":"tool_execution_update","toolCallId":"one","partialResult":{"content":[{"type":"text","text":"2 passing"}]}}"""))
        assertEquals(listOf("tool:one","tool:two"),view.items.map {it.id});assertTrue(view.items.first().pending)
        view=TimelineReducer.apply(view,event(4,"""{"type":"tool_execution_end","toolCallId":"one","result":{"content":[{"type":"text","text":"3 passing"}]}}"""))
        view=TimelineReducer.apply(view,event(5,"""{"type":"message_end","message":{"role":"toolResult","toolCallId":"one","toolName":"bash","content":[{"type":"text","text":"3 passing"}]}}"""))
        val action=WorkActions.project(view.items.first())
        assertEquals("Running tests",action.title);assertEquals("3 passing",action.output);assertFalse(action.item.pending)
        assertEquals(4000L,action.completedAt!!-action.startedAt!!)
        val cached=TimelineReducer.decode(TimelineReducer.encode(view));assertEquals(action.title,WorkActions.project(cached.items.first()).title)
    }
    @Test fun `deferred assistant completion retains accumulated text and call identity without another row`() {
        val message=JSONObject().put("role","assistant").put("id","answer").put("content", "x".repeat(5000))
        var view=TimelineReducer.apply(SessionView(),JSONObject().put("sequence",1).put("event",JSONObject().put("type","message_start").put("message",message)))
        view=TimelineReducer.apply(view,event(2,"""{"type":"message_end","deferred":{"bodyId":"body"},"message":{"role":"assistant","id":"answer","content":[{"type":"text","text":"short preview"},{"type":"toolCall","id":"call","name":"write","arguments":{"path":"app.ts"}}]}}"""))
        assertEquals(1,view.items.size);assertEquals(5000,view.items.single().text.length);assertEquals(listOf("write"),view.items.single().toolNames)
    }
    @Test fun `large tool result uses its existing row instead of a second deferred output`() {
        val view=TimelineReducer.apply(SessionView(),event(1,"""{"type":"tool_execution_end","toolCallId":"one","toolName":"read","args":{"path":"app.ts"},"deferred":{"bodyId":"body"}}"""))
        assertEquals(1,view.items.size);assertEquals("Reading app.ts",WorkActions.project(view.items.single()).title)
    }
}
