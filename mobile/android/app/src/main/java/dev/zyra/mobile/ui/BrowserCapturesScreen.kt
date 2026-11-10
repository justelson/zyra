package dev.zyra.mobile.ui

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import dev.zyra.mobile.R
import dev.zyra.mobile.data.ConnectionState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

internal data class BrowserCapture(val id: String, val video: Boolean, val mime: String, val bytes: Long, val date: String) {
    val title get() = if (video) "Recording" else "Screenshot"
    val filename get() = "zyra-${if (video) "recording" else "screenshot"}.${if (!video) "png" else if (mime == "video/mp4") "mp4" else "webm"}"
}

@Composable fun BrowserCapturesScreen(state: MobileState, vm: MobileSession) {
    var machineId by remember { mutableStateOf(state.machine?.id ?: state.machines.firstOrNull()?.id) }
    val selected = state.machines.find { it.id == machineId } ?: state.machines.firstOrNull()
    var choosing by remember { mutableStateOf(false) }
    var revision by remember { mutableIntStateOf(0) }
    val connection = state.machineStatus[selected?.id]
    Column(Modifier.fillMaxSize()) {
        TextButton({ choosing = true }, Modifier.fillMaxWidth(), enabled = state.machines.size > 1) { Text(selected?.name ?: "No computer paired") }
        key(selected?.id) {
            var rows by remember { mutableStateOf<List<BrowserCapture>>(emptyList()) }
            var error by remember { mutableStateOf<String?>(null) }
            var busy by remember { mutableStateOf(false) }
            var total by remember { mutableIntStateOf(0) }
            var offset by remember { mutableIntStateOf(0) }
            var deleting by remember { mutableStateOf<BrowserCapture?>(null) }
            var attaching by remember { mutableStateOf<BrowserCapture?>(null) }
            var preview by remember { mutableStateOf<Pair<BrowserCapture, File>?>(null) }
            val scope = rememberCoroutineScope()
            val context = LocalContext.current
            val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
                val file = preview?.second
                if (uri != null && file != null) scope.launch {
                    try { withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { output -> file.inputStream().use { it.copyTo(output, 49152) } } ?: error("Choose another save location.") } }
                    catch (failure: Exception) { if (failure is CancellationException) throw failure; error = "Could not save this capture." }
                }
            }
            LaunchedEffect(selected?.id, connection, offset, revision) {
                val machine = selected?.id ?: return@LaunchedEffect
                if (connection != ConnectionState.Connected) { error = "Connect to this PC to view captures."; return@LaunchedEffect }
                busy = true; error = null
                try {
                    val page = vm.captureOperation(machine, "captures.list", JSONObject().put("offset", offset).put("limit", 12))
                    val entries = page.optJSONArray("captures")
                    val next = (0 until (entries?.length() ?: 0)).map { entries!!.getJSONObject(it).let { value -> BrowserCapture(value.getString("artifactId"), value.optString("kind") == "recording", value.optString("mimeType"), value.optLong("sizeBytes"), value.optString("createdAt")) } }
                    rows = (if (offset == 0) next else rows + next).distinctBy { it.id }; total = page.optInt("total")
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { error = failure.message ?: "Captures unavailable" }
                finally { busy = false }
            }
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Saved Browser captures", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                    IconButton({ offset = 0; revision++ }, enabled = !busy && connection == ConnectionState.Connected) { AppIcon(R.drawable.ic_refresh_cw, "Refresh captures") }
                } }
                error?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) } }
                if (!busy && rows.isEmpty() && error == null) item { Text("No saved screenshots or recordings.", style = MaterialTheme.typography.bodyMedium) }
                items(rows, key = { it.id }) { capture ->
                    BrowserCaptureRow(capture, busy, open = {
                            busy = true; error = null
                            scope.launch {
                                try { preview = capture to vm.loadCapture(selected!!.id, capture.id) }
                                catch (cancelled: CancellationException) { throw cancelled }
                                catch (failure: Exception) { error = failure.message ?: "Capture unavailable" }
                                finally { busy = false }
                            }
                        }, delete = { deleting = capture })
                }
                if (busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
                if (rows.size < total && !busy) item { TextButton({ offset = rows.size }) { Text("Load more") } }
            }
            deleting?.let { capture -> AlertDialog(onDismissRequest = { deleting = null }, title = { Text("Delete ${capture.title.lowercase()}?") }, text = { Text("This removes the saved capture from this PC.") }, confirmButton = {
                TextButton({ deleting = null; busy = true; scope.launch {
                    try { vm.captureOperation(selected!!.id, "captures.delete", JSONObject().put("artifactId", capture.id)); rows = rows.filterNot { it.id == capture.id }; offset = 0; revision++ }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { error = "Could not delete this capture." }
                    finally { busy = false }
                } }) { Text("Delete") }
            }, dismissButton = { TextButton({ deleting = null }) { Text("Cancel") } }) }
            attaching?.let { capture -> ZyraSheet("Choose a project", { attaching = null }) {
                val projects = state.machineProjects[selected?.id].orEmpty()
                if (projects.isEmpty()) Text("No shared projects available.", Modifier.padding(20.dp))
                projects.forEach { project -> ZyraSettingRow(R.drawable.ic_folder, project.substringAfterLast('/').substringAfterLast('\\'), click = {
                    vm.attachCapture(selected!!.id, capture.id, project); attaching = null
                }) }
            } }
            preview?.let { (capture, file) -> ZyraSheet(capture.title, { preview = null }) {
                Column(Modifier.fillMaxWidth().padding(16.dp)) {
                    if (capture.video) ChatMediaPlayer(file, true, capture.title) else LocalImage(file, "Screenshot", 1024, Modifier.fillMaxWidth().heightIn(max = 360.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                        TextButton({ save.launch(capture.filename) }) { Text("Save") }
                        TextButton({
                            try {
                                val uri = FileProvider.getUriForFile(context, context.packageName + ".sharedfiles", file, capture.filename)
                                context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData(ClipDescription(capture.title, arrayOf(capture.mime)), ClipData.Item(uri)))
                            } catch (_: Exception) { error = "Could not copy this capture. Try saving it instead." }
                        }) { Text("Copy") }
                        TextButton({
                            if (state.machine?.id == selected?.id && state.session.id.isNotBlank()) vm.attachCapture(selected!!.id, capture.id)
                            else attaching = capture
                            preview = null
                        }) { Text("Attach to chat") }
                    }
                }
            } }
        }
    }
    if (choosing) ZyraSheet("Choose a computer", { choosing = false }) { state.machines.forEach { machine -> ZyraSettingRow(R.drawable.ic_monitor, machine.name, click = { machineId = machine.id; choosing = false }) } }
}

@Composable internal fun BrowserCaptureRow(capture: BrowserCapture, busy: Boolean, open: () -> Unit, delete: () -> Unit) {
    ZyraSettingRow(if (capture.video) R.drawable.ic_play else R.drawable.ic_camera, capture.title,
        "${capture.date.take(16).replace('T', ' ')} · ${capture.bytes / 1024} KB", click = if (busy) null else open,
        trailing = { IconButton(delete, enabled = !busy) { AppIcon(R.drawable.ic_trash_2, "Delete ${capture.title.lowercase()}") } })
}
