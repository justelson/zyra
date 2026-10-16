package dev.zyra.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.zyra.mobile.R
import dev.zyra.mobile.data.*

data class ChatListActions(val search: (String) -> Unit, val open: (Chat) -> Unit, val create: () -> Unit, val more: () -> Unit, val update: (Chat, String?, Boolean?) -> Unit, val openMatch: (ChatSearchMatch) -> Unit = {}, val settle: (Chat, Boolean) -> Unit = { _, _ -> })
@Composable fun ChatsScreen(state: MobileState, vm: MobileSession, create: () -> Unit) {
    val appearance by vm.preferences.appearance.collectAsStateWithLifecycle()
    val settlements by vm.preferences.settlements.collectAsStateWithLifecycle()
    LaunchedEffect(state.chats) { vm.preferences.reconcileSettlements(state.chats) }
    ChatsContent(state, appearance, ChatListActions(vm::searchChats, vm::open, create, vm::moreChats, { chat, title, archived -> vm.updateChat(chat, title, archived) }, vm::openSearchMatch, vm::settleChat), settlements)
}
@Composable fun ChatsContent(state: MobileState, appearance: Appearance, actions: ChatListActions, settlements: Map<String, String> = emptyMap()) {
    var filter by rememberSaveable { mutableStateOf("all") }
    var filters by remember { mutableStateOf(false) }
    var rename by remember { mutableStateOf<Chat?>(null) }
    val list = rememberLazyListState()
    var expandedFab by rememberSaveable { mutableStateOf(true) }
    LaunchedEffect(list) {
        var previous = 0 to 0
        snapshotFlow { list.firstVisibleItemIndex to list.firstVisibleItemScrollOffset }.collect { position ->
            if (position.first == 0 && position.second < 12) expandedFab = true
            else if (list.isScrollInProgress && position != previous) expandedFab = position.first < previous.first || (position.first == previous.first && position.second < previous.second)
            previous = position
        }
    }
    val chats = remember(state.chats, filter) { state.chats.filter { chatVisibleInFilter(it, filter) } }
    val matches = remember(state.searchMatches, filter) { state.searchMatches.filter { chatVisibleInFilter(it.chat, filter) } }
    var requestedCursor by remember(state.machineFilter, state.chatQuery, filter) { mutableStateOf<String?>(null) }
    val nearEnd by remember { derivedStateOf {
        val layout = list.layoutInfo
        layout.totalItemsCount > 0 && (layout.visibleItemsInfo.lastOrNull()?.index ?: -1) >= layout.totalItemsCount - 5
    } }
    val unknownMetadata = remember(state.chats, state.searchMatches, filter) {
        (state.chats.asSequence() + state.searchMatches.asSequence().map { it.chat }).any { chat ->
            !chat.archived && when (filter) { "changes", "no-changes" -> chat.hasChanges == null; "no-work" -> chat.hasWork == null; else -> false }
        }
    }
    val waitingMetadata = state.metadataLoading && filter in setOf("changes", "no-changes", "no-work")
    LaunchedEffect(nearEnd, state.nextChatCursor, state.loadingChats, filter, state.machineFilter, state.chatQuery, waitingMetadata) {
        val cursor = state.nextChatCursor
        if (nearEnd && cursor != null && cursor != requestedCursor && !state.loadingChats && !waitingMetadata && state.error == null) {
            requestedCursor = cursor; actions.more()
        }
    }
    val inbox = appearance.sidebar == "v2"
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                ZyraSearchField(state.chatQuery, actions.search, "Search conversations", Modifier.weight(1f))
                IconButton(onClick = { filters = true }) {
                    Box { AppIcon(R.drawable.ic_sliders_horizontal, "Filter chats"); if (filter != "all") Box(Modifier.align(Alignment.TopEnd).size(6.dp).background(MaterialTheme.colorScheme.primary, CircleShape)) }
                }
            }
            LazyColumn(Modifier.weight(1f), state = list, contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 100.dp)) {
                if (chats.isEmpty() && matches.isEmpty() && !waitingMetadata) item {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        AppIcon(if (filter == "attention") R.drawable.ic_check else R.drawable.ic_message_square, modifier = Modifier.size(28.dp))
                        Text(when { state.loadingChats -> "Finding your chats…"; unknownMetadata -> "Conversation details unavailable"; state.chatQuery.isNotBlank() -> "No matching conversations"; filter == "attention" -> "You’re all caught up"; filter == "archived" -> "No archived chats"; filter == "working" -> "Nothing running right now"; filter in setOf("changes", "no-changes", "no-work") -> "No matching conversations"; else -> "Start a conversation" }, style = MaterialTheme.typography.titleLarge)
                        Text(if (unknownMetadata) "Refresh your conversations to check this filter." else if (state.chatQuery.isNotBlank() || filter in setOf("changes", "no-changes", "no-work")) "Try another filter or refresh your conversations." else "Your conversations stay here, ready to continue.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                if (inbox) {
                    val sections = if (state.chatQuery.isBlank() && filter == "all") chatInboxSections(chats, settlements) else listOf("" to chats)
                    sections.forEach { (label, rows) ->
                        if (label.isNotBlank()) item(key = "inbox:$label") { ChatSectionLabel(label) }
                        items(rows, key = { it.key }) { chat ->
                            ChatInboxCard(chat, state.machines.find { it.id == chat.machineId }?.name, state.projectArtwork["${chat.machineId}:${chat.project}"],
                                state.session.id == chat.id && state.machine?.id == chat.machineId, { actions.open(chat) }, { rename = chat }, { actions.update(chat, null, !chat.archived) },
                                settled = ChatSettlement.isSettled(chat, settlements), settle = { actions.settle(chat, !ChatSettlement.isSettled(chat, settlements)) })
                        }
                    }
                } else items(chats, key = { it.key }) { chat -> ChatListRow(chat, state, actions, showProject = true, rename = { rename = chat }) }
                if (matches.isNotEmpty()) {
                    item { ChatSectionLabel("Messages") }
                    items(matches, key = { "match:" + it.key }) { match -> SearchResultRow(match, state.chatQuery) { actions.openMatch(match) } }
                }
                if (state.searchIndexing) item { Text("Older conversations are still being indexed on your PC.", Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                if (state.nextChatCursor != null && state.loadingChats) item {
                    Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) }
                }
                if (state.nextChatCursor != null && state.error != null) item { TextButton(onClick = actions.more, enabled = !state.loadingChats, modifier = Modifier.fillMaxWidth()) { Text("Retry loading chats") } }
            }
        }
        if (waitingMetadata) LinearProgressIndicator(Modifier.align(Alignment.TopCenter).fillMaxWidth().height(2.dp))
        ExtendedFloatingActionButton(onClick = actions.create, expanded = expandedFab, icon = { AppIcon(R.drawable.ic_square_pen, "New chat") }, text = { Text("New chat") },
            shape = RoundedCornerShape(18.dp), containerColor = MaterialTheme.colorScheme.onSurface, contentColor = MaterialTheme.colorScheme.surface,
            modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp))
    }
    if (filters) ZyraSheet("Filter conversations", { filters = false }, footer = {
        ZyraButton(onClick = { filters = false }, modifier = Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium) { Text("Done") }
    }) {
        listOf("all" to "Active chats", "attention" to "Needs you", "working" to "Working", "changes" to "With file changes", "no-changes" to "Without file changes", "no-work" to "Without tool activity", "archived" to "Archived").forEach { (id, label) ->
            ZyraSettingRow(title = label, click = { filter = id }, trailing = { if (filter == id) AppIcon(R.drawable.ic_check, "Selected") })
        }
        if (filter != "all") TextButton(onClick = { filter = "all" }, modifier = Modifier.padding(horizontal = 12.dp)) { Text("Reset filters") }
    }
    rename?.let { chat ->
        var name by remember(chat.key) { mutableStateOf(chat.title) }
        AlertDialog(onDismissRequest = { rename = null }, title = { Text("Rename chat") }, text = { ZyraTextField(name, { name = it.take(240) }, shape = MaterialTheme.shapes.medium, singleLine = true, label = { Text("Name") }) },
            confirmButton = { TextButton(onClick = { actions.update(chat, name, null); rename = null }, enabled = name.isNotBlank()) { Text("Save") } }, dismissButton = { TextButton(onClick = { rename = null }) { Text("Cancel") } })
    }
}
@Composable private fun ChatSectionLabel(title: String) {
    Row(Modifier.fillMaxWidth().padding(start = 10.dp, end = 10.dp, top = 14.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (title == "Recent" || title == "Settled") HorizontalDivider(Modifier.weight(1f), color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .6f))
    }
}
@Composable private fun ChatListRow(chat: Chat, state: MobileState, actions: ChatListActions, inset: Boolean = false, showProject: Boolean = false, rename: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val selected = state.session.id == chat.id && state.machine?.id == chat.machineId
    Row(Modifier.fillMaxWidth().padding(start = if (inset) 18.dp else 0.dp, bottom = 2.dp).clip(RoundedCornerShape(10.dp))
        .background(if (selected) MaterialTheme.colorScheme.surfaceContainer else androidx.compose.ui.graphics.Color.Transparent).clickable { actions.open(chat) }
        .padding(start = 10.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (isPersonalChat(chat.project)) AppIcon(R.drawable.ic_message_square, modifier = Modifier.size(20.dp))
        else ProjectArtwork(state.projectArtwork["${chat.machineId}:${chat.project}"])
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(chat.title, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val details = buildList {
                if (chat.model.isNotBlank()) add(chat.modelLabel)
                if (showProject && !isPersonalChat(chat.project)) add(projectLabel(chat.project, state.projectArtwork["${chat.machineId}:${chat.project}"]))
                if (state.machineFilter == null && state.machines.size > 1) state.machines.find { it.id == chat.machineId }?.let { add(it.name) }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                ChatActivityBadge(chat)
                if (details.isNotEmpty()) Text(details.joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Box {
            IconButton(onClick = { menu = true }) { AppIcon(R.drawable.ic_ellipsis, "Options for " + chat.title, Modifier.size(18.dp)) }
            DropdownMenu(menu, { menu = false }, shape = MaterialTheme.shapes.medium, containerColor = MaterialTheme.colorScheme.surfaceContainer, tonalElevation = 0.dp) {
                DropdownMenuItem(text = { Text("Rename") }, leadingIcon = { AppIcon(R.drawable.ic_pencil) }, onClick = { menu = false; rename() })
                DropdownMenuItem(text = { Text(if (chat.archived) "Restore" else "Archive") }, leadingIcon = { AppIcon(R.drawable.ic_archive) }, onClick = { menu = false; actions.update(chat, null, !chat.archived) })
            }
        }
    }
}
@Composable private fun ChatActivityBadge(chat: Chat) {
    val label = when {
        chat.attention == "approval" -> "Review"
        chat.attention != null -> "Needs you"
        chat.state == "running" -> "Working"
        chat.state == "background" -> "In background"
        else -> return
    }
    val color = if (chat.attention != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    Row(Modifier.clip(CircleShape).background(color.copy(alpha = .09f)).padding(horizontal = 7.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        if (chat.state == "running" && chat.attention == null && !LocalReduceMotion.current)
            CircularProgressIndicator(Modifier.size(8.dp), strokeWidth = 1.dp, color = color)
        else Box(Modifier.size(4.dp).background(color, CircleShape))
        Text(label, style = MaterialTheme.typography.labelSmall, color = color)
    }
}
fun isPersonalChat(path: String): Boolean = path.isBlank() || path.replace('\\', '/').trimEnd('/').endsWith("/assistant/global-workspace")
fun projectLabel(path: String): String = projectLabel(path, null)
fun projectLabel(path: String, artwork: ProjectMark?): String = if (isPersonalChat(path)) "Chats" else displayProjectName(path, artwork)




