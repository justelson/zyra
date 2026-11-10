package dev.zyra.mobile.network
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.Base64

class MediaDownloads(private val directory: File) {
    private val lock = Mutex()
    private fun limit(ref: JSONObject) = if (ref.optString("mimeType").let { it.startsWith("audio/") || it.startsWith("video/") }) 64L * 1024 * 1024 else 20L * 1024 * 1024
    private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun checksum(file: File): String { val hash = MessageDigest.getInstance("SHA-256"); file.inputStream().use { input -> val buffer = ByteArray(49152); while (true) { val count = input.read(buffer); if (count < 0) break; hash.update(buffer, 0, count) } }; return hash.digest().joinToString("") { "%02x".format(it) } }
    suspend fun cached(machine: String, ref: JSONObject): File? = withContext(Dispatchers.IO) {
        val sha = ref.optString("sha256"); val total = ref.optLong("bytes")
        if (!sha.matches(Regex("[a-f0-9]{64}")) || total !in 1..limit(ref)) return@withContext null
        File(directory, digest(machine.toByteArray()) + "-" + sha + ".image").takeIf { it.isFile && it.length() == total }
    }
    /** Promote the sender's already-owned bytes before its outbox removes them. */
    suspend fun seed(machine: String, ref: JSONObject, source: File): File = withContext(Dispatchers.IO) { lock.withLock {
        val total = ref.getLong("bytes"); val sha = ref.getString("sha256")
        require(total in 1..limit(ref) && sha.matches(Regex("[a-f0-9]{64}"))) { "Invalid image reference." }
        require(source.isFile && source.length() == total && checksum(source) == sha) { "The local image changed." }
        directory.mkdirs()
        val key = digest(machine.toByteArray()) + "-" + sha
        val target = File(directory, key + ".image"); val partial = File(directory, key + ".part")
        if (target.isFile && target.length() == total && checksum(target) == sha) return@withLock target
        if (target.exists()) target.delete()
        ensureSpace(total, partial)
        try {
            java.io.FileOutputStream(partial).use { output -> source.inputStream().use { it.copyTo(output, 49152) }; output.fd.sync() }
            require(partial.length() == total && checksum(partial) == sha) { "The local image changed." }
            check(partial.renameTo(target)) { "Could not cache this image." }
            target
        } catch (error: Exception) { partial.delete(); throw error }
    } }
    suspend fun forget(machine: String) = withContext(Dispatchers.IO) { lock.withLock {
        val prefix = digest(machine.toByteArray()) + "-"
        directory.listFiles()?.filter { it.name.startsWith(prefix) && it.name.matches(Regex("[a-f0-9]{64}-[a-f0-9]{64}\\.(image|part)")) }?.forEach { check(it.delete()) { "Could not clear downloaded images." } }
    } }
    suspend fun load(machine: String, session: String, ref: JSONObject, request: suspend (String, JSONObject) -> JSONObject, progress: (Long, Long) -> Unit): File = withContext(Dispatchers.IO) { lock.withLock {
        val total = ref.getLong("bytes"); val sha = ref.getString("sha256")
        require(total in 1..limit(ref) && sha.matches(Regex("[a-f0-9]{64}"))) { "Invalid image reference." }
        directory.mkdirs(); val key = digest(machine.toByteArray()) + "-" + sha; val target = File(directory, key + ".image"); val partial = File(directory, key + ".part")
        if (target.exists()) {
            if (target.length() == total && checksum(target) == sha) { target.setLastModified(System.currentTimeMillis()); return@withLock target }
            target.delete()
        }
        ensureSpace(total, partial)
        RandomAccessFile(partial, "rw").use { output ->
            if (output.length() > total) output.setLength(0)
            var offset = output.length(); progress(offset, total)
            while (offset < total) {
                currentCoroutineContext().ensureActive()
                val method = when (ref.optJSONObject("source")?.optString("kind")) { "capture" -> "captures.chunk"; "workspace-media" -> "workspace.media.chunk"; "workspace" -> "workspace.image.chunk"; else -> "media.chunk" }
                val chunk = request(method, JSONObject().put("session", session).put("ref", ref).put("offset", offset))
                currentCoroutineContext().ensureActive()
                val bytes = Base64.getDecoder().decode(chunk.getString("base64")); val next = chunk.getLong("next")
                require(chunk.getLong("total") == total && chunk.getString("sha256") == sha && next > offset && next <= total && next - offset == bytes.size.toLong() && bytes.size <= 49152) { "Image transfer was interrupted." }
                output.seek(offset); output.write(bytes); output.fd.sync(); offset = next; progress(offset, total)
            }
        }
        if (checksum(partial) != sha) { partial.delete(); error("Image checksum did not match. Please retry.") }
        check(partial.renameTo(target)) { "Could not save this image." }; target
    } }
    private fun ensureSpace(total: Long, partial: File) {
        val files = directory.listFiles()?.filter { it.isFile && it.name.matches(Regex("([a-f0-9]{64}-)?[a-f0-9]{64}\\.(image|part)")) }?.sortedBy { it.lastModified() }.orEmpty()
        var reserved = files.sumOf { it.length() } + total - partial.length(); var count = files.size
        for (file in files) { if (reserved <= 128L * 1024 * 1024 && count < 128) break; if (file != partial) { val size = file.length(); if (file.delete()) { reserved -= size; count-- } } }
        // Recompute after eviction because deleted file lengths are no longer available.
        require(directory.listFiles().orEmpty().sumOf { it.length() } + total - partial.length() <= 128L * 1024 * 1024) { "Media cache is full." }
        require(directory.usableSpace >= total + 32L * 1024 * 1024) { "Your phone needs more free storage." }
    }

}
