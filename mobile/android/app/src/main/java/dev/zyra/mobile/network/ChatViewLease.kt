package dev.zyra.mobile.network

import kotlinx.coroutines.*
import org.json.JSONObject

/** A mounted foreground chat renews the server lease; background attachments do not. */
class ChatViewLease(private val scope: CoroutineScope) {
    private var target: Pair<HostConnection, String>? = null
    private var renewal: Job? = null
    suspend fun update(connection: HostConnection?, session: String?) {
        val next = if (connection != null && !session.isNullOrBlank()) connection to session else null
        if (target == next) return
        renewal?.cancelAndJoin()
        target?.let { report(it, false) }
        target = next
        renewal = next?.let { view -> scope.launch {
            while (isActive) { report(view, true); delay(10000) }
        } }
    }
    private suspend fun report(view: Pair<HostConnection, String>, viewing: Boolean) {
        try {
            withTimeout(3000) { view.first.request("session.view", JSONObject().put("session", view.second).put("viewing", viewing)) }
        } catch (e: CancellationException) { if (e !is TimeoutCancellationException) throw e }
        catch (_: Exception) { /* Older/offline hosts expire the lease rather than keeping false visibility. */ }
    }
}
