package dev.zyra.mobile.ui
import android.app.Application
import android.net.Uri
import dev.zyra.mobile.network.MediaDownloads
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class MediaPreview(val ref: String, val loading: Boolean = true, val progress: Int = 0, val file: File? = null, val error: String? = null, val saved: Boolean = false)
class MediaController(private val app: Application, private val scope: CoroutineScope) {
    private val downloads = MediaDownloads(File(app.cacheDir, "media"))
    private val mutable = MutableStateFlow<MediaPreview?>(null)
    val state = mutable.asStateFlow()
    private val revision = MutableStateFlow(0)
    val cacheRevision = revision.asStateFlow()
    suspend fun seedAttachments(machine: String, session: String, store: dev.zyra.mobile.data.AttachmentStore, ids: List<String>) {
        var changed = false
        val images = withContext(Dispatchers.IO) { store.list(machine, session).filter { it.id in ids && it.mimeType.startsWith("image/") } }
        for (image in images) {
            try {
                downloads.seed(machine, JSONObject().put("sha256", image.sha256).put("bytes", image.size), store.file(image.id))
                changed = true
            } catch (error: Exception) { if (error is CancellationException) throw error /* A preview-cache miss must not block sending the original. */ }
        }
        if (changed) revision.value++
    }
    suspend fun cached(machine: String, ref: JSONObject) = downloads.cached(machine, ref)
    suspend fun playback(machine: String, session: String, ref: JSONObject, request: suspend (String, JSONObject) -> JSONObject, progress: (Long, Long) -> Unit): File =
        downloads.load(machine, session, ref, request, progress)
    suspend fun inline(machine: String, session: String, ref: JSONObject, request: suspend (String, JSONObject) -> JSONObject): File? {
        val cached = downloads.cached(machine, ref)
        return if (cached != null || ref.optLong("bytes") <= 512 * 1024) downloads.load(machine, session, ref, request) { _, _ -> } else null
    }
    /** Called only while an attachment tile is in or near the viewport. */
    suspend fun visibleThumbnail(machine: String, session: String, ref: JSONObject, request: suspend (String, JSONObject) -> JSONObject): File =
        downloads.load(machine, session, ref, request) { _, _ -> }
    private var job: Job? = null
    suspend fun forget(machine: String) { close(); job?.join(); downloads.forget(machine) }
    fun close() { job?.cancel(); mutable.value = null }
    fun open(machine: String, session: String, ref: JSONObject, request: suspend (String, JSONObject) -> JSONObject) {
        close(); val key = ref.toString(); mutable.value = MediaPreview(key)
        job = scope.launch {
            try {
                val file = downloads.load(machine, session, ref, request) { offset, total -> mutable.update { if (it?.ref == key) it.copy(progress = (offset * 100 / total).toInt()) else it } }
                mutable.update { if (it?.ref == key) it.copy(loading = false, file = file) else it }; revision.value++
            } catch (error: Exception) { if (error is CancellationException) throw error; mutable.update { if (it?.ref == key) it.copy(loading = false, error = error.message) else it } }
        }
    }
    fun save(uri: Uri) {
        val selected = mutable.value ?: return; val file = selected.file ?: return
        scope.launch {
            try { withContext(Dispatchers.IO) { app.contentResolver.openOutputStream(uri)?.use { output -> file.inputStream().use { it.copyTo(output, 49152) } } ?: error("Could not open the selected destination.") }; mutable.update { if (it?.ref == selected.ref) it.copy(saved = true) else it } }
            catch (error: Exception) { if (error is CancellationException) throw error; mutable.update { if (it?.ref == selected.ref) it.copy(error = error.message) else it } }
        }
    }
    companion object {
        fun images(raw: String): List<JSONObject> {
            val result = mutableListOf<JSONObject>()
            fun visit(value: Any?, depth: Int) {
                if (depth > 16 || result.size >= 24) return
                when (value) {
                    is JSONObject -> { if (value.optString("type") == "image") { result.add(value); return }; val keys = value.keys(); while (keys.hasNext()) visit(value.opt(keys.next()), depth + 1) }
                    is JSONArray -> for (i in 0 until value.length()) visit(value.opt(i), depth + 1)
                }
            }
            runCatching { visit(JSONObject(raw), 0) }; return result.distinctBy { it.optJSONObject("mediaRef")?.optString("sha256") ?: it.toString() }
        }
    }
}
