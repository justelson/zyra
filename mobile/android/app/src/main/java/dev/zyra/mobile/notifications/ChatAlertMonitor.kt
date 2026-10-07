package dev.zyra.mobile.notifications

import dev.zyra.mobile.data.Chat
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collect

/** One observer survives the UI/background ownership handoff without announcing itself. */
class ChatAlertMonitor(
    scope: CoroutineScope,
    changes: Flow<Unit>,
    enabled: StateFlow<Boolean>,
    private val policy: ChatAlertPolicy,
    private val active: () -> Boolean,
    private val chats: suspend () -> List<Chat>,
    private val visibleKey: () -> String?,
    private val notify: (Chat, String) -> Unit,
    private val save: () -> Unit
) {
    init {
        val refresh = Channel<Unit>(Channel.CONFLATED)
        scope.launch { changes.collect { refresh.trySend(Unit) } }
        scope.launch { enabled.collect { refresh.trySend(Unit) } }
        scope.launch { while (isActive) { refresh.trySend(Unit); delay(30000) } }
        scope.launch {
            for (signal in refresh) {
                delay(250)
                if (!enabled.value || !active()) continue
                val snapshot = chats()
                if (!enabled.value || !active()) continue
                val revision = policy.revision
                for (chat in snapshot) policy.observe(chat, visibleKey())?.let { notify(chat, it) }
                if (policy.revision != revision) save()
            }
        }
    }
}
