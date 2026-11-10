package dev.zyra.mobile.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.zyra.mobile.R
import org.json.JSONObject

@Composable fun ResponseTimingsScreen(vm: MobileSession) {
    val revision by vm.responseTimings.revision.collectAsStateWithLifecycle()
    val sharing by vm.preferences.shareTimings.collectAsStateWithLifecycle()
    val rows = remember(revision) { vm.responseTimings.recorder.read().let { values -> (0 until values.length()).map { values.getJSONObject(it) } } }
    val clipboard = LocalClipboardManager.current
    ResponseTimingsContent(rows, sharing, vm.preferences::shareTimings) { clipboard.setText(AnnotatedString(it)) }
}

@Composable internal fun ResponseTimingsContent(rows: List<JSONObject>, sharing: Boolean, share: (Boolean) -> Unit, copy: (String) -> Unit) {
    var history by remember { mutableStateOf(false) }
    var slowest by remember { mutableStateOf(false) }
    val historyRows = if (slowest) rows.sortedByDescending { (it.opt("firstTextReceivedMs") as? Number)?.toLong() ?: -1L } else rows
    fun time(value: Long?) = value?.let { "%.2f s".format(it / 1000.0) } ?: "Not observed"
    fun median(key: String): Long? = rows.filter { it.optString("outcome") == "completed" }.take(20).mapNotNull { (it.opt(key) as? Number)?.toLong() }.sorted().let { if (it.isEmpty()) null else if (it.size % 2 == 1) it[it.size / 2] else (it[it.size / 2 - 1] + it[it.size / 2]) / 2 }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { Text("Response timings", style = MaterialTheme.typography.titleLarge) }
        item { ZyraSettingRow(R.drawable.ic_info, "Local diagnostics", "Always on · up to 200 turns · 2 MB") }
        item { ZyraSettingRow(title = "First text received", subtitle = time(median("firstTextReceivedMs"))) }
        item { ZyraSettingRow(title = "First text visible", subtitle = time(median("firstDisplayMs"))) }
        item { ZyraSettingRow(title = "Share timing summaries", subtitle = "Optional · also follows this PC's analytics consent", trailing = { ZyraSwitch(sharing, share) }) }
        item { ZyraSettingRow(R.drawable.ic_terminal, "Turn history", "${rows.size} recorded", click = { history = !history }) }
        if (history) item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton({ slowest = !slowest }) { Text(if (slowest) "Slowest first" else "Newest first") }
        } }
        if (history) items(historyRows, key = { it.optString("turnId") }) { row ->
            var details by remember(row.optString("turnId")) { mutableStateOf(false) }
            ZyraSettingRow(title = row.optString("model"), subtitle = "${row.optString("outcome")} · ${time((row.opt("firstTextReceivedMs") as? Number)?.toLong())}", click = { details = true })
            if (details) ZyraSheet("Turn timings", { details = false }) {
                for ((key, label) in listOf("dispatchMs" to "Dispatched", "acceptedMs" to "Accepted", "firstEventMs" to "Provider first event", "firstTextMs" to "Provider first text", "firstTextReceivedMs" to "Text received", "firstDisplayMs" to "Text visible", "completedMs" to "Completed"))
                    ZyraSettingRow(title = label, subtitle = time((row.opt(key) as? Number)?.toLong()))
                Text("Provider stages start at PC acceptance. Receipt and display start at your phone's submission.", Modifier.padding(20.dp), style = MaterialTheme.typography.bodySmall)
                TextButton({ copy(row.toString(2)) }) { Text("Copy timings") }
            }
        }
        item { TextButton({ copy(org.json.JSONArray(rows).toString(2)) }) { Text("Copy timings") } }
    }
}
