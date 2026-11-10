package dev.zyra.mobile.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.zyra.mobile.R
import dev.zyra.mobile.data.ConnectionState
import dev.zyra.mobile.data.ConnectionRecovery

/** Connection/error notices float over the page; the list and input never move for a notice. */
@Composable fun AppStatusOverlay(state: MobileState, dismiss: () -> Unit, modifier: Modifier = Modifier, recover: () -> Unit = {}) {
    val offline = state.machine != null && state.connection != ConnectionState.Connected &&
        (state.page == "chat" || state.page == "chats" && state.machineFilter == state.machine?.id)
    val message = state.error ?: if (offline) {
        state.connectionFailure?.message ?: if (state.connection == ConnectionState.Connecting) "Connecting to your PC…" else "Waiting for your PC · saved chats stay available"
    } else return
    val error = state.error != null
    Surface(modifier.padding(horizontal = 12.dp, vertical = 6.dp).widthIn(max = 560.dp), shape = RoundedCornerShape(16.dp),
        color = if (error) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
        contentColor = if (error) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurface,
        shadowElevation = 5.dp) {
        Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = if (error) 2.dp else 14.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (!error) AppIcon(R.drawable.ic_wifi_off, modifier = Modifier.size(18.dp))
            Text(message, Modifier.weight(1f).padding(vertical = 7.dp), style = MaterialTheme.typography.bodySmall)
            if (!error && state.connectionFailure != null) TextButton(recover) { Text(when (state.connectionFailure.recovery) {
                ConnectionRecovery.PairAgain -> "Pair again"
                ConnectionRecovery.Update -> "Computers"
                ConnectionRecovery.Retry -> "Retry"
            }) }
            if (error) IconButton(dismiss, Modifier.size(40.dp)) { AppIcon(R.drawable.ic_x, "Dismiss error", Modifier.size(18.dp)) }
        }
    }
}
