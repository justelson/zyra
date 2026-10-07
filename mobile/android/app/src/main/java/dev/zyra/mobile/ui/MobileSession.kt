package dev.zyra.mobile.ui

import android.app.Application
import android.os.Build
import dev.zyra.mobile.ZyraApplication

import dev.zyra.mobile.data.*
import dev.zyra.mobile.network.HostFailure
import dev.zyra.mobile.network.HostConnection
import dev.zyra.mobile.network.MachineConnections
import dev.zyra.mobile.voice.AndroidVoicePeer
import dev.zyra.mobile.voice.VoiceController
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.UUID

data class MobileState(
    val newChatAction: String? = null, val newChatDraftRevision: Int = 0,
    val regeneratingTitles: Set<String> = emptySet(),
    val pairingRevision: Int = 0, val initialized: Boolean = false, val pairingBusy: Boolean = false, val pairingError: String? = null, val pairedHostId: String? = null,
    val machines: List<Machine> = emptyList(), val machine: Machine? = null,
    val searchMatches: List<ChatSearchMatch> = emptyList(), val searchIndexing: Boolean = false, val searchSelection: ChatSearchMatch? = null, val searchContext: List<TimelineItem> = emptyList(), val searchContextBusy: Boolean = false,
    val machineFilter: String? = null, val machineStatus: Map<String, ConnectionState> = emptyMap(),
    val machineProjects: Map<String, List<String>> = emptyMap(),
    val projectArtwork: Map<String, ProjectMark> = emptyMap(),
    val connection: ConnectionState = ConnectionState.Offline, val runtimeStatus: RuntimeStatus = RuntimeStatus.Unknown, val chats: List<Chat> = emptyList(),
    val projects: List<String> = emptyList(), val session: SessionView = SessionView(), val title: String = "", val activeProject: String = "",
    val navigationBack: Boolean = false, val metadataLoading: Boolean = false,
    val draft: String = "", val busy: Boolean = false, val loadingHistory: Boolean = false, val error: String? = null, val page: String = "machines", val pluginInChat: Boolean = false,
    val detailAction: WorkAction? = null, val detailBusy: Boolean = false, val responding: Set<String> = emptySet(), val detail: String? = null, val detailTitle: String = "", val detailMedia: String = "", val chatQuery: String = "", val nextChatCursor: String? = null, val loadingChats: Boolean = false, val pendingSends: List<PendingSend> = emptyList()
)
class MobileSession(private val app: ZyraApplication) : AutoCloseable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val dictation = dev.zyra.mobile.dictation.DictationController(scope) { dev.zyra.mobile.dictation.AndroidDictationRecorder() }
    val voice = VoiceController(scope, prepare = { app.voiceService.awaitReady() }) { AndroidVoicePeer(app, it) }
    fun startDictation() {
        val current = mutable.value
        val connection = host ?: return
        val session = current.session.id
        val machine = current.machine?.id ?: return
        if (!preferences.dictation.value || !foregroundVisible || current.page != "chat" || current.busy || current.connection != ConnectionState.Connected || session.isBlank() || voice.state.value.inCall) return
        if ("dictation" !in connection.capabilities) { error(IllegalStateException("Update Zyra on this computer to use dictation.")); return }
        dictation.start(dictationRequest(connection, machine, session), machine to session) { text ->
            if (mutable.value.page != "chat" || mutable.value.machine?.id != machine || mutable.value.session.id != session) false
            else dev.zyra.mobile.dictation.appendDictatedText(mutable.value.draft, text)?.let { setDraft(it); true } ?: false
        }
    }
    private fun dictationRequest(connection: HostConnection, machine: String, session: String): dev.zyra.mobile.dictation.DictationRequest = { method, params ->
        if (method != "dictation.cancel") check(host === connection && mutable.value.connection == ConnectionState.Connected && !mutable.value.busy && mutable.value.machine?.id == machine && mutable.value.session.id == session) { "Reconnect to this computer, then retry your recording." }
        resolved(connection, connection.request(method, params.put("session", session)))
    }
    fun startVoice() {
        val current = mutable.value
        val connection = host ?: return
        if (current.page != "chat" || current.connection != ConnectionState.Connected || current.busy || current.session.id.isBlank()) return
        if ("voice" !in connection.capabilities) { error(IllegalStateException("Update Zyra on this PC to use Voice.")); return }
        if (attachments.state.value.items.isNotEmpty()) { error(IllegalStateException("Send or remove the attached photos before starting Voice.")); return }
        if (voice.state.value.inCall || dictation.state.value.active || !foregroundVisible) return
        try { app.voiceService.start(this) } catch (e: Exception) { error(e); return }
        val session = current.session.id
        voice.start(session, "${current.machine?.id}:$session", preferences.voice.value) { method, params ->
            try { resolved(connection, connection.request(method, params.put("session", session))) }
            catch (e: Exception) { if (method == "voice.stop") connection.close(); throw e }
        }
    }
    val preferences = AppPreferences(app)
    val chatPreferences = ChatPreferencesController(scope)
    val modelPicker = ModelPickerController(scope)
    fun loadChatPreferences() {
        val current = mutable.value
        val connection = host ?: return
        val sessionId = current.session.id
        val machineId = current.machine?.id ?: return
        if (sessionId.isBlank() || current.connection != ConnectionState.Connected) return
        chatPreferences.open { type, payload ->
            check(host === connection && mutable.value.machine?.id == machineId && mutable.value.session.id == sessionId) { "Open this chat again to update its preferences." }
            val result = resolved(connection, connection.request("session.request", JSONObject().put("sessionKey", sessionId).put("type", type).put("payload", payload)))
            check(host === connection && mutable.value.machine?.id == machineId && mutable.value.session.id == sessionId) { "The open chat changed." }
            result
        }
    }
    val media = MediaController(app, scope)
    suspend fun markdownImage(destination: String, rootId: String? = null, basePath: String? = null): Pair<JSONObject, java.io.File?> {
        val current = mutable.value
        val machine = current.machine ?: error("Connect to this computer to load images.")
        check("project-images" in host?.capabilities.orEmpty()) { "Update Zyra on this computer to load project images." }
        val request = workspaceRequest() ?: error("Open this chat to load images.")
        val ref = request("workspace.image", JSONObject().put("destination", destination).apply {
            rootId?.let { put("rootId", it) }; basePath?.let { put("basePath", it) }
        }).getJSONObject("mediaRef")
        val file = media.inline(machine.id, current.session.id, ref, request)
        check(mutable.value.machine?.id == machine.id && mutable.value.session.id == current.session.id) { "The open chat changed." }
        return ref to file
    }
    /** Thumbnail work belongs to its visible tile, not the session's long-lived scope. */
    suspend fun inlineImage(machineId: String, sessionId: String, ref: JSONObject): java.io.File? {
        fun checkOwner() { check(mutable.value.machine?.id == machineId && mutable.value.session.id == sessionId) { "The open chat changed." } }
        checkOwner()
        media.cached(machineId, ref)?.let { return it }
        val request = workspaceRequest() ?: error("Reconnect to load this image.")
        val file = media.visibleThumbnail(machineId, sessionId, ref, request)
        checkOwner()
        return file
    }
    fun openImage(ref: JSONObject) {
        val current = mutable.value; val machine = current.machine ?: return; val request = workspaceRequest() ?: return
        media.open(machine.id, current.session.id, ref, request)
    }
    val attachments = AttachmentController(app, scope)
    private var attachmentPickerOwner: AttachmentPickerOwner? = null
    fun beginAttachmentPicker(): Boolean {
        val current = mutable.value
        val machine = current.machine?.id ?: return false
        if (attachmentPickerOwner != null || current.page != "chat" || current.busy || current.session.id.isBlank()) return false
        attachmentPickerOwner = AttachmentPickerOwner(navigation, detailRevision, machine, current.session.id)
        return true
    }
    fun failAttachmentPicker(cause: Exception) { attachmentPickerOwner = null; error(cause) }
    fun completeAttachmentPicker(uris: List<android.net.Uri>) {
        val owner = attachmentPickerOwner ?: return
        attachmentPickerOwner = null
        val current = mutable.value
        if (uris.isNotEmpty() && owner.accepts(navigation, detailRevision, current.machine?.id, current.session.id, current.page, current.busy)) attachments.add(uris)
    }
    fun completeCameraAttachment(file: java.io.File) {
        val owner = attachmentPickerOwner; attachmentPickerOwner = null
        val current = mutable.value
        if (owner != null && owner.accepts(navigation, detailRevision, current.machine?.id, current.session.id, current.page, current.busy)) {
            attachments.add(listOf(android.net.Uri.fromFile(file))) { file.delete() }
        } else file.delete()
    }

    private var preparingSend: String? = null
    val workspace = WorkspaceController(scope)
    val terminal = TerminalWorkspaceController(scope)
    val fleet = FleetController(scope)
    val plugins = PluginsController(scope)
    val pluginStore = PluginStoreController(scope)
    val pluginDetails = PluginDetailsController(scope)
    private val vault = DeviceVault(app)
    private val cache = LocalCache(app)
    private val mutable = MutableStateFlow(MobileState())
    val state = mutable.asStateFlow()
    private var host: HostConnection? = null
    private val catalogPages = mutableMapOf<String, ChatPage>()
    private val searchPages = mutableMapOf<String, ChatSearchPage>()
    private var searchContextJob: Job? = null
    private val artworkJobs = mutableMapOf<String, Job>()
    private val artworkChecked = mutableMapOf<String, Long>()
    private val catalogTransfers = Semaphore(2)
    private val artworkTransfers = Semaphore(1)
    private val pool = MachineConnections(scope) { machine, connection, message ->
        when (message.optString("type")) {
            "catalog.changed" -> { notificationChanges.tryEmit(Unit); refreshMachineCatalog(machine, connection) }
            "host.runtime-status" -> if (host === connection) mutable.update { it.copy(runtimeStatus = connection.runtimeStatus.value) }
            "plugins.changed" -> if (host === connection) pluginInvalidations.changed { host === connection }
            "session.event" -> if (host === connection) onEvent(message)
            "terminal.event" -> if (host === connection) terminal.event(message)
            "voice.event" -> if (host === connection) voice.event(message)
        }
    }
    private var connectionJob: Job? = null
    private var saveJob: Job? = null
    private var followingLatest = true
    private var olderJob: Job? = null
    private val recentViews = LinkedHashMap<String, SessionView>()
    private fun rememberView(machineId: String, view: SessionView) {
        if (view.id.isBlank()) return
        val key = "$machineId:${view.id}"
        recentViews.remove(key)
        val snapshot = TimelineWindow.trim(view)
        if (TimelineWindow.canCache(snapshot)) recentViews[key] = snapshot
        while (recentViews.size > 4) recentViews.remove(recentViews.keys.first())
    }
    private var draftJob: Job? = null
    private var draftRevision = 0L
    private var detailRevision = 0
    private var generation = 0
    private var navigation = 0
    private var openJob: Job? = null
    private var pendingCreation: Pair<List<String>, String>? = null
    private var loadingSession = false
    private val earlyEvents = mutableListOf<JSONObject>()
    private var earlyEventBytes = 0
    init {
        scope.launch {
            voice.state.map { it.inCall }.distinctUntilChanged().collect { active ->
                pool.keepConnected(if (active) mutable.value.machine?.id else null)
                if (!active) app.voiceService.finished(this@MobileSession)
            }
        }
        scope.launch {
            try {
                val machines = withContext(Dispatchers.IO) { vault.load() }
                mutable.update { it.copy(machines = machines, initialized = true, page = startupPage(machines.isNotEmpty())) }
                pool.configure(machines)
                (machines.find { it.id == preferences.lastMachine } ?: machines.firstOrNull())?.let { connect(it) }
                for (machine in machines) withContext(Dispatchers.IO) { runCatching { cache.get("chats:${machine.id}:list") }.getOrNull() }?.let { stored ->
                    runCatching { parseChats(JSONObject(stored), machine.id) }.onSuccess { catalogPages.putIfAbsent(machine.id, ChatPage(it)) }
                }
                publishCatalog()
                launch {
                    var prior = emptyMap<String, dev.zyra.mobile.network.MachineLink>()
                    pool.links.collect { links ->
                        mutable.update { it.copy(machineStatus = links.mapValues { entry -> entry.value.status }, machineProjects = links.mapValues { entry -> entry.value.projects }) }
                        for ((id, link) in links) if (link.connection != null && prior[id]?.connection !== link.connection) {
                            notificationChanges.tryEmit(Unit)
                            machinesFor(id)?.let { refreshMachineCatalog(it, link.connection) }
                        }
                        prior = links
                    }
                }
            } catch (e: Exception) { error(e); mutable.update { it.copy(initialized = true) } }
        }
    }
    private fun error(error: Throwable) { if (error !is CancellationException) mutable.update { it.copy(error = error.message ?: "Something went wrong.") } }
    fun dismissError() { mutable.update { it.copy(error = null) } }
    private var foregroundVisible = false
    private var notificationsConnected = false
    val notificationChanges = kotlinx.coroutines.flow.MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    private val chatAlerts = dev.zyra.mobile.notifications.AndroidChatAlerts(app, scope, this)
    fun notificationMonitoringActive() = foregroundVisible || notificationsConnected
    fun notificationUiVisible() = foregroundVisible
    fun notificationConnection(active: Boolean) { notificationsConnected = active; pool.foreground(foregroundVisible || active); notificationChanges.tryEmit(Unit) }
    fun visibleChatKey(): String? = mutable.value.let { if (foregroundVisible && it.page == "chat") "${it.machine?.id}:${it.session.id}" else null }
    suspend fun notificationChats(): List<Chat> {
        val result = mutableListOf<Chat>()
        for ((id, link) in pool.links.value) {
            val connection = link.connection ?: continue
            try {
                val data = resolved(connection, connection.request("catalog.list", JSONObject().put("limit", 100).put("query", "").put("includeArchived", false)))
                if (pool.links.value[id]?.connection === connection) result += parseChats(data, id)
            } catch (e: CancellationException) { throw e } catch (_: Exception) { }
        }
        return result
    }
    fun openNotification(machineId: String, chatId: String) = scope.launch {
        state.first { it.initialized }
        val machine = machinesFor(machineId) ?: return@launch
        if (chatId.isBlank()) return@launch
        mutable.value.chats.firstOrNull { it.machineId == machineId && it.id == chatId }?.let { open(it); return@launch }
        try {
            val link = withTimeout(15000) { pool.links.first { it[machineId]?.connection != null }[machineId]!!.connection!! }
            val found = resolved(link, link.request("catalog.get", JSONObject().put("session", chatId)))
            val chat = found.optJSONObject("chat") ?: return@launch
            open(Chat.parse(chat, machine.id))
        } catch (_: TimeoutCancellationException) { error(IllegalStateException("Reconnect to ${machine.name} to open this chat.")) } catch (e: CancellationException) { throw e } catch (e: Exception) { error(e) }
    }
    private val pluginVisible = MutableStateFlow(false)
    private val chatViewLease = dev.zyra.mobile.network.ChatViewLease(scope)
    init {
        scope.launch {
            combine(mutable, pluginVisible, pool.links) { state, visible, links ->
                val connection = state.machine?.id?.let { links[it]?.connection }
                if (visible && state.page == "chat" && state.connection == ConnectionState.Connected)
                    connection to state.session.id else null to null
            }.distinctUntilChanged().collect { (connection, session) -> chatViewLease.update(connection, session) }
        }
    }
    private val pluginInvalidations = PluginInvalidations(scope, combine(
        mutable.map { it.page }.distinctUntilChanged(), pluginVisible,
        plugins.state.map { !it.busy && !it.saving && !it.reviewing }.distinctUntilChanged(),
        pluginDetails.state.map { !it.busy && !it.saving && it.review==null }.distinctUntilChanged(),
        pluginStore.state.map { !it.loading && !it.working && it.selected==null }.distinctUntilChanged(),
        ::pluginRefreshTarget
    )) { target -> when(target) {
        PluginRefreshTarget.LIST -> plugins.checkForChanges()
        PluginRefreshTarget.DETAILS -> pluginDetails.refresh()
        PluginRefreshTarget.STORE -> pluginStore.refresh()
        else -> Unit
    } }
    fun foreground(active: Boolean) { if (!active) dictation.cancel(); foregroundVisible = active; pluginVisible.value=active; pool.foreground(active || notificationsConnected); notificationChanges.tryEmit(Unit) }
    private var machinesReturnPage = "settings"
    fun page(page: String) = navigatePage(page, back = false)
    private fun navigatePage(page: String, back: Boolean) {
        detailRevision++
        if (page != "chat") { dictation.cancel(); modelPicker.close() }
        if (mutable.value.page == "terminal" && page != "terminal") terminal.leave()
        if (page !in setOf("plugins", "plugin-store", "plugin-detail")) {
            plugins.close(); pluginStore.close(); pluginDetails.close()
        } else {
            if (page != "plugins") plugins.disconnect()
            if (page != "plugin-store") pluginStore.leave()
            if (page != "plugin-detail") pluginDetails.close()
        }
        if (page != "chat") voice.stop()
        if (page == "machines" && mutable.value.page != "machines") machinesReturnPage = mutable.value.page
        media.close(); mutable.update { it.copy(page = page, navigationBack = back, detail = null, detailAction = null, detailBusy = false, detailMedia = "", newChatAction = null) }
    }
    private fun backPage(page: String) = navigatePage(page, back = true)
    fun back() {
        detailRevision++
        when { mutable.value.detail != null -> mutable.update { it.copy(navigationBack = true, detail = null, detailAction = null, detailBusy = false, detailMedia = "") }
            mutable.value.page == "workspace" -> workspace.back { backPage("chat") }
            mutable.value.page == "search-context" -> { searchContextJob?.cancel(); backPage("chats") }
            mutable.value.page.startsWith("license:") -> backPage("licenses")
            mutable.value.page == "licenses" -> backPage("about")
            mutable.value.page in setOf("appearance", "about", "voice-settings", "limits", "usage", "storage") -> backPage("settings")
            mutable.value.page == "machines" && mutable.value.machine != null -> backPage(machinesReturnPage)
            mutable.value.page == "plugin-store" -> if (!pluginStore.back()) returnToPlugins()
            mutable.value.page == "plugin-detail" -> returnToPlugins()
            mutable.value.page == "plugins" -> backPage("settings")
            mutable.value.page == "fleet" -> if (!fleet.back()) backPage("chat")
            mutable.value.page == "terminal" -> if (!terminal.back()) backPage("chat")
            mutable.value.page == "chat-models" -> backPage("chat-settings")
            mutable.value.page == "chat-settings" -> backPage("chat")
            mutable.value.page == "chat" -> backPage("chats")
            else -> backPage(if (mutable.value.machine != null) "chats" else "machines") }
    }
    fun setDraft(text: String) {
        draftRevision++
        mutable.update { it.copy(draft = text.take(60000)) }
        val machineId = mutable.value.machine?.id ?: return
        val chatId = mutable.value.session.id
        if (chatId.isBlank()) return
        draftJob?.cancel()
        draftJob = scope.launch { try { delay(250); withContext(Dispatchers.IO) { cache.put("draft:$machineId:$chatId", text.take(60000)) } } catch (e: Exception) { error(e) } }
    }
    fun pair(link: String) = scope.launch {
        if (mutable.value.pairingBusy) return@launch
        mutable.update { it.copy(pairingBusy = true, pairingError = null, pairedHostId = null) }
        try {
            val pairing = Pairing.parse(link)
            val machine = HostConnection.pair(pairing, Build.MODEL.take(80), mutable.value.machines.find { it.id == pairing.hostId })
            val machines = mutable.value.machines.filterNot { it.id == machine.id } + machine
            withContext(Dispatchers.IO) { vault.save(machines) }
            mutable.update { it.copy(machines = machines, pairedHostId = machine.id, pairingRevision = it.pairingRevision + 1) }; pool.configure(machines); connect(machine)
        } catch (e: Exception) { if (e !is CancellationException) mutable.update { it.copy(pairingError = e.message ?: "Could not pair. Check both devices are on the same Wi-Fi.") } }
        finally { mutable.update { it.copy(pairingBusy = false) } }
    }
    fun forget(machine: Machine) = scope.launch {
        try {
            val machines = mutable.value.machines.filterNot { it.id == machine.id }
            withContext(Dispatchers.IO) { vault.save(machines) }
            if (mutable.value.machine?.id == machine.id) disconnect()
            catalogJobs.remove(machine.id)?.cancel()
            artworkJobs.keys.filter { it.startsWith("${machine.id}:") }.forEach { artworkJobs.remove(it)?.cancel() }
            artworkChecked.keys.removeAll { it.startsWith("${machine.id}:") }
            mutable.update { it.copy(projectArtwork = it.projectArtwork.filterKeys { key -> !key.startsWith("${machine.id}:") }) }
            if (mutable.value.searchSelection?.chat?.machineId == machine.id) searchContextJob?.cancel()
            mutable.update { it.copy(machines = machines, machineFilter = it.machineFilter?.takeIf { id -> machines.any { m -> m.id == id } }, searchSelection = null, searchContext = emptyList()) }
            pool.configure(machines)
            catalogPages.remove(machine.id); searchPages.remove(machine.id)
            recentViews.keys.removeAll { it.startsWith("${machine.id}:") }
            attachments.forget(machine.id); media.forget(machine.id)
            withContext(Dispatchers.IO) { cache.removeMachine(machine.id) }
            publishCatalog()
            if (mutable.value.machine == null) machines.firstOrNull()?.let(::connect)
        } catch (e: Exception) { error(e) }
    }
    private fun machinesFor(id: String) = mutable.value.machines.find { it.id == id }
    fun disconnect() {
        cancelCatalogMetadata()
        dictation.cancel()
        modelPicker.close(clearCache = true)
        pluginDetails.close()
        pluginStore.close()
        plugins.close()
        preferences.lastMachine = ""
        terminal.connection(false); attachments.detached(); media.close()
        generation++; navigation++; openJob?.cancel(); connectionJob?.cancel(); host = null
        mutable.update { it.copy(connection = ConnectionState.Offline, runtimeStatus = RuntimeStatus.Unknown, machine = null, session = SessionView(), page = "machines", navigationBack = false) }
    }
    fun selectMachineFilter(id: String?) {
        if (mutable.value.machineFilter != id) cancelCatalogMetadata()
        id?.let(::machinesFor)?.let(::connect)
        mutable.update { it.copy(machineFilter = id, page = "chats", navigationBack = false) }; publishCatalog(); refreshChats()
    }
    fun connect(machine: Machine) {
        modelPicker.close(clearCache = true)
        dictation.cancel(); voice.stop()
        if (mutable.value.machine == machine) { page("chats"); return }
        val oldState = mutable.value
        oldState.machine?.let { previous ->
            rememberView(previous.id, oldState.session)
            draftJob?.cancel()
            if (oldState.session.id.isNotBlank()) scope.launch { try { withContext(Dispatchers.IO) { cache.put("draft:${previous.id}:${oldState.session.id}", oldState.draft) } } catch (e: Exception) { error(e) } }
        }
        val oldHost = host; val oldSession = oldState.session.id
        if (oldHost != null && oldSession.isNotBlank()) scope.launch { voice.awaitStopped(); runCatching { oldHost.detachSession(oldSession) } }
        preferences.lastMachine = machine.id
        pluginDetails.close()
        pluginStore.close()
        plugins.close()
        terminal.connection(false); attachments.detached(); media.close()
        generation++; navigation++; openJob?.cancel(); val epoch = generation
        connectionJob?.cancel(); host = pool.links.value[machine.id]?.connection
        mutable.update { it.copy(machine = machine, connection = pool.links.value[machine.id]?.status ?: ConnectionState.Connecting, runtimeStatus = pool.links.value[machine.id]?.connection?.runtimeStatus?.value ?: RuntimeStatus.Unknown, page = "chats", navigationBack = false, session = SessionView(), projects = pool.links.value[machine.id]?.projects.orEmpty(), busy = false, draft = "", pendingSends = emptyList(), error = null) }
        connectionJob = scope.launch {
            pool.links.map { it[machine.id] }.distinctUntilChanged().collectLatest { link ->
                if (epoch != generation) return@collectLatest
                if (host !== link?.connection) { modelPicker.close(clearCache = true); pluginDetails.disconnect(); pluginStore.disconnect(); plugins.disconnect(); voice.stop("Connection to the PC changed. Voice has ended.") }
                host = link?.connection
                mutable.update { it.copy(connection = link?.status ?: ConnectionState.Offline, runtimeStatus = link?.connection?.runtimeStatus?.value ?: RuntimeStatus.Unknown, projects = link?.projects.orEmpty()) }
                terminal.connection(link?.connection != null)
                if (link?.connection != null) {
                    if (link.status == ConnectionState.Connected) modelPicker.prefetch(link.connection) { fetchModels(link.connection) }
                    if (!mutable.value.pluginInChat && mutable.value.page in setOf("plugins", "plugin-store", "plugin-detail")) {
                        when (mutable.value.page) { "plugins" -> bindPlugins(); "plugin-store" -> bindPluginStore(); "plugin-detail" -> bindPluginDetails() }
                    } else if (mutable.value.session.id.isNotBlank()) startOpen(mutable.value.session.id, mutable.value.title, null, navigate = false)
                }
            }
        }
    }
    private suspend fun resolved(connection: HostConnection, result: JSONObject) = dev.zyra.mobile.network.BodyTransfer.resolve(connection, result)
    private fun parseChats(result: JSONObject, machineId: String): List<Chat> {
        val array = result.optJSONArray("chats") ?: JSONArray()
        return (0 until array.length()).map { Chat.parse(array.getJSONObject(it), machineId) }
    }
    private fun publishCatalog() {
        mutable.update { state ->
            val search = searchPages.filter { (id, page) -> (state.machineFilter == null || id == state.machineFilter) && page.query == state.chatQuery }.values
            val visible = ChatCatalog.merge(catalogPages, state.machineFilter, state.chatQuery)
            val currentTitle = ChatTitles.current(catalogPages, state.machine?.id, state.session.id, state.title)
            state.copy(title = currentTitle, searchMatches = search.flatMap { it.matches }, searchIndexing = search.any { it.indexing }, chats = visible,
            nextChatCursor = ChatCatalogPaging.cursor(catalogPages, state.machineFilter, state.chatQuery)) }
    }
    private suspend fun fetchCatalog(machine: Machine, connection: HostConnection, append: Boolean = false) {
        val query = mutable.value.chatQuery
        val previous = catalogPages[machine.id]
        val params = JSONObject().put("limit", 60).put("query", query).put("includeArchived", true)
        if (append) {
            val cursor = previous?.takeIf { it.query == query }?.nextCursor ?: return
            params.put("beforeChat", JSONObject(cursor))
        }
        val response = catalogTransfers.withPermit { resolved(connection, connection.request("catalog.list", params)) }
        if (pool.links.value[machine.id]?.connection !== connection || mutable.value.chatQuery != query) return
        val chats = (if (append) previous?.chats.orEmpty() else emptyList()) + parseChats(response, machine.id)
        catalogPages[machine.id] = ChatPage(chats.distinctBy { it.key }, response.optJSONObject("nextCursor")?.toString(), query)
        publishCatalog()
        refreshCatalogMetadata(machine, connection, query, params, response)
        chats.map { it.project }.distinct().filterNot(::isPersonalChat).forEach { project -> loadProjectArtwork(machine, connection, project) }
        if (query.trim().length >= 2 && !append) {
            val result = catalogTransfers.withPermit { resolved(connection, connection.request("catalog.search", JSONObject().put("query", query))) }
            if (pool.links.value[machine.id]?.connection !== connection || mutable.value.chatQuery != query) return
            val matches = result.optJSONArray("matches") ?: JSONArray()
            searchPages[machine.id] = ChatSearchPage(query, (0 until matches.length()).map { ChatSearchMatch.parse(matches.getJSONObject(it), machine.id) }, result.optBoolean("indexingOlderChats"), result.optBoolean("available", true))
            publishCatalog()
        }
        if (query.isBlank() && !append) withContext(Dispatchers.IO) { cache.put("chats:${machine.id}:list", response.toString()) }
    }
    private val catalogMetadataJobs = linkedMapOf<String, Job>()
    private fun refreshCatalogMetadata(machine: Machine, connection: HostConnection, query: String, params: JSONObject, response: JSONObject) {
        if (!response.optBoolean("metadataPending")) return
        val request = JSONObject(params.toString())
        val key = "${machine.id}:$query:${request.optJSONObject("beforeChat")}"
        catalogMetadataJobs.remove(key)?.cancel()
        while (catalogMetadataJobs.size >= 8) catalogMetadataJobs.remove(catalogMetadataJobs.keys.first())?.cancel()
        fun current() = machinesFor(machine.id) != null && pool.links.value[machine.id]?.connection === connection &&
            mutable.value.chatQuery == query && (mutable.value.machineFilter == null || mutable.value.machineFilter == machine.id)
        if (!current()) return
        val job = scope.launch(start = CoroutineStart.LAZY) {
            try {
                dev.zyra.mobile.network.CatalogMetadataHydration.refresh(response, ::current, {
                    catalogTransfers.withPermit { resolved(connection, connection.request("catalog.list", request)) }
                }, { metadata ->
                    catalogPages[machine.id]?.takeIf { it.query == query }?.let { page ->
                        catalogPages[machine.id] = ChatCatalogMetadata.merge(page, parseChats(metadata, machine.id), metadata.optBoolean("metadataPending"))
                        publishCatalog()
                    }
                })
            } catch (error: CancellationException) { throw error }
            catch (_: Exception) { /* Unknown flags remain unknown; a later catalog read can retry. */ }
        }
        catalogMetadataJobs[key] = job
        job.invokeOnCompletion {
            if (catalogMetadataJobs[key] === job) catalogMetadataJobs.remove(key)
            publishCatalogMetadataLoading()
        }
        job.start()
        publishCatalogMetadataLoading()
    }
    private fun publishCatalogMetadataLoading() {
        mutable.update { it.copy(metadataLoading = catalogMetadataJobs.values.any { job -> job.isActive }) }
    }
    private fun cancelCatalogMetadata() {
        val jobs = catalogMetadataJobs.values.toList()
        catalogMetadataJobs.clear()
        jobs.forEach { it.cancel() }
        publishCatalogMetadataLoading()
    }
    private val catalogJobs = mutableMapOf<String, Job>()
    fun loadProjectArtworkFor(machineId: String, projects: List<String>) {
        val machine = machinesFor(machineId) ?: return
        val link = pool.links.value[machineId] ?: return
        val connection = link.connection ?: return
        projects.filter { it in link.projects }.take(96).filterNot(::isPersonalChat).forEach { loadProjectArtwork(machine, connection, it) }
    }
    private fun loadProjectArtwork(machine: Machine, connection: HostConnection, project: String) {
        val key = "${machine.id}:$project"
        if (artworkJobs[key]?.isActive == true || System.currentTimeMillis() - (artworkChecked[key] ?: 0L) < 300000) return
        artworkChecked[key] = System.currentTimeMillis()
        while (artworkChecked.size > 256) artworkChecked.remove(artworkChecked.keys.first())
        artworkJobs[key] = scope.launch {
            try {
                val result = artworkTransfers.withPermit { connection.request("catalog.project", JSONObject().put("project", project)) }
                if (machinesFor(machine.id) == null || pool.links.value[machine.id]?.connection !== connection) { artworkChecked.remove(key); return@launch }
                val icon = ProjectMark.parse(result)
                if (icon.encoded.isNotBlank() || icon.slug.isNotBlank() || icon.name.isNotBlank()) mutable.update { it.copy(projectArtwork = (it.projectArtwork + (key to icon)).entries.toList().takeLast(96).associate { entry -> entry.toPair() }) }
            } catch (_: Exception) { artworkChecked.remove(key) }
            finally { artworkJobs.remove(key) }
        }
    }
    private fun refreshMachineCatalog(machine: Machine, connection: HostConnection) {
        if (machinesFor(machine.id) == null) return
        catalogJobs.remove(machine.id)?.cancel()
        catalogJobs[machine.id] = scope.launch { try { fetchCatalog(machine, connection) } catch (e: Exception) { if (e !is CancellationException && mutable.value.machineFilter == machine.id) error(e) } }
    }
    private suspend fun refreshChatsNow(selected: HostConnection? = null, append: Boolean = false) = coroutineScope {
        val filter = mutable.value.machineFilter
        mutable.value.machines.filter { filter == null || it.id == filter }.mapNotNull { machine ->
            pool.links.value[machine.id]?.connection?.let { connection -> async { try { fetchCatalog(machine, connection, append) } catch (e: Exception) { if (e !is CancellationException) error(e) else throw e } } }
        }.awaitAll()
        Unit
    }
    private var refreshJob: Job? = null
    private var searchJob: Job? = null
    fun refreshChats() {
        if (refreshJob?.isActive == true) return
        artworkChecked.keys.removeAll { key -> mutable.value.machineFilter == null || key.startsWith("${mutable.value.machineFilter}:") }
        refreshJob = scope.launch {
            mutable.update { it.copy(loadingChats = true) }
            try { refreshChatsNow() } finally { mutable.update { it.copy(loadingChats = false) } }
        }
    }
    fun searchChats(query: String) {
        if (mutable.value.chatQuery != query.take(240)) cancelCatalogMetadata()
        mutable.update { it.copy(chatQuery = query.take(240)) }; publishCatalog()
        searchJob?.cancel(); refreshJob?.cancel()
        searchJob = scope.launch {
            mutable.update { it.copy(loadingChats = true) }
            try { delay(300); refreshChatsNow() } finally { mutable.update { it.copy(loadingChats = false) } }
        }
    }
    fun moreChats() {
        if (mutable.value.loadingChats) return
        refreshJob = scope.launch {
            mutable.update { it.copy(loadingChats = true) }
            try { refreshChatsNow(append = true) } finally { mutable.update { it.copy(loadingChats = false) } }
        }
    }
    fun openSearchMatch(match: ChatSearchMatch) {
        searchContextJob?.cancel()
        mutable.update { it.copy(page = "search-context", navigationBack = false, searchSelection = match, searchContext = emptyList(), searchContextBusy = true, error = null) }
        searchContextJob = scope.launch {
            try {
                val connection = pool.links.value[match.chat.machineId]?.connection ?: throw IllegalStateException("Reconnect to this PC to view the matching conversation.")
                val result = resolved(connection, connection.request("catalog.search.context", JSONObject().put("session", match.chat.id).put("threadId", match.threadId).put("messageId", match.messageId)))
                val messages = result.optJSONArray("messages") ?: JSONArray()
                if (mutable.value.searchSelection?.key == match.key) mutable.update { it.copy(searchContext = (0 until messages.length()).map { i ->
                    val message = messages.getJSONObject(i); TimelineItem(message.getString("id"), message.optString("role"), message.optString("text"))
                }) }
            } catch (e: Exception) { error(e) }
            finally { if (mutable.value.searchSelection?.key == match.key) mutable.update { it.copy(searchContextBusy = false) } }
        }
    }
    fun refreshSession() { val current = mutable.value; if (current.connection == ConnectionState.Connected && current.session.id.isNotBlank()) startOpen(current.session.id, current.title, null) }
    fun open(chat: Chat) {
        if (chat.machineId.isNotBlank() && mutable.value.machine?.id != chat.machineId) machinesFor(chat.machineId)?.let { connect(it) }
        startOpen(chat.id, chat.title, chat.project)
    }
    fun newChat(machineId: String, project: String) {
        createFromDraft(machineId, project, "", "none")
    }
    fun consumeNewChatAction() { mutable.update { it.copy(newChatAction = null) } }
    /** Draft selection is local. Allocate a canonical chat only for Send or a session tool. */
    fun createFromDraft(machineId: String, project: String, draft: String, action: String, runtimeMode: String? = null): Boolean {
        if (runtimeMode != null && runtimeMode !in setOf("approval-required", "auto-review", "edits-only", "full-access")) {
            error(IllegalArgumentException("Choose a valid permission mode.")); return false
        }
        if (mutable.value.page == "chat" && mutable.value.busy) return false
        if (action == "send" && draft.isBlank()) return false
        val machine = machinesFor(machineId) ?: return false
        if (pool.links.value[machineId]?.connection == null) { error(IllegalStateException("Reconnect to ${machine.name} to start a chat.")); return false }
        if (project !in mutable.value.machineProjects[machineId].orEmpty()) { error(IllegalStateException("Choose an available project on ${machine.name}.")); return false }
        if (mutable.value.machine?.id != machineId) connect(machine)
        val intent = listOf(machineId, project, draft.take(60000), runtimeMode.orEmpty())
        val creation = pendingCreation?.takeIf { it.first == intent }?.second ?: UUID.randomUUID().toString()
        pendingCreation = intent to creation
        startOpen(null, "New chat", project, initialDraft = draft.take(60000), entryAction = action, creationId = creation, initialRuntimeMode = runtimeMode)
        return true
    }
    private fun startOpen(id: String?, title: String, project: String?, navigate: Boolean = true, initialDraft: String? = null, entryAction: String? = null, creationId: String? = null, initialRuntimeMode: String? = null) {
        modelPicker.close()
        if (navigate) pluginDetails.close() else pluginDetails.disconnect()
        if (navigate) pluginStore.close() else pluginStore.disconnect()
        if (navigate) plugins.close() else plugins.disconnect()
        if (navigate || id != mutable.value.session.id) dictation.cancel()
        voice.stop()
        chatPreferences.close()
        olderJob?.cancel()
        followingLatest = true
        mutable.update { it.copy(loadingHistory = false) }
        navigation++; openJob?.cancel()
        val previous = mutable.value
        previous.machine?.let { rememberView(it.id, previous.session) }
        val warm = recentViews["${previous.machine?.id}:$id"]
        mutable.update { it.copy(page = if (navigate) "chat" else it.page, navigationBack = if (navigate) false else it.navigationBack, title = title, activeProject = project ?: if (previous.session.id == id) previous.activeProject else "", busy = true, error = null,
            session = warm ?: SessionView(id.orEmpty(), config = ChatConfiguration(runtimeMode = initialRuntimeMode.orEmpty())), draft = initialDraft ?: if (previous.session.id == id) previous.draft else "", pendingSends = emptyList(), newChatAction = null) }
        val openingNavigation = navigation
        val openingMachine = mutable.value.machine?.id
        openJob = scope.launch {
            openSession(id, project, previous, warm, initialDraft, creationId, initialRuntimeMode)
            // Opening the local attachment store is asynchronous, even for a new empty chat.
            // Do not lose the first Send because that store is still restoring.
            if (entryAction == "send" && withTimeoutOrNull(15000L) { attachments.state.first { !it.preparing && !it.uploading } } == null) return@launch
            val current = mutable.value
            if (entryAction != null && NewChatDraft.canContinue(openingNavigation, navigation, openingMachine, current.machine?.id,
                    current.page, current.session.id, current.error, initialDraft.orEmpty(), current.draft)) {
                mutable.update { it.copy(newChatDraftRevision = it.newChatDraftRevision + 1) }
                if (entryAction == "send") send() else if (entryAction in NewChatDraft.tools) mutable.update { it.copy(newChatAction = entryAction) }
            }
        }
    }
    private suspend fun openSession(id: String?, project: String?, previousState: MobileState, warm: SessionView?, initialDraft: String? = null, creationId: String? = null, initialRuntimeMode: String? = null) {
        val draftHydration = DraftHydration(draftRevision)
        val connection = host
        media.close()
        val machineId = mutable.value.machine?.id ?: return
        val epoch = navigation
        var attachedSession: String? = null
        loadingSession = true; earlyEvents.clear(); earlyEventBytes = 0
        try {
            val previous = previousState.session.id
            val previousDraft = previousState.draft
            draftJob?.cancel()
            if (previous.isNotBlank()) withContext(Dispatchers.IO) { cache.put("draft:$machineId:$previous", previousDraft) }
            val cached = warm ?: id?.let { withContext(Dispatchers.IO) { cache.get("session:$machineId:$it") } }?.let { runCatching { TimelineReducer.decode(it) }.getOrNull() }
            val savedDraft = initialDraft ?: if (previous == id) previousDraft else id?.let { withContext(Dispatchers.IO) { cache.get("draft:$machineId:$it") } }.orEmpty()
            if (epoch != navigation || mutable.value.machine?.id != machineId) return
            mutable.update { it.copy(session = cached ?: SessionView(id.orEmpty(), config = ChatConfiguration(runtimeMode = initialRuntimeMode.orEmpty())), draft = draftHydration.restore(draftRevision, it.draft, savedDraft), pendingSends = emptyList()) }
            attachments.open(machineId, id.orEmpty(), null)
            if (id != null) reloadOutbox(machineId, id)
            if (connection == null || mutable.value.connection != ConnectionState.Connected) return
            val params = JSONObject().put("localThreadId", creationId ?: UUID.randomUUID().toString()).put("lastSequence", cached?.sequence ?: 0)
            if (id != null) params.put("session", id) else {
                params.put("project", project)
                // Apply draft permissions at creation, before the first send or session tool.
                initialRuntimeMode?.let { params.put("runtimeMode", it) }
            }
            // Reveal persisted history while Desktop prepares the live runtime.
            // The attachment snapshot still gates sends and reconciles live events.
            val (attached, history) = dev.zyra.mobile.network.SessionHydration.load(id, params, cached?.items.isNullOrEmpty(),
                request = { method, payload -> resolved(connection, if (method == "session.attach") {
                    voice.awaitStopped()
                    if (previous.isNotBlank() && previous != id) runCatching { connection.detachSession(previous) }
                    connection.attachSession(payload).also { attachedSession = it.getString("sessionKey") }
                } else connection.request(method, payload)) },
                preview = { history -> if (id != null && epoch == navigation && host === connection) mutable.update { it.copy(session = TimelineReducer.history(id, history)) } },
                visibleStart = cached?.items?.mapNotNull { it.historyIndex }?.minOrNull(), needsContext = TimelineWindow.needsContext(cached))
            val canonical = attached.getString("canonicalChatId")
            if (creationId != null && pendingCreation?.second == creationId) pendingCreation = null
            var view = if (history != null) TimelineReducer.history(canonical, history) else SessionView(canonical)
            attached.optJSONObject("connected")?.let { view = view.copy(config = view.config.merge(resolved(connection, it))) }
            // The transcript does not yet contain accepted prompts or live maintenance.
            // Restore projected operational envelopes before the attachment watermark.
            val operations = attached.optJSONArray("pendingOperations") ?: JSONArray()
            for (i in 0 until operations.length()) view = TimelineReducer.apply(view, operations.getJSONObject(i), force = true)
            val live = attached.optJSONObject("liveMessage")
            if (live != null) {
                val message = resolved(connection, live)
                view = TimelineReducer.apply(view, JSONObject().put("sequence", attached.optLong("latestSequence")).put("event", JSONObject().put("type", "message_update").put("message", message)), force = true)
            }
            val tools = attached.optJSONArray("pendingTools") ?: JSONArray()
            for (i in 0 until tools.length()) view = TimelineReducer.apply(view, JSONObject().put("sequence", attached.optLong("latestSequence")).put("event", tools.getJSONObject(i)), force = true)
            val attention = attached.optJSONArray("pendingAttention") ?: JSONArray()
            for (i in 0 until attention.length()) view = TimelineReducer.apply(view, JSONObject().put("sequence", attached.optLong("latestSequence")).put("event", resolved(connection, attention.getJSONObject(i))), force = true)
            view = view.copy(sequence = attached.optLong("latestSequence"), running = attached.optJSONObject("activeRequestContext") != null || attached.optJSONObject("presence")?.optString("state") == "running")
            val draft = withContext(Dispatchers.IO) { cache.get("draft:$machineId:$canonical") }.orEmpty()
            if (epoch != navigation || host !== connection || mutable.value.machine?.id != machineId) return
            mutable.update { it.copy(session = view, draft = draftHydration.attached(id, canonical, draftRevision, it.draft, draft)) }
            setDraft(mutable.value.draft)
            dictation.rebind(machineId to canonical, dictationRequest(connection, machineId, canonical))
            if (mutable.value.page == "plugins") bindPlugins()
            if (mutable.value.page == "plugin-store") bindPluginStore()
            if (mutable.value.page == "plugin-detail") bindPluginDetails()
            workspaceRequest()?.let { attachments.open(machineId, canonical, it) }
            reloadOutbox(machineId, canonical)
            reconcileOutbox(connection, machineId, canonical)
            for (event in earlyEvents.toList()) if (event.optString("sessionKey") == canonical) applyEvent(event)
            saveSession()
        } catch (e: Exception) {
            if (epoch == navigation && e is HostFailure && e.code == "CHAT_NOT_VISIBLE") {
                dictation.cancel()
                pluginDetails.close(); pluginStore.close(); plugins.close(); terminal.connection(false); attachments.detached(); media.close()
                mutable.update { it.copy(page = "chats", session = SessionView(), draft = "", pendingSends = emptyList(), detail = null, detailAction = null, detailBusy = false, detailMedia = "") }
            }
            error(e)
        }
        finally {
            attachedSession?.let { session ->
                if (epoch != navigation && connection != null) withContext(NonCancellable) {
                    runCatching { connection.detachSession(session) { host !== connection || mutable.value.session.id != session } }
                }
            }
            if (epoch == navigation) { loadingSession = false; earlyEvents.clear(); earlyEventBytes = 0; mutable.update { it.copy(busy = false) } }
        }
    }
    private fun onEvent(message: JSONObject) {
        val event = message.optJSONObject("event")
        if (message.optString("sessionKey") == mutable.value.session.id && mutable.value.page == "fleet" && (event?.has("fleet") == true || event?.optString("type")?.startsWith("workflow.") == true || event?.optString("type")?.startsWith("agent.") == true)) fleet.changed()
        if (loadingSession) {
            if (earlyEvents.size >= 5000 || earlyEventBytes + message.toString().length * 2 > 1024 * 1024) { host?.close(); error(IllegalStateException("Reconnecting to recover missed activity.")) } else { earlyEvents.add(message); earlyEventBytes += message.toString().length * 2 }
            return
        }
        if (message.optString("sessionKey") == mutable.value.session.id) applyEvent(message)
    }
    private fun applyEvent(message: JSONObject) {
        val old = mutable.value.session
        if (message.optLong("sequence") <= old.sequence) return
        if (message.optLong("firstSequence", message.optLong("sequence")) > old.sequence + 1 && old.sequence > 0) {
            host?.close(); error(IllegalStateException("Reconnecting to recover missed activity.")); return
        }
        mutable.update { it.copy(session = TimelineWindow.trim(TimelineReducer.apply(it.session, message), followingLatest)) }; saveSession()
        val event = message.optJSONObject("event")
        // Only canonical user content confirms delivery. agent_start may precede
        // preflight compaction by minutes; acceptance alone is not a transcript commit.
        MobilePromptDelivery.confirmedOperation(message)?.let { operationId ->
            val machineId = mutable.value.machine?.id
            scope.launch {
                withContext(Dispatchers.IO) { cache.settleSend(operationId, "completed") }
                attachments.completed(operationId)
                machineId?.let { reloadOutbox(it, message.optString("sessionKey")) }
            }
        }
        if (event?.optString("type") == "user_input_requested" && event.has("deferred")) {
            val connection = host ?: return
            val sessionId = mutable.value.session.id
            scope.launch {
                try {
                    val full = resolved(connection, event)
                    mutable.update { state -> if (host === connection && state.session.id == sessionId) state.copy(session = state.session.copy(items = state.session.items.map { item ->
                        if (item.id == event.optString("requestId") && item.pending) item.copy(raw = full.toString()) else item
                    })) else state }
                } catch (e: Exception) { error(e) }
            }
        }
        event?.let(chatPreferences::event)
    }
    private fun saveSession() {
        val current = mutable.value
        val machineId = current.machine?.id ?: return
        val snapshot = TimelineWindow.trim(current.session)
        rememberView(machineId, snapshot)
        saveJob?.cancel()
        saveJob = scope.launch {
            delay(350)
            try { withContext(Dispatchers.IO) { cache.put("session:$machineId:${snapshot.id}", TimelineReducer.encode(snapshot)) } } catch (e: Exception) { error(e) }
        }
    }
    fun send(mode: String = "prompt") {
        if (dictation.state.value.active) return
        val current = mutable.value
        val text = current.draft.trim()
        if (current.session.id.isBlank() && !current.busy && current.page == "chat") {
            current.machine?.id?.let { createFromDraft(it, current.activeProject, current.draft, "send", runtimeMode = current.session.config.runtimeMode.takeIf(String::isNotBlank)) }
            return
        }
        if (voice.state.value.inCall) {
            if (attachments.state.value.items.isNotEmpty()) { error(IllegalStateException("End Voice before sending photos.")); return }
            scope.launch { if (voice.send(text) && mutable.value.machine?.id == current.machine?.id && mutable.value.session.id == current.session.id && mutable.value.draft.trim() == text) setDraft("") }
            return
        }
        val imageIds = attachments.state.value.readyIds
        val imageUploads = attachments.state.value.readyImageIds
        val fileUploads = attachments.state.value.readyFileIds
        if (preparingSend != null || !attachments.state.value.readyToSend) return
        val connection = host ?: return
        val machineId = current.machine?.id ?: return
        val sessionId = current.session.id
        if ((text.isEmpty() && imageIds.isEmpty()) || sessionId.isBlank() || current.connection != ConnectionState.Connected) return
        val operationId = System.currentTimeMillis().toString() + ":" + UUID.randomUUID().toString()
        if (text.isNotBlank() && current.title in listOf("", "New chat", "Untitled chat")) {
            val preview = ChatTitles.initial(current.title, text)
            mutable.update { it.copy(title = preview) }
            catalogPages[machineId]?.let { page -> catalogPages[machineId] = page.copy(chats = page.chats.map { if (it.id == sessionId) it.copy(title = preview) else it }) }
            publishCatalog()
        }
        preparingSend = operationId
        scope.launch {
            try {
                media.seedAttachments(machineId, sessionId, attachments.store, imageUploads)
                withContext(Dispatchers.IO) { cache.recordSend(machineId, sessionId, operationId, text, mode, imageIds) }
                attachments.submitted(imageIds, operationId)
                // Clear only the submitted draft; finishing this turn must not erase subsequent typing.
                if (mutable.value.machine?.id == machineId && mutable.value.session.id == sessionId && mutable.value.draft.trim() == text) setDraft("")
                reloadOutbox(machineId, sessionId)
                if (mode == "prompt") mutable.update { if (it.machine?.id == machineId && it.session.id == sessionId) it.copy(session = it.session.copy(running = true)) else it }
                if (preparingSend == operationId) preparingSend = null
                connection.request("session.request", JSONObject().put("sessionKey", sessionId).put("type", mode).put("payload", JSONObject().put("prompt", text).put("imageUploads", JSONArray(imageUploads)).put("fileUploads", JSONArray(fileUploads))), id = operationId, timeoutMs = if (mode == "prompt") 86400000L else 65000)
                withContext(Dispatchers.IO) { cache.settleSend(operationId, "completed") }; attachments.completed(operationId)
            } catch (e: Exception) {
                withContext(NonCancellable + Dispatchers.IO) { cache.settleSend(operationId, "uncertain") }
                error(e)
            } finally { if (preparingSend == operationId) preparingSend = null; withContext(NonCancellable) { reloadOutbox(machineId, sessionId) } }
        }
    }
    private suspend fun reloadOutbox(machineId: String, sessionId: String) {
        val pending = withContext(Dispatchers.IO) { cache.pending(machineId, sessionId) }
        mutable.update { if (it.machine?.id == machineId && it.session.id == sessionId) it.copy(pendingSends = pending) else it }
    }
    private fun reconcileOutbox(connection: HostConnection, machineId: String, sessionId: String) = scope.launch {
        try {
            val pending = withContext(Dispatchers.IO) { cache.pending(machineId, sessionId) }
            if (pending.isEmpty()) return@launch
            val result = connection.request("operation.status", JSONObject().put("ids", JSONArray(pending.map { it.id }))).getJSONArray("operations")
            withContext(Dispatchers.IO) {
                for (i in 0 until result.length()) {
                    val operation = result.getJSONObject(i)
                    if (operation.optString("state") == "completed") attachments.store.complete(operation.getString("id"))
                    cache.settleSend(operation.getString("id"), when (operation.optString("state")) { "completed" -> "completed"; "running" -> "sending"; else -> "uncertain" })
                }
            }
            reloadOutbox(machineId, sessionId)
        } catch (e: Exception) { error(e) }
    }
    fun reviewPending(send: PendingSend) = scope.launch {
        val images = withContext(Dispatchers.IO) { attachments.store.allForSend(send.id) }
        mutable.update { it.copy(detailMedia = "", detail = send.text + if (images.isNotEmpty()) "\n\nAttachments: " + images.joinToString { image -> image.name } else "", detailTitle = "Message awaiting confirmation") }
    }
    fun dismissPending(send: PendingSend) = scope.launch {
        withContext(Dispatchers.IO) { cache.settleSend(send.id, "completed"); attachments.store.complete(send.id) }
        mutable.value.machine?.id?.let { reloadOutbox(it, mutable.value.session.id) }
    }
    fun openWorkspace() {
        val call = workspaceRequest() ?: return
        workspace.enableReview("turn-review" in host?.capabilities.orEmpty())
        workspace.enableFileMove("file-move" in host?.capabilities.orEmpty())
        page("workspace"); workspace.open("${mutable.value.machine?.id}:${mutable.value.session.id}", call)
    }
    suspend fun machineLimits(machineId: String): JSONObject {
        check(machinesFor(machineId) != null) { "Pair this computer first." }
        val link = pool.links.value[machineId]
        check(link?.status == ConnectionState.Connected) { "Connect to this computer to view its limits." }
        val connection = link?.connection ?: error("Reconnect to this computer.")
        check("account-limits" in connection.capabilities) { "Update Zyra Desktop to view limits on this phone." }
        val result = connection.request("account.limits", JSONObject())
        currentCoroutineContext().ensureActive()
        check(machinesFor(machineId) != null && pool.links.value[machineId]?.connection === connection) { "The computer connection changed. Refresh its limits." }
        return result
    }
    suspend fun localStorageUsage() = withContext(Dispatchers.IO) { cache.storageUsage() }
    suspend fun machineUsage(machineId: String, harness: String): JSONObject {
        check(machinesFor(machineId) != null) { "Pair this computer first." }
        val link = pool.links.value[machineId]
        check(link?.status == ConnectionState.Connected) { "Connect to this computer to view its usage." }
        val connection = link?.connection ?: error("Reconnect to this computer.")
        check("account-usage" in connection.capabilities) { "Update Zyra Desktop to view recorded usage." }
        val result = connection.request("account.usage", JSONObject().put("harness", harness))
        currentCoroutineContext().ensureActive()
        check(machinesFor(machineId) != null && pool.links.value[machineId]?.connection === connection) { "The computer connection changed. Refresh its usage." }
        return result
    }
    suspend fun sessionDetails(): JSONObject {
        val machineId = mutable.value.machine?.id ?: error("Connect a computer first.")
        val sessionId = mutable.value.session.id
        val connection = host ?: error("Reconnect to this computer.")
        check(sessionId.isNotBlank() && "session-details" in connection.capabilities) { "Update Zyra Desktop to view chat details." }
        val result = connection.request("session.details", JSONObject().put("session", sessionId))
        currentCoroutineContext().ensureActive()
        check(host === connection && mutable.value.machine?.id == machineId && mutable.value.session.id == sessionId) { "This chat changed. Reopen its details." }
        return result
    }
    suspend fun clearHistoryStorage(): LocalStorageUsage {
        saveJob?.cancelAndJoin()
        recentViews.clear()
        return withContext(Dispatchers.IO) { cache.clearHistory(); cache.storageUsage() }
    }
    private fun workspaceRequest(): (suspend (String, JSONObject) -> JSONObject)? {
        val machineId = mutable.value.machine?.id ?: return null
        val sessionId = mutable.value.session.id
        if (sessionId.isBlank()) return null
        return { method, params ->
            check(mutable.value.machine?.id == machineId && mutable.value.session.id == sessionId && mutable.value.connection == ConnectionState.Connected) { "Reconnect to this PC first." }
            val connection = host ?: error("Reconnect to your PC.")
            val result = resolved(connection, connection.request(method, params.put("session", sessionId)))
            check(host === connection && mutable.value.machine?.id == machineId && mutable.value.session.id == sessionId) { "The connection changed. Refresh to see the latest state." }
            result
        }
    }
    fun openTerminal() { val call = workspaceRequest() ?: return; page("terminal"); terminal.open(supportsSplit = "terminal-split" in host?.capabilities.orEmpty(), call = call) }
    fun selectPluginMachine(id: String) {
        val machine = machinesFor(id) ?: return
        if (mutable.value.machine?.id != id) connect(machine)
        openPlugins()
    }
    fun openMarkdownFile(destination: String) {
        if ("file-links" !in host?.capabilities.orEmpty()) {
            mutable.update { it.copy(error = "Update Zyra on this PC to open file links.") }; return
        }
        val call = workspaceRequest() ?: return
        workspace.enableReview("turn-review" in host?.capabilities.orEmpty())
        workspace.enableFileMove("file-move" in host?.capabilities.orEmpty())
        page("workspace"); workspace.openLink(destination, "${mutable.value.machine?.id}:${mutable.value.session.id}", call)
    }
    fun openPlugins() { setPluginChatScope(false) }
    fun setPluginChatScope(inChat: Boolean) {
        if (inChat && mutable.value.session.id.isBlank()) return
        mutable.update { it.copy(pluginInChat = inChat) }
        returnToPlugins()
    }
    fun returnToPlugins() { navigatePage("plugins", back = mutable.value.page in setOf("plugin-store", "plugin-detail")); bindPlugins() }
    private fun pluginOwner() = "${mutable.value.machine?.id}:" + if (mutable.value.pluginInChat) mutable.value.session.id else "machine"
    private fun bindPlugins() {
        val connection = host
        val current = mutable.value
        if (current.connection != ConnectionState.Connected || connection == null) {
            plugins.unavailable("Open Zyra on this computer to see its Plugins."); return
        }
        val capability = if (current.pluginInChat) "plugins" else "plugins-machine"
        if (capability !in connection.capabilities) {
            plugins.unavailable("Update Zyra on this computer to manage Plugins from Settings."); return
        }
        val call = pluginRequest() ?: return
        plugins.open(pluginOwner(), call)
    }
    fun openPluginStore() { if (pluginRequest() == null) return; page("plugin-store"); bindPluginStore() }
    private fun bindPluginStore() {
        val call = pluginRequest() ?: return
        pluginStore.open(pluginOwner(), call)
    }
    fun openPluginDetails(id: String) {
        if (pluginRequest() == null) return
        page("plugin-detail"); bindPluginDetails(id)
    }
    private fun bindPluginDetails(id: String = pluginDetails.state.value.pluginId) {
        if (id.isBlank()) return
        val call = pluginRequest() ?: return
        pluginDetails.open(pluginOwner(), id, call)
    }
    private fun pluginRequest(): (suspend (String, JSONObject) -> JSONObject)? {
        val connection = host ?: return null
        val machineId = mutable.value.machine?.id ?: return null
        val inChat = mutable.value.pluginInChat
        val sessionId = mutable.value.session.id.takeIf { inChat }
        if (inChat && sessionId.isNullOrBlank()) return null
        if ((if (inChat) "plugins" else "plugins-machine") !in connection.capabilities) return null
        return { method, params ->
            fun valid() = host === connection && mutable.value.machine?.id == machineId && mutable.value.pluginInChat == inChat &&
                (!inChat || mutable.value.session.id == sessionId) && mutable.value.connection == ConnectionState.Connected
            check(valid()) { "Reconnect to this computer before changing Plugins." }
            val payload = JSONObject(params.toString()).apply {
                remove("session"); remove("scope")
                if (inChat) put("session", sessionId) else put("scope", "machine")
            }
            val result = resolved(connection, connection.request(method, payload))
            check(valid()) { "The connection changed. Refresh Plugins to see the latest state." }
            result
        }
    }
    fun openFleet(kind: String) {
        val machineId = mutable.value.machine?.id ?: return
        val sessionId = mutable.value.session.id
        if (sessionId.isBlank()) return
        page("fleet")
        fleet.open(kind) { type, payload ->
            check(mutable.value.machine?.id == machineId && mutable.value.connection == ConnectionState.Connected) { "Reconnect to this PC first." }
            val connection = host ?: error("Reconnect to your PC.")
            val result = if (type == "definition") connection.request("fleet.definition", payload.put("session", sessionId))
                else connection.request("session.request", JSONObject().put("sessionKey", sessionId).put("type", type).put("payload", payload))
            resolved(connection, result)
        }
    }
    fun stop() = action("abort")
    fun respond(id: String, decision: String) = action("approval.respond", JSONObject().put("requestId", id).put("decision", decision))
    fun answer(id: String, answers: JSONObject, cancelled: Boolean = false) = action("user_input.respond", JSONObject().put("requestId", id).put("answers", answers).put("cancelled", cancelled), longRunning = !cancelled)
    fun configure(field: String, value: Any) = action("configure", JSONObject().put(field, value))
    fun action(type: String, payload: JSONObject = JSONObject(), longRunning: Boolean = false, success: (() -> Unit)? = null) {
        val connection = host ?: return
        val sessionId = mutable.value.session.id
        val requestId = payload.optString("requestId")
        if (requestId.isNotBlank() && mutable.value.responding.contains(requestId)) return
        if (sessionId.isBlank() || mutable.value.connection != ConnectionState.Connected) { error(IllegalStateException("Reconnect to the PC first.")); return }
        if (requestId.isNotBlank()) mutable.update { it.copy(responding = it.responding + requestId) }
        scope.launch {
            try {
                if (longRunning && type != "user_input.respond") mutable.update { it.copy(session = it.session.copy(running = true)) }
                val result = connection.request("session.request", JSONObject().put("sessionKey", sessionId).put("type", type).put("payload", payload), timeoutMs = if (longRunning) 24 * 60 * 60 * 1000L else 65000)
                if (host !== connection || mutable.value.session.id != sessionId) return@launch
                success?.invoke()
                if (type.startsWith("agents.") || type.startsWith("workflows.")) {
                    val full = resolved(connection, result)
                    mutable.update { it.copy(detailMedia = "", detail = FleetController.readable(full), detailTitle = if (type.startsWith("agents.")) "Agents" else "Workflows") }
                }
            } catch (e: Exception) { error(e) }
            finally { mutable.update { it.copy(responding = it.responding - requestId) } }
        }
    }
    fun supportsTitleGeneration() = "title-generation" in host?.capabilities.orEmpty()
    fun regenerateTitle() {
        val state = mutable.value
        val machine = state.machine ?: return
        val connection = host ?: return
        val id = state.session.id
        val key = "${machine.id}:$id"
        if (id.isBlank() || state.busy || state.session.running || state.connection != ConnectionState.Connected || !supportsTitleGeneration() || key in state.regeneratingTitles) return
        mutable.update { it.copy(regeneratingTitles = it.regeneratingTitles + key) }
        scope.launch {
            try {
                val result = connection.request("catalog.regenerateTitle", JSONObject().put("session", id), timeoutMs = 65000)
                val title = BrowserContext.display(result.getString("title"))
                if (pool.links.value[machine.id]?.connection !== connection) return@launch
                catalogPages[machine.id]?.let { page -> catalogPages[machine.id] = page.copy(chats = page.chats.map { if (it.id == id) it.copy(title = title) else it }) }
                publishCatalog()
                mutable.update { if (it.machine?.id == machine.id && it.session.id == id && host === connection) it.copy(title = title) else it }
                if (pool.links.value[machine.id]?.connection === connection) fetchCatalog(machine, connection)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (host === connection && mutable.value.session.id == id) error(e) }
            finally { mutable.update { it.copy(regeneratingTitles = it.regeneratingTitles - key) } }
        }
    }
    fun updateChat(chat: Chat, title: String? = null, archived: Boolean? = null) = scope.launch {
        try {
            val params = JSONObject().put("session", chat.id)
            title?.let { params.put("title", it) }; archived?.let { params.put("archived", it) }
            val machine = machinesFor(chat.machineId) ?: mutable.value.machine ?: return@launch
            val connection = pool.links.value[machine.id]?.connection ?: throw IllegalStateException("Connect to ${machine.name} to change this chat.")
            connection.request("catalog.update", params); fetchCatalog(machine, connection)
        } catch (e: Exception) { error(e) }
    }
    fun timelineFollowing(machineId: String?, sessionId: String, following: Boolean) {
        if (mutable.value.machine?.id != machineId || mutable.value.session.id != sessionId) return
        followingLatest = following
        if (following) mutable.update { it.copy(session = TimelineWindow.trim(it.session)) }
    }
    fun older(keepFollowing: Boolean = false) {
        val state = mutable.value
        if (state.loadingHistory || state.connection != ConnectionState.Connected) return
        val current = state.session; val cursor = current.olderCursor ?: return; val connection = host ?: return
        val epoch = navigation
        if (!keepFollowing) followingLatest = false
        mutable.update { it.copy(loadingHistory = true) }
        olderJob = scope.launch {
            try {
                val history = resolved(connection, connection.request("catalog.history", JSONObject().put("session", current.id).put("before", cursor).put("limit", 40))).getJSONObject("history")
                check(HistoryPageContinuity.accepts(cursor, history)) { "This chat changed while loading earlier messages. Reopen it to refresh its history." }
                val page = TimelineReducer.history(current.id, history)
                mutable.update { if (epoch == navigation && host === connection && it.session.id == current.id && it.session.olderCursor == cursor)
                    it.copy(session = it.session.copy(items = (page.items + it.session.items).distinctBy { item -> item.id }, olderCursor = page.olderCursor)) else it }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (epoch == navigation && host === connection) error(e) }
            finally { if (epoch == navigation && host === connection) mutable.update { it.copy(loadingHistory = false) } }
        }
    }
    fun inspect(item: TimelineItem) { inspectItem(item, null) }
    fun inspectAction(action: WorkAction) { inspectItem(action.item, action) }
    private fun inspectItem(item: TimelineItem, action: WorkAction?) = scope.launch {
        val epoch = ++detailRevision
        val connection = host
        val sessionId = mutable.value.session.id
        fun current() = epoch == detailRevision && host === connection && mutable.value.session.id == sessionId && mutable.value.detail != null
        mutable.update { it.copy(detail = "", navigationBack = false, detailBusy = true, detailAction = null, detailMedia = "", detailTitle = action?.title ?: "Details") }
        try {
            val raw = if (item.raw.isNotBlank()) JSONObject(item.raw) else JSONObject().put("text", item.text)
            val full = when {
                raw.has("historyBodyRef") -> {
                    check(connection != null) { "Reconnect to load the captured source." }
                    resolved(connection, connection.request("catalog.entry.body", JSONObject().put("session", sessionId).put("ref", raw.getJSONObject("historyBodyRef")))).getJSONObject("body").getJSONObject("entry")
                }
                raw.has("deferred") -> { check(connection != null) { "Reconnect to load this output." }; resolved(connection, raw) }
                else -> raw
            }
            if (!current()) return@launch
            val message = full.optJSONObject("message")
            val result = full.optJSONObject("result") ?: full.optJSONObject("partialResult")
            val text = when {
                message?.has("content") == true -> TimelineReducer.text(message.opt("content"))
                result?.has("content") == true -> TimelineReducer.text(result.opt("content"))
                full.has("text") -> full.optString("text")
                action != null -> action.output
                else -> FleetController.readable(full)
            }
            val captured = action?.let {
                WorkActions.project(item.copy(raw = full.toString(), text = it.toolName + "\n" + text), it.toolName to JSONObject(it.arguments), it.batch)
            }
            mutable.update { it.copy(detail = text, detailBusy = false, detailAction = captured, detailMedia = full.toString(), detailTitle = captured?.title ?: if (item.kind in setOf("tool", "deferred")) "Tool output" else "Details") }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { if (current()) mutable.update { it.copy(detail = e.message ?: "This output could not be loaded.", detailBusy = false) } }
    }
    private suspend fun fetchModels(connection: HostConnection): List<AvailableModel> {
        check(host === connection) { "Reconnect to this computer to load models." }
        val result = resolved(connection, connection.request("runtime.models"))
        check(host === connection) { "The computer connection changed." }
        val array = result.optJSONArray("models") ?: JSONArray()
        return (0 until array.length()).map { AvailableModel.parse(array.getJSONObject(it)) }
    }
    fun loadModels() {
        val connection = host ?: return
        val current = mutable.value
        val sessionId = current.session.id
        if (current.page !in setOf("chat", "chat-models") || current.busy || sessionId.isBlank() || current.connection != ConnectionState.Connected) return
        fun checkOwner() { check(host === connection && mutable.value.page in setOf("chat", "chat-models") && mutable.value.session.id == sessionId) { "Open this chat again to change its model." } }
        modelPicker.open(connection, load = { fetchModels(connection) }, configure = { field, value ->
            checkOwner()
            resolved(connection, connection.request("session.request", JSONObject().put("sessionKey", sessionId).put("type", "configure").put("payload", JSONObject().put(field, value))))
            checkOwner()
        })
    }
    override fun close() { pluginDetails.close(); pluginStore.close(); plugins.close(); dictation.cancel(); voice.close(); generation++; navigation++; openJob?.cancel(); connectionJob?.cancel(); pool.close(); media.close(); cache.close(); scope.cancel() }
}




