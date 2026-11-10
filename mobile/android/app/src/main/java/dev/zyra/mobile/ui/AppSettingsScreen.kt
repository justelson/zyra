package dev.zyra.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.zyra.mobile.R
import dev.zyra.mobile.data.*

@Composable fun SettingsScreen(vm: MobileSession, plugins: () -> Unit) {
    val optimizePhotos by vm.preferences.optimizePhotos.collectAsState()
    SettingsContent(vm::page, plugins, optimizePhotos, vm.preferences::optimizePhotos) { ChatNotificationSetting(vm) }
}
@Composable internal fun SettingsContent(page: (String) -> Unit, plugins: () -> Unit, optimizePhotos: Boolean = true, changeOptimizePhotos: (Boolean) -> Unit = {}, notifications: @Composable () -> Unit = {}) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)) {
        item { SettingsCategory("Personalize") }
        item { SettingsLink(R.drawable.ic_palette, "Appearance", "Theme, layout and motion") { page("appearance") } }
        item { SettingsLink(R.drawable.ic_mic, "Voice", "Voice and dictation") { page("voice-settings") } }
        item { SettingsCategory("Your workspace") }
        item { SettingsLink(R.drawable.ic_monitor, "Computers", "Connections and device access") { page("machines") } }
        item { SettingsLink(R.drawable.ic_puzzle, "Plugins", "Installed on your computers", plugins) }
        item { SettingsLink(R.drawable.ic_sliders_horizontal, "Usage & limits", "Activity, costs and account allowances") { page("limits") } }
        item { SettingsCategory("This phone") }
        item { notifications() }
        item { ZyraSettingRow(R.drawable.ic_camera, "Optimize new photos", "Smaller uploads on slower connections", trailing = { ZyraSwitch(optimizePhotos, changeOptimizePhotos) }) }
        item { SettingsLink(R.drawable.ic_folder, "Storage", "Saved history and downloads") { page("storage") } }
        item { SettingsLink(R.drawable.ic_camera, "Browser captures", "Saved screenshots and recordings") { page("captures") } }
        item { SettingsLink(R.drawable.ic_terminal, "Diagnostics", "Response timings") { page("diagnostics") } }
        item { SettingsLink(R.drawable.ic_info, "About Zyra", "Version and licenses") { page("about") } }
    }
}
@Composable private fun SettingsCategory(title: String) {
    Text(title, Modifier.padding(start = 12.dp, top = 20.dp, bottom = 6.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
@Composable private fun SettingsLink(icon: Int, title: String, subtitle: String, onClick: () -> Unit) {
    ZyraSettingRow(icon, title, subtitle, click = onClick)
}
@Composable fun MachinesScreen(state: MobileState, vm: MobileSession, pair: () -> Unit) {
    var forgetting by remember { mutableStateOf<Machine?>(null) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("Your computers", style = MaterialTheme.typography.headlineSmall) }
        item { Text("Switch PCs without signing in. Each computer keeps its own chats and workspace.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        items(state.machines, key = { it.id }) { machine ->
            var menu by remember { mutableStateOf(false) }
            Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer, border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                val connection = state.machineStatus[machine.id] ?: ConnectionState.Offline
                ZyraSettingRow(icon = null, title = machine.name, subtitle = state.machineFailures[machine.id]?.message ?: connectionLabel(connection), click = { vm.selectMachineFilter(machine.id) }, leading = { MachineStatusIcon(connection) }, trailing = {
                    Box { IconButton(onClick = { menu = true }) { AppIcon(R.drawable.ic_ellipsis, "Computer options") }; DropdownMenu(menu, { menu = false }, shape = MaterialTheme.shapes.medium, containerColor = MaterialTheme.colorScheme.surfaceContainer, tonalElevation = 0.dp) {
                        if (connection != ConnectionState.Connected) DropdownMenuItem(text = { Text(if (state.machineFailures[machine.id]?.recovery == ConnectionRecovery.PairAgain) "Pair again" else if (state.machineFailures[machine.id]?.recovery == ConnectionRecovery.Update) "Retry after updating" else "Retry connection") }, onClick = { menu = false; if (state.machineFailures[machine.id]?.recovery == ConnectionRecovery.PairAgain) pair() else vm.retryConnection(machine.id) })
                        DropdownMenuItem(text = { Text("Forget this computer") }, leadingIcon = { AppIcon(R.drawable.ic_x) }, onClick = { forgetting = machine; menu = false })
                    } }
                })
            }
        }
        item { ZyraOutlinedButton(onClick = pair, modifier = Modifier.fillMaxWidth()) { AppIcon(R.drawable.ic_plus); Spacer(Modifier.width(8.dp)); Text("Pair a computer") } }
    }
    forgetting?.let { machine -> AlertDialog(onDismissRequest = { forgetting = null }, title = { Text("Forget " + machine.name + "?") }, text = { Text("Saved chats and drafts from this PC will be removed from this phone. Your work on the PC stays there.") }, confirmButton = { TextButton(onClick = { vm.forget(machine); forgetting = null }) { Text("Forget") } }, dismissButton = { TextButton(onClick = { forgetting = null }) { Text("Cancel") } }) }
}
@Composable fun MachineStatusIcon(connection: ConnectionState) {
    val color = when (connection) {
        ConnectionState.Connected -> MaterialTheme.colorScheme.primary
        ConnectionState.Connecting, ConnectionState.Reconnecting -> MaterialTheme.colorScheme.tertiary
        ConnectionState.Offline -> MaterialTheme.colorScheme.outline
    }
    Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
        AppIcon(R.drawable.ic_monitor, modifier = Modifier.size(20.dp))
        Box(Modifier.align(Alignment.BottomEnd).size(8.dp).background(color, CircleShape))
    }
}

fun connectionLabel(value: ConnectionState) = when (value) { ConnectionState.Connected -> "Connected"; ConnectionState.Connecting -> "Connecting…"; ConnectionState.Reconnecting -> "Reconnecting…"; ConnectionState.Offline -> "Offline" }


