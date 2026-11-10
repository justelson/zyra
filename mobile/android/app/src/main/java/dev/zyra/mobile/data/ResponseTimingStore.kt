package dev.zyra.mobile.data

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/** Always-on bounded local evidence. Sharing is owned by the caller's consent gate. */
class ResponseTimingStore(directory: File, private val scope: CoroutineScope, private val share: suspend (String, JSONObject) -> Unit,
    private val now: () -> Long = { System.nanoTime() / 1_000_000 }) {
    private val file = File(directory, "response-timings.json")
    private val writes = Mutex()
    private val ready = CompletableDeferred<Unit>()
    private var saveJob: Job? = null
    private var lastSaved = 0L
    private var lastRevision = 0L
    private val mutableRevision = MutableStateFlow(0L)
    val revision = mutableRevision.asStateFlow()
    val recorder: ResponseTimings = ResponseTimings(now, changed = ::changed, settled = { id -> scope.launch {
        delay(1500)
        recorder.summary(id)?.let { summary -> try { share(id, summary) } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) {} }
    } })
    init {
        scope.launch {
            val rows = withContext(Dispatchers.IO) {
                runCatching {
                    if (!file.isFile || file.length() > MAX_BYTES) return@runCatching JSONArray()
                    val bytes = ByteArrayOutputStream()
                    file.inputStream().use { input ->
                        val buffer = ByteArray(8192)
                        while (bytes.size() <= MAX_BYTES) { val count = input.read(buffer, 0, minOf(buffer.size, MAX_BYTES + 1 - bytes.size())); if (count < 0) break; if (count > 0) bytes.write(buffer, 0, count) }
                    }
                    check(bytes.size() <= MAX_BYTES)
                    JSONArray(bytes.toString("UTF-8"))
                }.getOrDefault(JSONArray())
            }
            runCatching { recorder.restore(rows) }; mutableRevision.value++; ready.complete(Unit)
        }
    }
    private fun changed(urgent: Boolean) {
        if (urgent || now() - lastRevision >= 1000) { mutableRevision.value++; lastRevision = now() }
        if (!urgent && saveJob?.isActive == true) return
        saveJob?.cancel()
        saveJob = scope.launch {
            delay(if (urgent) 200 else maxOf(1000, 10000 - (now() - lastSaved)))
            flush()
        }
    }
    suspend fun flush() {
        ready.await()
        val bytes = recorder.read().toString().toByteArray(Charsets.UTF_8)
        if (bytes.size > MAX_BYTES) return
        withContext(Dispatchers.IO) { writes.withLock {
            val temporary = File(file.parentFile, "response-timings.next")
            try {
                check(file.parentFile!!.mkdirs() || file.parentFile!!.isDirectory)
                FileOutputStream(temporary).use { output -> output.write(bytes); output.fd.sync() }
                Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
                lastSaved = now()
            } catch (_: Exception) { temporary.delete() }
        } }
    }
    companion object { const val MAX_BYTES = 2 * 1024 * 1024 }
}
