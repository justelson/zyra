package dev.zyra.mobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.zyra.mobile.R
import dev.zyra.mobile.data.ChatConfiguration
import dev.zyra.mobile.data.permissionLabel

@Composable internal fun ChatSettingsGroup(content: @Composable ColumnScope.() -> Unit) {
    Surface(Modifier.fillMaxWidth().padding(horizontal = 20.dp), shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(content = content)
    }
}
@Composable internal fun ChatSettingControl(title: String, subtitle: String? = null, click: (() -> Unit)? = null,
    leading: @Composable () -> Unit, trailing: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().then(if (click != null) Modifier.clickable(onClick = click) else Modifier).padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        leading()
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            subtitle?.takeIf(String::isNotBlank)?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        if (trailing != null) trailing() else if (click != null) AppIcon(R.drawable.ic_chevron_right, modifier = Modifier.size(16.dp))
    }
}
@Composable private fun ChatSettingsDivider() = HorizontalDivider(Modifier.padding(start = 48.dp, end = 16.dp), color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .45f))

@Composable fun ChatSettingsContent(config: ChatConfiguration, preferences: ChatPreferencesState, connected: Boolean,
    models: () -> Unit, profiles: () -> Unit, memory: (Boolean) -> Unit, retry: () -> Unit, configure: (String, Any) -> Unit,
    initiallyAdvanced: Boolean = false, chooseProfile: ((String) -> Unit)? = null) {
    var stylesExpanded by remember { mutableStateOf(false) }
    var memoryDetails by remember { mutableStateOf(false) }
    var advanced by remember { mutableStateOf(initiallyAdvanced) }
    val personalizing = connected && preferences.loaded && !preferences.saving
    ChatSettingsGroup {
        ChatSettingControl("Model & thinking", config.model.substringAfter('/').ifBlank { "Choose a model" }, click = if (connected && "model" in config.supportedFields) models else null,
            leading = { ThinkingGaugeIcon(config.thinking, Modifier.size(22.dp)) })
        ChatSettingsDivider()
        ChatSettingControl("Speaking style", preferences.profile.ifBlank { config.profile }.replaceFirstChar { it.uppercase() }.ifBlank { "From your PC" },
            click = if (personalizing && "profile" in config.supportedFields) ({ if (chooseProfile == null) profiles() else stylesExpanded = true }) else null,
            leading = { AppIcon(R.drawable.ic_text_cursor_input, modifier = Modifier.size(20.dp)) },
            trailing = { if (preferences.busy || preferences.saving) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else AppIcon(R.drawable.ic_chevron_right, "Speaking styles", Modifier.size(16.dp)) })
        if (preferences.loaded) {
            ChatSettingsDivider()
            ChatSettingControl("Learn from this chat", leading = { AppIcon(R.drawable.ic_brain, modifier = Modifier.size(20.dp)) }, trailing = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton({ memoryDetails = true }, Modifier.size(36.dp)) { AppIcon(R.drawable.ic_info, "About chat memory", Modifier.size(16.dp)) }
                    ZyraSwitch(preferences.memoryMode == "enabled", memory, enabled = personalizing && preferences.memoryMode.isNotBlank())
                }
            })
        }
        ChatSettingsDivider()
        ChatSettingControl("Advanced", permissionLabel(config.runtimeMode), click = { advanced = true }, leading = { AppIcon(R.drawable.ic_sliders_horizontal, modifier = Modifier.size(20.dp)) })
    }
    preferences.error?.let { message -> ZyraSettingRow(R.drawable.ic_info, message, click = if (connected) retry else null, trailing = { AppIcon(R.drawable.ic_refresh_cw, "Reload preferences", Modifier.size(18.dp)) }) }
    if (stylesExpanded && chooseProfile != null) ZyraSheet("Speaking style", close = { stylesExpanded = false }) {
        SpeakingStyleOptions(preferences, personalizing) { chooseProfile(it); stylesExpanded = false }
    }
    if (memoryDetails) ZyraSheet("Chat memory", close = { memoryDetails = false }) {
        Text(if (preferences.memoryMode == "polluted") "Learning is off because this chat contains external context. Turn on Learn from this chat to include it again." else "Save useful learnings from this chat on your PC.",
            Modifier.padding(horizontal = 20.dp, vertical = 12.dp), style = MaterialTheme.typography.bodyMedium)
    }
    if (advanced) ZyraSheet("Advanced", close = { advanced = false }) {
        AdvancedChatControls(config, connected, configure)
    }
}

