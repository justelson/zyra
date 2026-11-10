package dev.zyra.mobile.network

import dev.zyra.mobile.data.ConnectionState
import dev.zyra.mobile.data.Machine
import dev.zyra.mobile.data.ConnectionFailure
import dev.zyra.mobile.data.connectionFailure
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.json.JSONObject

data class MachineLink(val connection: HostConnection? = null, val status: ConnectionState = ConnectionState.Offline, val projects: List<String> = emptyList(), val failure: ConnectionFailure? = null)

/** One authenticated connection per paired PC. Switching the visible chat never
 * re-pairs or tears down the catalogs of the other computers. */
class MachineConnections(private val scope: CoroutineScope, private val event: (Machine, HostConnection, JSONObject) -> Unit) {
    private val mutable = MutableStateFlow<Map<String, MachineLink>>(emptyMap())
    val links = mutable.asStateFlow()
    private val jobs = mutableMapOf<String, Job>()
    private val machines = mutableMapOf<String, Machine>()
    private val sockets = mutableMapOf<String, HostConnection>()
    private val handshakes = Semaphore(2)
    private var foreground = true
    private var pauseJob: Job? = null
    private var retained: String? = null
    fun retry(id: String) {
        if (id !in machines) return
        jobs.remove(id)?.cancel(); sockets.remove(id)?.close()
        mutable.update { it + (id to MachineLink(status = ConnectionState.Connecting)) }
        configure(machines.values.toList())
    }
    fun keepConnected(machineId: String?) {
        retained = machineId
        if (!foreground) { pauseUnused(); configure(machines.values.toList()) }
    }
    private fun pauseUnused() {
        jobs.keys.toList().filter { it != retained }.forEach { id ->
            jobs.remove(id)?.cancel(); sockets.remove(id)?.close()
            mutable.update { links -> links[id]?.let { links + (id to it.copy(connection = null, status = ConnectionState.Offline)) } ?: links }
        }
    }
    fun foreground(active: Boolean) {
        pauseJob?.cancel()
        if (active) {
            foreground = true
            configure(machines.values.toList())
        } else pauseJob = scope.launch {
            // Keep rotations and short camera/file-picker visits seamless.
            delay(15000)
            foreground = false
            pauseUnused()
        }
    }
    fun configure(values: List<Machine>) {
        val wanted = values.associateBy { it.id }
        machines.keys.toList().filter { wanted[it] != machines[it] }.forEach { id ->
            jobs.remove(id)?.cancel(); sockets.remove(id)?.close(); machines.remove(id)
            mutable.update { it - id }
        }
        values.forEach { machines[it.id] = it }
        values.filter { it.id !in jobs && (foreground || it.id == retained) }.forEach { machine ->
            machines[machine.id] = machine
            jobs[machine.id] = scope.launch {
                var attempt = 0
                while (isActive) {
                    var opened: HostConnection? = null
                    mutable.update { it + (machine.id to MachineLink(status = if (attempt == 0) ConnectionState.Connecting else ConnectionState.Reconnecting, failure = it[machine.id]?.failure)) }
                    try {
                        val connection = HostConnection(machine); opened = connection; sockets[machine.id] = connection
                        val hello = handshakes.withPermit { connection.connect() }
                        ensureActive()
                        val projects = hello.optJSONArray("projects")
                        mutable.update { it + (machine.id to MachineLink(connection, ConnectionState.Connected, (0 until (projects?.length() ?: 0)).map { i -> projects!!.getString(i) })) }
                        attempt = 0
                        coroutineScope {
                            val incoming = launch { connection.incoming.collect { event(machine, connection, it) } }
                            try { throw connection.closed.await() } finally { incoming.cancel() }
                        }
                    } catch (e: CancellationException) { throw e }
                    catch (e: Exception) {
                        val failure = connectionFailure(e, (e as? HostFailure)?.code)
                        mutable.update { it + (machine.id to MachineLink(status = if (failure.retryAutomatically) ConnectionState.Reconnecting else ConnectionState.Offline, failure = failure)) }
                        if (!failure.retryAutomatically) break
                    } finally { opened?.close(); if (sockets[machine.id] === opened) sockets.remove(machine.id) }
                    delay((1000L shl attempt.coerceAtMost(5)).coerceAtMost(30000) + (0..500).random()); attempt++
                }
            }
        }
    }
    fun close() { pauseJob?.cancel(); jobs.values.forEach { it.cancel() }; sockets.values.toList().forEach { it.close() }; jobs.clear(); sockets.clear(); machines.clear(); mutable.value = emptyMap() }
}
