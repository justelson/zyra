package dev.zyra.mobile.network

import dev.zyra.mobile.data.Machine
import dev.zyra.mobile.data.Pairing
import dev.zyra.mobile.data.RuntimeStatus
import dev.zyra.mobile.data.RuntimeConnection
import dev.zyra.mobile.data.RuntimePhase
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okio.ByteString
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class HostFailure(val code: String, message: String) : IOException(message)
class HostConnection(val machine: Machine) {
    @Volatile var capabilities: Set<String> = emptySet()
        private set
    private val http = PinnedClient.create(machine.fingerprint)
    private var socket: WebSocket? = null
    private val pending = ConcurrentHashMap<String, CompletableDeferred<JSONObject>>()
    private val events = Channel<JSONObject>(128)
    val incoming = events.receiveAsFlow()
    private val mutableRuntimeStatus = MutableStateFlow(RuntimeStatus.Unknown)
    val runtimeStatus = mutableRuntimeStatus.asStateFlow()
    private var ready = CompletableDeferred<JSONObject>()
    val closed = CompletableDeferred<Throwable>()
    private val attachments = SessionAttachments { method, params -> request(method, params) }
    suspend fun attachSession(params: JSONObject) = attachments.attach(params)
    suspend fun detachSession(session: String, stillUnwanted: () -> Boolean = { true }) = attachments.detach(session, stillUnwanted)

    suspend fun connect(): JSONObject {
        socket = http.newWebSocket(Request.Builder().url(machine.url.replaceFirst("https://", "wss://") + "/connect").build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(JSONObject().put("type", "hello").put("version", 1).put("deviceId", machine.deviceId).put("token", machine.token).toString())
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    require(text.toByteArray().size <= 256 * 1024) { "Host response exceeded the transfer limit." }
                    val value = JSONObject(text)
                    when (value.optString("type")) {
                        "hello.ok" -> {
                            if (value.optInt("version") != 1) throw HostFailure("UNSUPPORTED_PROTOCOL", "Update Zyra to connect.")
                            if (value.getString("hostId") != machine.id) throw HostFailure("HOST_IDENTITY_CHANGED", "The paired host identity changed.")
                            val advertised = value.optJSONArray("capabilities")
                            capabilities = (0 until (advertised?.length() ?: 0)).map { advertised!!.getString(it) }.toSet()
                            mutableRuntimeStatus.value = RuntimeStatus.fromHello(value)
                            ready.complete(value)
                        }
                        "host.runtime-status" -> {
                            mutableRuntimeStatus.value = RuntimeStatus.fromEvent(value)
                            if (!events.trySend(value).isSuccess) {
                                webSocket.close(1013, "Resynchronizing"); fail(HostFailure("EVENT_GAP", "Connection needs to resynchronize."))
                            }
                        }
                        "response" -> {
                            val request = pending.remove(value.optString("id"))
                            if (value.optBoolean("ok")) request?.complete(value.optJSONObject("result") ?: JSONObject())
                            else {
                                val e = value.optJSONObject("error") ?: JSONObject()
                                val failure = HostFailure(e.optString("code"), e.optString("message", "Request failed."))
                                request?.completeExceptionally(failure)
                                if (!ready.isCompleted) ready.completeExceptionally(failure)
                            }
                        }
                        else -> if (!events.trySend(value).isSuccess) {
                            webSocket.close(1013, "Resynchronizing"); fail(HostFailure("EVENT_GAP", "Connection needs to resynchronize."))
                        }
                    }
                } catch (error: Exception) { fail(error); webSocket.close(1002, "Invalid host response") }
            }
            override fun onMessage(webSocket: WebSocket, bytes: ByteString) { webSocket.close(1003, "Text frames required") }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { fail(t) }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                fail(HostFailure(if (code == 1008) "DEVICE_REVOKED" else "DISCONNECTED", reason.ifBlank { "Host disconnected." })); webSocket.close(code, reason)
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { fail(HostFailure("DISCONNECTED", reason.ifBlank { "Host disconnected." })) }
        })
        return withTimeout(20000) { ready.await() }
    }
    private fun fail(t: Throwable) {
        mutableRuntimeStatus.value = mutableRuntimeStatus.value.copy(connection = RuntimeConnection.Disconnected, phase = RuntimePhase.Failed)
        closed.complete(t)
        ready.completeExceptionally(t)
        pending.values.forEach { it.completeExceptionally(t) }; pending.clear()
        events.trySend(JSONObject().put("type", "disconnected").put("message", t.message ?: "Host disconnected."))
    }
    suspend fun request(method: String, params: JSONObject = JSONObject(), id: String = System.currentTimeMillis().toString() + ":" + UUID.randomUUID().toString(), timeoutMs: Long = 65000): JSONObject {
        val completion = CompletableDeferred<JSONObject>()
        check(pending.putIfAbsent(id, completion) == null) { "Request is already pending." }
        try {
            val frame = JSONObject().put("type", "request").put("id", id).put("method", method).put("params", params).toString()
            require(frame.toByteArray().size <= 256 * 1024) { "This request is too large. Transfer attachments separately." }
            if (socket?.send(frame) != true) throw HostFailure("DISCONNECTED", "Reconnect to the PC before sending.")
            return withTimeout(timeoutMs) { completion.await() }
        } finally { pending.remove(id, completion) }
    }
    fun close() {
        fail(HostFailure("DISCONNECTED", "Client detached."))
        socket?.close(1000, "Client detached"); socket = null
        pending.values.forEach { it.completeExceptionally(HostFailure("DISCONNECTED", "Client detached.")) }; pending.clear()
        events.close(); http.dispatcher.executorService.shutdown(); http.connectionPool.evictAll()
    }
    companion object {
        suspend fun pair(pairing: Pairing, deviceName: String, previous: Machine? = null): Machine = withContext(Dispatchers.IO) {
            val http = PinnedClient.create(pairing.fingerprint)
            try {
                val payload = JSONObject().put("secret", pairing.secret).put("name", deviceName)
                previous?.takeIf { it.id == pairing.hostId && it.fingerprint == pairing.fingerprint }?.let {
                    payload.put("previous", JSONObject().put("deviceId", it.deviceId).put("token", it.token))
                }
                val body = payload.toString().toRequestBody("application/json".toMediaType())
                http.newCall(Request.Builder().url(pairing.url + "/pair").post(body).build()).execute().use { response ->
                    val stream = response.body?.byteStream() ?: throw IOException("Host sent no response.")
                    val buffer = ByteArray(8193)
                    var count = 0
                    while (count < buffer.size) { val read = stream.read(buffer, count, buffer.size - count); if (read < 0) break; count += read }
                    val bytes = buffer.copyOf(count)
                    require(bytes.size <= 8192) { "Pairing response is too large." }
                    val value = JSONObject(String(bytes, Charsets.UTF_8))
                    check(response.isSuccessful) { value.optJSONObject("error")?.optString("message") ?: "Pairing failed." }
                    require(value.getString("hostId") == pairing.hostId) { "Host identity does not match the pairing code." }
                    Machine(pairing.hostId, value.getString("deviceId"), pairing.name, pairing.url, pairing.fingerprint, value.getString("token"))
                }
            } finally { http.dispatcher.executorService.shutdown(); http.connectionPool.evictAll() }
        }
    }
}