@Composable internal fun SpeakingStyleOptions(preferences: ChatPreferencesState, personalizing: Boolean, select: (String) -> Unit) {
        Column(Modifier) {
            if (preferences.profiles.isEmpty()) Text("No speaking styles available. Reload preferences to try again.", Modifier.padding(20.dp), style = MaterialTheme.typography.bodyMedium)
            preferences.profiles.forEach { profile -> ZyraSettingRow(title = profile.name.replaceFirstChar { it.uppercase() }, subtitle = profile.description,
                click = if (personalizing) ({ select(profile.name) }) else null,
                trailing = { ZyraSelectionMark(profile.name == preferences.profile) }) }
        }
}

@Composable internal fun AdvancedChatControls(config: ChatConfiguration, connected: Boolean, configure: (String, Any) -> Unit) {
        Column(Modifier.padding(bottom = 12.dp)) {
            PermissionControls(config.runtimeMode, connected && "runtimeMode" in config.supportedFields) { configure("runtimeMode", it) }
            HorizontalDivider(Modifier.padding(horizontal = 20.dp, vertical = 12.dp))
            ZyraSettingRow(title = "Web search", subtitle = if ("webSearch" !in config.supportedFields) "Unavailable on this PC" else null, trailing = { ZyraSwitch(config.webSearch, { configure("webSearch", it) }, enabled = connected && "webSearch" in config.supportedFields) })
            ZyraSettingRow(title = "Read web pages", subtitle = if ("webFetch" !in config.supportedFields) "Unavailable on this PC" else null, trailing = { ZyraSwitch(config.webFetch, { configure("webFetch", it) }, enabled = connected && "webFetch" in config.supportedFields) })
            if (config.model.startsWith("openai-codex/")) {
                HorizontalDivider(Modifier.padding(horizontal = 20.dp, vertical = 12.dp))
                Text("Response speed", Modifier.padding(horizontal = 20.dp), style = MaterialTheme.typography.labelMedium)
                val available = "codexServiceTier" in config.supportedFields
                if (!available) Text("Update Zyra on this PC to change response speed.", Modifier.padding(horizontal = 20.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall)
                for ((value, label) in listOf("default" to "Standard", "priority" to "Fast", "flex" to "Flex")) {
                    ZyraSettingRow(title = label, click = if (connected && available) ({ configure("codexServiceTier", value) }) else null,
                        trailing = { ZyraSelectionMark(config.codexServiceTier.ifBlank { "default" } == value) })
                }
            }
        }
}

@Composable internal fun PermissionControls(mode: String, connected: Boolean, select: (String) -> Unit) {
    val choices = listOf(
        Triple("approval-required", R.drawable.ic_lock, "Supervised"),
        Triple("auto-review", R.drawable.ic_shield_check, "Auto review"),
        Triple("edits-only", R.drawable.ic_pencil, "Edits only"),
        Triple("full-access", R.drawable.ic_lock_open, "Full access"),
    )
    if (mode.isBlank() || choices.none { it.first == mode }) Text(permissionLabel(mode), Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
    choices.forEach { (value, icon, label) ->
        ZyraSettingRow(icon, label, if (value == "full-access") "Actions run without approval" else null,
            click = if (connected) ({ select(value) }) else null,
            trailing = { ZyraSelectionMark(mode == value) })
    }
}
