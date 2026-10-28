package dev.zyra.mobile.data

import org.json.JSONObject
import java.net.URI
import java.time.Instant

// The same action families and intent labels as Desktop assistant-action-presentation.ts.
data class WorkWebResult(val title: String, val url: String, val snippet: String, val site: String)
data class WorkRun(val name: String = "", val goal: String = "", val status: String = "", val id: String = "")
data class WorkAction(val item: TimelineItem, val title: String, val family: String, val target: String,
    val command: String, val output: String, val failed: Boolean, val batch: String?,
    val web: List<WorkWebResult> = emptyList(), val run: WorkRun? = null, val paths: List<String> = emptyList(),
    val startedAt: Long? = null, val completedAt: Long? = null, val toolName: String = "", val arguments: String = "{}") {
    val isToolDiscovery: Boolean get() = WorkActions.isToolDiscovery(toolName)
}

object WorkActions {
    fun isToolDiscovery(name: String): Boolean = Regex("^(?:mcp__zyra__|functions\\.)?(?:tool_search|zyra_tool_search|browser_use)$", RegexOption.IGNORE_CASE).matches(name)
    private fun JSONObject?.text(vararg keys: String): String = keys.firstNotNullOfOrNull { key ->
        (this?.opt(key) as? String)?.trim()?.takeIf { it.isNotEmpty() }
    }.orEmpty()
    fun time(value: Any?): Long? = when (value) {
        is Number -> value.toLong().takeIf { it > 0 }
        is String -> value.toLongOrNull()?.takeIf { it > 0 } ?: runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
        else -> null
    }
    fun timestamp(raw: JSONObject, updated: Boolean = false): Long? =
        time(raw.opt(if (updated) "_mobileUpdatedAt" else "_mobileCreatedAt"))
            ?: time(raw.optJSONObject("message")?.opt("timestamp")) ?: time(raw.opt("timestamp"))
    private fun paths(vararg sources: JSONObject?): List<String> = buildList {
        for (source in sources) {
            source.text("path", "filePath", "file_path", "targetPath", "target_path", "filename").takeIf { it.isNotEmpty() }?.let(::add)
            for (key in listOf("paths", "files")) source?.optJSONArray(key)?.let { array ->
                for (i in 0 until minOf(array.length(), 64)) (array.opt(i) as? String)?.trim()?.takeIf { it.isNotEmpty() }?.let(::add)
            }
            source?.optJSONArray("changes")?.let { array -> for (i in 0 until minOf(array.length(), 64)) {
                array.optJSONObject(i).text("path", "filePath", "file_path").takeIf { it.isNotEmpty() }?.let(::add)
            } }
        }
    }.distinct().take(64)
    private fun brief(value: String, max: Int = 52): String {
        val clean = value.replace(Regex("\\s+"), " ").trim()
        if (clean.length <= max) return clean
        return clean.take(max - 1).substringBeforeLast(' ', clean.take(max - 1)) + "…"
    }
    private fun host(url: String): String = runCatching { URI(url).host.orEmpty().removePrefix("www.") }.getOrDefault("")
    fun safeWebUrl(url: String): Boolean = runCatching { val uri = URI(url); uri.scheme in setOf("https", "http") && !uri.host.isNullOrBlank() && uri.userInfo == null }.getOrDefault(false)
    fun project(item: TimelineItem, call: Pair<String, JSONObject>? = null, batch: String? = null): WorkAction {
        val raw = runCatching { JSONObject(item.raw) }.getOrDefault(JSONObject())
        val message = raw.optJSONObject("message") ?: raw
        val surface = raw.optJSONObject("surface")?.takeIf { it.optInt("version") == 1 }
        val args = call?.second ?: raw.optJSONObject("args") ?: JSONObject()
        val result = raw.optJSONObject("result") ?: raw.optJSONObject("partialResult") ?: message
        val details = result.optJSONObject("details")
        val name = call?.first ?: raw.text("toolName").ifBlank { message.text("toolName").ifBlank { surface.text("toolName").ifBlank { item.text.substringBefore('\n') } } }
        val tool = name.lowercase().replace(Regex("[^a-z0-9]"), "")
        val paths = paths(args, details, result, surface)
        val path = paths.firstOrNull().orEmpty()
        val command = args.text("command", "cmd", "script").ifBlank { surface.text("command") }
        val query = args.text("query", "q", "pattern", "search").ifBlank { surface.text("query").ifBlank { details.text("query") } }
        val url = args.text("url", "href").ifBlank { surface.text("url").ifBlank { details.text("url") } }
        val operation = args.text("operation", "action").ifBlank { surface.text("action") }
        val skill = paths.firstOrNull { Regex("(?:^|[/\\\\])skills[/\\\\][^/\\\\]+[/\\\\]skill\\.md$", RegexOption.IGNORE_CASE).containsMatchIn(it) }
        val kind = surface.text("kind")
        val family = when {
            kind == "web-search" || tool == "websearch" -> "web-search"
            kind == "web-fetch" || tool == "webfetch" -> "web-fetch"
            kind == "skill" || skill != null -> "skill"
            kind == "agent" || tool == "agent" || tool.contains("spawnagent") || tool.contains("waitagent") || tool.contains("resumeagent") || tool.contains("closeagent") || tool.contains("sendinput") || tool == "wait" -> "agent"
            kind == "workflow" || tool == "workflow" -> "workflow"
            kind == "browser-control" || tool.startsWith("browser") -> "browser"
            kind == "computer-control" || tool.startsWith("computer") -> "computer"
            kind == "command" || command.isNotEmpty() || tool in setOf("bash", "shell", "powershell", "terminal", "exec", "execcommand", "command", "cmd") -> "command"
            kind == "file-change" || tool in setOf("edit", "write", "applypatch", "editfile", "writefile", "replace", "append", "delete", "move", "rename") -> "edit"
            kind == "file-read" || paths.isNotEmpty() || tool in setOf("read", "readfile", "open", "cat", "view", "inspect") -> "read"
            kind == "search" || query.isNotBlank() || tool.contains("search") || tool in setOf("grep", "find", "glob", "rg") -> "search"
            else -> "tool"
        }
        val output = item.text.substringAfter('\n', "")
        val outputRun = if (family == "agent" || family == "workflow") runCatching { JSONObject(output) }.getOrNull() else null
        val run = if (family == "agent" || family == "workflow") WorkRun(
            outputRun.text("label", "definitionName").ifBlank { args.text("label", "name", "agent") },
            outputRun.text("goal").ifBlank { args.text("prompt", "message", "input") },
            outputRun.text("status").ifBlank { details.text("status") },
            outputRun.text("agentRunId", "workflowRunId").ifBlank { args.text("agentRunId", "workflowRunId") }) else null
        val title = when {
            isToolDiscovery(name) -> "Getting available tools"
            family == "command" -> commandTitle(command)
            family == "read" -> "Reading " + fileName(path).ifBlank { "file" }
            family == "edit" -> if (path.isBlank()) "Editing files" else "Editing " + fileName(path) + if (paths.size > 1) " +" + (paths.size - 1) else ""
            family == "skill" -> "Loading " + (skill?.replace('\\', '/')?.substringBeforeLast('/')?.substringAfterLast('/') ?: fileName(path).ifBlank { "skill" })
            family == "web-search" -> "Searching " + brief(query).ifBlank { "the web" }
            family == "web-fetch" -> "Reading " + brief(details.text("title")).ifBlank { host(url).ifBlank { "web page" } }
            family == "search" -> "Searching " + brief(query).ifBlank { "the project" }
            family == "browser" -> args.optJSONObject("stage").text("summary").let { brief(it).ifBlank {
                operationIntent(args.optJSONObject("action").text("type").ifBlank { operation.ifBlank { name.removePrefix("browser_") } }, host(url), true)
            } }
            family == "computer" -> computerTitle(args, operation.ifBlank { name.removePrefix("computer_") })
            family == "agent" || family == "workflow" -> agentTitle(operation.ifBlank { tool.removePrefix("agent") }, family, run?.name.orEmpty())
            else -> surface.text("summary").ifBlank { "Using " + name.replace('_', ' ').ifBlank { "tool" } }.let { brief(it, 88) }
        }
        val target = when(family) { "command" -> ""; "read", "edit", "skill" -> path; "search", "web-search" -> query; "browser", "web-fetch" -> host(url); "agent", "workflow" -> run?.name.orEmpty(); else -> operation }
        val failed = message.optBoolean("isError") || raw.optBoolean("isError") || result.optBoolean("isError") || surface.text("lifecycle") == "failed" || details.text("status") in setOf("failed", "error")
        val web = if (family in setOf("web-search", "web-fetch", "browser")) webResults(details, url) else emptyList()
        val intent = raw.text("actionBatchIntent").ifBlank { raw.optJSONObject("payload").text("actionBatchIntent") }.ifBlank { surface.text("actionBatchIntent") }
            .ifBlank { message.text("actionBatchIntent") }.ifBlank { details.text("actionBatchIntent") }.ifBlank { batch.orEmpty() }
            .replace(Regex("[\\u0000-\\u001f\\u007f]"), " ").replace(Regex("\\s+"), " ").trim().take(72).takeIf(String::isNotBlank)
        val displayTitle = if (isToolDiscovery(name) && failed) "Couldn't get available tools" else title
        return WorkAction(item, displayTitle, family, target, command, if (family == "command") stripCommandEnvelope(output, command) else output, failed, intent,
            web, run, paths, timestamp(raw), timestamp(raw, true).takeUnless { item.pending }, name, args.toString())
    }
    private fun webResults(details: JSONObject?, url: String): List<WorkWebResult> {
        val entries = details?.optJSONArray("results")
        val results = buildList {
            for (i in 0 until minOf(entries?.length() ?: 0, 16)) {
                val entry = entries?.optJSONObject(i); val link = entry.text("url"); val title = entry.text("title")
                if (title.isNotBlank() && safeWebUrl(link)) add(WorkWebResult(title.take(256), link, entry.text("snippet").take(1600), host(link)))
            }
        }
        return results.ifEmpty { if (safeWebUrl(url)) listOf(WorkWebResult(details.text("title").ifBlank { host(url) }, url, details.text("text").take(1600), host(url))) else emptyList() }
    }
    private fun fileName(path: String) = path.replace('\\', '/').substringAfterLast('/')
    private fun operationIntent(value: String, target: String, browser: Boolean): String {
        val operation = value.lowercase().replace(Regex("[._-]+"), " ")
        val suffix = if (target.isNotBlank()) " " + brief(target, 36) else if (browser) " web page" else ""
        return when {
            Regex("navigate|open").containsMatchIn(operation) -> "Opening" + suffix.ifBlank { " app" }
            Regex("observe|inspect|snapshot").containsMatchIn(operation) -> "Inspecting" + suffix.ifBlank { " app" }
            Regex("click|press").containsMatchIn(operation) -> "Clicking" + suffix
            Regex("type|input|fill").containsMatchIn(operation) -> "Typing" + suffix
            operation.contains("scroll") -> "Scrolling" + suffix
            operation.contains("focus") -> "Focusing" + suffix
            operation.contains("drag") -> "Dragging" + suffix
            operation.contains("wait") -> "Waiting" + if (target.isNotEmpty()) " for " + target else ""
            Regex("release|close|stop").containsMatchIn(operation) -> if (browser) "Closing browser control" else "Releasing computer control"
            else -> if (browser) "Using browser" else "Running computer control"
        }
    }
    private fun computerTitle(args: JSONObject, operation: String): String {
        val target = brief(args.text("application", "name", "targetId"), 36)
        val steps = args.optJSONArray("steps")
        if (steps != null && steps.length() > 0) {
            val types = (0 until steps.length()).map { steps.optJSONObject(it).text("type") }
            if (types.all { it == "drag" }) return "Dragging"
            if (types.all { it in setOf("stroke", "drag") }) return "Drawing strokes"
            return "Performing " + steps.length() + " computer " + if (steps.length() == 1) "step" else "steps"
        }
        return when(operation) { "list_windows" -> "Finding an app window"; "request_access", "request_grant" -> "Requesting app access"; "use_app" -> "Using " + target.ifBlank { "an app" }; else -> operationIntent(operation, target, false) }
    }
    private fun agentTitle(operation: String, family: String, label: String): String {
        val target = brief(label, 36)
        return when {
            Regex("spawn|start|run").containsMatchIn(operation) -> (if (family == "agent") "Starting " else "Running ") + target.ifBlank { family }
            operation.contains("wait") -> "Waiting for " + family
            Regex("send|steer|input").containsMatchIn(operation) -> "Steering " + family
            operation.contains("resume") -> "Resuming " + family
            Regex("stop|close").containsMatchIn(operation) -> "Stopping " + family
            else -> "Checking " + family
        }
    }
    private fun commandTitle(command: String): String {
        fun has(pattern: String) = Regex(pattern, RegexOption.IGNORE_CASE).containsMatchIn(command)
        return when {
            has("^\\s*(rg|grep|findstr)\\b") -> "Searching code"
            has("^\\s*git\\s+(status|diff)\\b") -> "Checking changes"
            has("^\\s*git\\s+(log|show)\\b") -> "Reading Git history"
            has("\\bnode\\s+--check\\b|\\bsyntax\\b") -> "Checking syntax"
            has("\\b(typecheck|tsc)\\b") -> "Checking types"
            has("\\b(test|tests|vitest|jest|playwright)\\b") -> "Running tests"
            has("\\b(build|compile)\\b|\\bnpm\\s+pack\\b") -> "Building project"
            else -> "Running command"
        }
    }
    fun stripCommandEnvelope(output: String, command: String): String {
        val text = output.replace(Regex("^\\[Zyra managed command update]\\s*\\r?\\n", RegexOption.IGNORE_CASE), "")
        val lines = text.lines().toMutableList()
        if (!Regex("^Command (completed|failed|still running|exited|timed out)\\b", RegexOption.IGNORE_CASE).containsMatchIn(lines.firstOrNull().orEmpty()) ||
            !Regex("^(Last output:|Command:)", RegexOption.IGNORE_CASE).containsMatchIn(lines.getOrNull(1).orEmpty())) return text
        lines.removeAt(0)
        if (lines.firstOrNull()?.startsWith("Last output:", true) == true) lines.removeAt(0)
        if (lines.firstOrNull()?.startsWith("Command:", true) == true) {
            val wrapped = lines.removeAt(0).substringAfter(':').trim()
            if (command.isBlank() || wrapped == command.trim()) while (lines.firstOrNull() == "") lines.removeAt(0)
        }
        if (lines.firstOrNull()?.trim()?.equals("Current output:", true) == true) lines.removeAt(0)
        val footer = lines.indexOfFirst { it.startsWith("To check again,", true) || it.startsWith("Use this command output to decide", true) }
        return (if (footer >= 0) lines.take(footer) else lines).joinToString("\n").trim()
    }
}


