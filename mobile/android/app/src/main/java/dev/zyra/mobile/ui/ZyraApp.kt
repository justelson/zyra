package dev.zyra.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.zyra.mobile.R
import dev.zyra.mobile.data.*
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ZyraApp(vm: MobileSession, scannedLink: String, consumedLink: () -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    val appearance by vm.preferences.appearance.collectAsStateWithLifecycle()
    val modelPicker by vm.modelPicker.state.collectAsStateWithLifecycle()
    var setup by rememberSaveable { mutableStateOf(false) }
    var tools by remember { mutableStateOf(false) }
    var permissions by remember { mutableStateOf(false) }
    var machinePicker by remember { mutableStateOf(false) }
    var pluginMachines by remember { mutableStateOf(false) }
    var pluginScope by remember { mutableStateOf(false) }
    val saved = rememberSaveableStateHolder()
    val duration = if (LocalReduceMotion.current) 0 else 240
    LaunchedEffect(state.initialized, state.machines.isEmpty()) { if (state.initialized && state.machines.isEmpty()) setup = true }
    LaunchedEffect(scannedLink) { if (scannedLink.isNotBlank()) setup = true }
    val root = state.page == "chats" || (state.page == "machines" && state.machine == null)
    val pageRoute = (if (state.page in setOf("limits", "usage")) "usage-limits" else state.page) + if (state.detail != null) ":detail" else ""
    val floatingHeader = state.page == "chat" && state.detail == null
    val layoutDirection = LocalLayoutDirection.current
    BackHandler(!setup && (!root || state.detail != null)) { vm.back() }
    MediaDialog(vm)
    if (!state.initialized) {
        Surface(Modifier.fillMaxSize()) { Box(contentAlignment = Alignment.Center) { Text("Zyra", style = MaterialTheme.typography.headlineMedium) } }
        return
    }
    CompositionLocalProvider(LocalMarkdownOpenFile provides vm::openMarkdownFile, LocalRemoteImageOwner provides "${state.machine?.id}:${state.session.id}:${state.page}") {
    Scaffold(topBar = {
        if (state.page != "new-chat") {
        ChatHeaderSurface(floatingHeader) {
        if (state.page == "workspace" && state.detail == null) WorkspaceTopBar(vm.workspace, state.connection == ConnectionState.Connected, vm::back) else TopAppBar(title = {
            Column {
                if (state.page == "fleet" && state.detail == null) FleetHeaderTitle(vm.fleet, state.connection == ConnectionState.Connected, vm::openFleet) else
                if (state.page == "plugins" && state.detail == null) PluginsHeaderTitle(state.machine?.name.orEmpty(), state.connection == ConnectionState.Connected, { pluginMachines = true }) else
                if (state.page in setOf("limits", "usage") && state.detail == null) UsageDestinationTitle(state.page, vm::page) else
                Text(if (state.detail != null) state.detailTitle else when (state.page) { "search-context" -> state.searchSelection?.chat?.title ?: "Search result"; "chat" -> state.title; "chats" -> "Chats"; "workspace" -> "Files & changes"; "terminal" -> "Terminal"; "fleet" -> "Agents & workflows"; "plugins" -> "Plugins"; "plugin-store" -> "Plugin Store"; "plugin-detail" -> "Plugin details"; "settings" -> "Settings"; "chat-settings" -> "Chat settings"; "chat-models" -> "Model & thinking"; "limits", "usage" -> "Usage & limits"; "storage" -> "Storage"; "captures" -> "Browser captures"; "diagnostics" -> "Diagnostics"; "appearance" -> "Appearance"; "voice-settings" -> "Voice"; "about" -> "About"; "licenses" -> "Open-source licenses"; else -> if (state.page.startsWith("license:")) licenseTitle(state.page.substringAfter(":")) else "Computers" }, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleLarge)
                if (state.page in listOf("chat", "chats")) {
                    Row(Modifier.then(if (state.page == "chats") Modifier.clickable { machinePicker = true } else Modifier).padding(top = if (state.page == "chat") 0.dp else 3.dp, bottom = if (state.page == "chat") 0.dp else 5.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(if (state.page == "chats") state.machines.find { it.id == state.machineFilter }?.name ?: "All machines"
                            else listOf(projectLabel(state.activeProject, state.projectArtwork["${state.machine?.id}:${state.activeProject}"]), state.machine?.name.orEmpty()).filter { it.isNotBlank() }.joinToString(" · "),
                            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        if (state.page == "chat") PermissionStatus(state.session.config.runtimeMode) { permissions = true }
                        if (state.page == "chats") AppIcon(R.drawable.ic_chevron_down, "Choose machine", Modifier.size(12.dp))
                    }
                }
            }
        }, navigationIcon = { if (!root || state.detail != null) IconButton(onClick = vm::back) { AppIcon(R.drawable.ic_arrow_left, "Back") } },
            actions = {
                when (state.page) {
                    "fleet" -> if (state.detail == null) FleetHeaderActions(vm.fleet, state.connection == ConnectionState.Connected)
                    "plugins" -> if (state.detail == null) PluginsHeaderActions(vm.plugins, state.connection == ConnectionState.Connected, vm::openPluginStore, if (state.session.id.isNotBlank()) ({ pluginScope = true }) else null)
                    "chats" -> { IconButton(onClick = vm::refreshChats, enabled = !state.loadingChats) { if (state.loadingChats) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else AppIcon(R.drawable.ic_refresh_cw, "Refresh chats") }; IconButton(onClick = { vm.page("settings") }) { AppIcon(R.drawable.ic_settings, "Settings") } }
                    "chat" -> IconButton(onClick = { tools = true }) { if (state.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 1.5.dp) else AppIcon(R.drawable.ic_sliders_horizontal, "Chat tools") }
                    "machines" -> if (root) IconButton(onClick = { vm.page("settings") }) { AppIcon(R.drawable.ic_settings, "Settings") }
                }
            }, colors = TopAppBarDefaults.topAppBarColors(containerColor = if (floatingHeader) Color.Transparent else MaterialTheme.colorScheme.background))
        }
        }
    }) { padding ->
        Box(Modifier.padding(PaddingValues(start = padding.calculateStartPadding(layoutDirection), end = padding.calculateEndPadding(layoutDirection),
            top = 0.dp, bottom = padding.calculateBottomPadding())).imePadding().fillMaxSize()) {
            Column(Modifier.fillMaxSize()) {
            AnimatedContent(targetState = PageDestination(pageRoute, state.navigationBack), contentKey = { it.route }, transitionSpec = {
                ((fadeIn(tween(duration)) + slideInHorizontally(tween(duration)) { targetState.enterOffset(it) }) togetherWith
                    (fadeOut(tween(duration / 2)) + slideOutHorizontally(tween(duration)) { targetState.exitOffset(it) })).using(null)
            }, contentAlignment = Alignment.TopStart, label = "Page transition", modifier = Modifier.weight(1f).fillMaxWidth()) { transition ->
                val destination = transition.route
                // Each outgoing/incoming page keeps its own header inset. The animation
                // container itself never moves vertically when top-bar height changes.
                val headerInset = remember(destination, layoutDirection) { PageHeaderInset() }
                val activeRoute = pageRoute
                val pageHeaderInset = headerInset.resolve(destination == activeRoute, padding.calculateTopPadding().value).dp
                val overlaysHeader = destination == "chat" || destination == "new-chat"
                Box(Modifier.fillMaxSize().padding(top = if (overlaysHeader) 0.dp else pageHeaderInset), contentAlignment = Alignment.TopStart) {
                saved.SaveableStateProvider(state.machine?.id.orEmpty() + ":" + destination) {
                    if (destination.endsWith(":detail")) CapturedDetailScreen(state, vm) else when (destination) {
                        "chats" -> ChatsScreen(state, vm) { vm.page("new-chat") }
                        "new-chat" -> NewChatScreen(state, vm)
                        "search-context" -> SearchContextScreen(state, vm)
                        "machines" -> MachinesScreen(state, vm) { setup = true }
                        "settings" -> SettingsScreen(vm) { state.machines.singleOrNull()?.let { vm.selectPluginMachine(it.id) } ?: run { pluginMachines = true } }
                        "appearance" -> AppearanceScreen(appearance, vm.preferences::update)
                        "voice-settings" -> VoiceSettingsScreen(vm.preferences)
                        "workspace" -> CompositionLocalProvider(LocalMarkdownOpenFile provides vm.workspace::followLink, LocalMarkdownImage provides { image -> WorkspaceMarkdownImage(image, vm) }) {
                            WorkspaceScreen(vm.workspace, state.connection == ConnectionState.Connected)
                        }
                        "terminal" -> TerminalScreen(vm.terminal)
                        "usage-limits" -> UsageLimitsScreen(state, vm::machineUsage, vm::machineLimits)
                        "chat-settings" -> ChatSettingsScreen(vm) { vm.page("chat-models") }
                        "chat-models" -> {
                            LaunchedEffect(Unit) { vm.loadModels() }
                            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
                                ModelPickerContent(modelPicker, state.session.config.model, state.session.config.thinking,
                                    vm.modelPicker::selectInline, vm.modelPicker::thinking, vm::loadModels)
                            }
                        }
                        "diagnostics" -> ResponseTimingsScreen(vm)
                        "captures" -> BrowserCapturesScreen(state, vm)
                        "storage" -> StorageSettingsScreen(vm::localStorageUsage, vm::clearHistoryStorage)
                        "about" -> AboutScreen(vm::page)
                        "licenses" -> LicensesScreen(vm::page)
                        "fleet" -> FleetScreen(vm.fleet, state.connection == ConnectionState.Connected)
                        "plugins" -> PluginsScreen(vm.plugins, state.connection == ConnectionState.Connected, state.machine?.name.orEmpty(), vm::openPluginStore, vm::openPluginDetails, { pluginMachines = true }, if (state.session.id.isNotBlank()) ({ pluginScope = true }) else null)
                        "plugin-store" -> PluginStoreScreen(vm.pluginStore, state.connection == ConnectionState.Connected, vm::returnToPlugins)
                        "plugin-detail" -> PluginDetailsScreen(vm.pluginDetails, state.connection == ConnectionState.Connected, state.machine?.name.orEmpty())
                        "chat" -> SessionScreen(state, vm, topInset = pageHeaderInset)
                        else -> if (destination.startsWith("license:")) LicenseScreen(destination.substringAfter(":"))
                    }
                }
                }
            }
            }
            AppStatusOverlay(state, vm::dismissError, Modifier.align(Alignment.TopCenter).padding(top =
                if (floatingHeader) padding.calculateTopPadding() else if (state.page == "new-chat") WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 64.dp else padding.calculateTopPadding()), recover = {
                when (state.connectionFailure?.recovery) {
                    ConnectionRecovery.PairAgain -> setup = true
                    ConnectionRecovery.Update -> vm.page("machines")
                    else -> state.machine?.let { vm.retryConnection(it.id) }
                }
            })
        }
    }
    if (setup) SetupSheet(state, scannedLink, consumedLink, vm::pair, cancel = { setup = false }) { setup = false; vm.page("chats") }
    if (machinePicker) MachinePickerSheet(state, select = { vm.selectMachineFilter(it); machinePicker = false }, manage = { machinePicker = false; vm.page("machines") }, pair = { machinePicker = false; setup = true }, close = { machinePicker = false })
    if (permissions) ZyraSheet("Chat permissions", { permissions = false }) {
        PermissionControls(state.session.config.runtimeMode, state.connection == ConnectionState.Connected) { vm.configure("runtimeMode", it) }
    }
    if (tools) ChatToolsSheet(vm, state, { tools = false }, { tools = false; vm.page("chat-settings") })
    if (pluginMachines) PluginMachineSheet(state, { pluginMachines = false }, { pluginMachines = false; vm.selectPluginMachine(it) }, { pluginMachines = false; vm.page("machines") })
    if (pluginScope) ZyraSheet("Plugin scope", { pluginScope = false }) {
        ZyraSettingRow(R.drawable.ic_monitor, "This computer", state.machine?.name, click = { pluginScope = false; vm.setPluginChatScope(false) }, trailing = { ZyraSelectionMark(!state.pluginInChat) })
        if (state.session.id.isNotBlank()) ZyraSettingRow(R.drawable.ic_message_square, "Current chat", state.title, click = { pluginScope = false; vm.setPluginChatScope(true) }, trailing = { ZyraSelectionMark(state.pluginInChat) })
    }
    if (modelPicker.visible && state.page != "chat-models") ModelPickerSheet(modelPicker, state.session.config.model, state.session.config.thinking,
        { vm.modelPicker.close() }, vm.modelPicker::select, vm.modelPicker::thinking, vm::loadModels)
    }
}




