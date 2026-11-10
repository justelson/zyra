package dev.zyra.mobile.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.zyra.mobile.R
import dev.zyra.mobile.data.ConnectionState

@Composable fun MachinePickerSheet(state: MobileState, select: (String?) -> Unit, manage: () -> Unit, pair: () -> Unit, close: () -> Unit) {
    ZyraSheet("Machines", close, footer = { MachinePickerFooter(manage, pair) }) { MachinePickerRows(state, select) }
}
@Composable fun MachinePickerFooter(manage: () -> Unit, pair: () -> Unit) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ZyraOutlinedButton(onClick = manage, modifier = Modifier.weight(1f), shape = MaterialTheme.shapes.medium) { Text("Manage") }
            ZyraButton(onClick = pair, modifier = Modifier.weight(1f), shape = MaterialTheme.shapes.medium) { AppIcon(R.drawable.ic_plus, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Add PC") }
        }
}
@Composable fun ColumnScope.MachinePickerRows(state: MobileState, select: (String?) -> Unit) {

        ZyraSettingRow(R.drawable.ic_monitor, "All machines", "Every conversation, together", click = { select(null) }, trailing = { if (state.machineFilter == null) AppIcon(R.drawable.ic_check, "Selected") })
        HorizontalDivider(Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
        state.machines.forEach { machine ->
            val connection = state.machineStatus[machine.id] ?: ConnectionState.Offline
            ZyraSettingRow(icon = null, title = machine.name, subtitle = state.machineFailures[machine.id]?.message ?: connectionLabel(connection), leading = { MachineStatusIcon(connection) }, click = { select(machine.id) }, trailing = { if (state.machineFilter == machine.id) AppIcon(R.drawable.ic_check, "Selected") })
        }
}
