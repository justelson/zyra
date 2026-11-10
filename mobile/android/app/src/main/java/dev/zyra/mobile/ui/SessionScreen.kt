@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package dev.zyra.mobile.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import dev.zyra.mobile.voice.VoiceTranscript
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import dev.zyra.mobile.data.*
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import dev.zyra.mobile.R
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.zyra.mobile.voice.VoiceTimeline

@Composable fun SessionScreen(state: MobileState, vm: MobileSession, topInset: androidx.compose.ui.unit.Dp = 0.dp) {
    val reportDisplay = remember(vm) { { id: String -> vm.responseTimings.recorder.displayed(id); Unit } }
    CompositionLocalProvider(LocalResponseTextDisplayed provides reportDisplay, LocalMarkdownImage provides { image -> SessionMarkdownImage(image, state, vm) }, LocalMarkdownOpenFile provides vm::openMarkdownFile, LocalMarkdownCompactImages provides true) {
        SessionContent(state, vm, topInset)
    }
}
@Composable private fun SessionContent(state: MobileState, vm: MobileSession, topInset: androidx.compose.ui.unit.Dp) {
    val voice by vm.voice.state.collectAsStateWithLifecycle()
    val owner = "${state.machine?.id}:${state.session.id}"
    val work = remember(owner) { TimelineWork() }
    val rows = remember(state.session.items, state.session.running, owner) { work.rows(state.session).filterNot { it is ChatRailRow.Message && it.item.kind in setOf("resolved", "user_input_requested") } }
    val pendingSends = remember(state.pendingSends, state.session.items) {
        MobilePromptDelivery.visiblePending(state.pendingSends, state.session.items)
    }
    val questionAnswers = remember(state.session.items) { QuestionResponses.project(state.session.items) }
    val pendingVoice = remember(state.session.items, voice.entries, voice.ownerKey, owner) {
        if (voice.ownerKey == owner) VoiceTimeline.pending(state.session.items, voice.entries) else emptyList()
    }
    LaunchedEffect(owner, state.session.items, voice.entries) { vm.voice.reconcile(owner, state.session.items) }
    val list = key(owner) { rememberLazyListState() }
    val scope = rememberCoroutineScope()
    val dragging by list.interactionSource.collectIsDraggedAsState()
    val reducedMotion = LocalReduceMotion.current
    val density = LocalDensity.current
    var composerHeight by remember { mutableStateOf(76.dp) }
    var jumping by remember(owner) { mutableStateOf(false) }
    val paging = remember(owner) { TimelinePagingGate() }
    var gesture by remember(owner) { mutableIntStateOf(0) }
    var prependCursor by remember(owner) { mutableStateOf<String?>(null) }
    val connected = state.connection == ConnectionState.Connected
    // The full settings/file pages temporarily remove this composition. Restore
    // reading intent along with the list position, never a gesture in progress.
    var scrollIntent by key(owner) {
        rememberSaveable(stateSaver = Saver<TimelineScrollIntent, Boolean>(
            save = { it.followingLatest },
            restore = { TimelineScrollIntent(followingLatest = it) },
        )) { mutableStateOf(TimelineScrollIntent()) }
    }
    val followTail by remember(owner) { derivedStateOf { scrollIntent.followingLatest } }
    var appliedTail by remember(owner) { mutableStateOf<TimelineItem?>(null) }
    var appliedVoice by remember(owner) { mutableStateOf<VoiceTranscript?>(null) }
    var appliedRows by remember(owner) { mutableIntStateOf(-1) }
    val scrollConnection = remember(owner) { object : NestedScrollConnection {
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
            if (source == NestedScrollSource.UserInput) scrollIntent = scrollIntent.userScroll(available.y)
            return Offset.Zero
        }
    } }
    LaunchedEffect(state.machine?.id, state.session.id, followTail) { vm.timelineFollowing(state.machine?.id, state.session.id, followTail) }
    LaunchedEffect(dragging) { if (dragging) { scrollIntent = scrollIntent.copy(followingLatest = false); gesture++ } }
    LaunchedEffect(list, owner) {
        snapshotFlow { Triple(!dragging && !list.isScrollInProgress, !list.canScrollForward, scrollIntent.towardLatest) }
            .collectLatest { (settled, atBottom, towardLatest) ->
                if (settled && towardLatest) scrollIntent = scrollIntent.settled(atBottom)
            }
    }
    val current by rememberUpdatedState(state)
    LaunchedEffect(list, owner) {
        snapshotFlow {
            val viewport = TimelineViewport(list.firstVisibleItemIndex, list.layoutInfo.totalItemsCount, list.canScrollBackward, list.canScrollForward)
            val state = current
            val eligible = state.connection == ConnectionState.Connected &&
                viewport.needsOlder(state.session, followTail, state.busy, state.loadingHistory)
            Triple(gesture, followTail, state.session.olderCursor.takeIf { eligible })
        }.collectLatest { (progress, following, cursor) ->
            if (cursor != null && paging.request(cursor, following, progress)) {
                if (!following) prependCursor = cursor
                vm.older(keepFollowing = following)
            }
        }
    }
    // Apply the tail anchor in the next measure, before cached/history rows are
    // drawn. A suspended post-layout scroll can flash the top of each snapshot.
    SideEffect {
        val previousCursor = prependCursor
        if (previousCursor != null && previousCursor != state.session.olderCursor) {
            // Read geometry from the previous layout immediately before the new
            // rows are measured. The loading indicator is never the anchor.
            val anchor = TimelineAnchor.capture(list.firstVisibleItemIndex, list.firstVisibleItemScrollOffset,
                list.layoutInfo.visibleItemsInfo.map { it.index to it.key.toString() })
            if (!followTail && !list.isScrollInProgress && anchor != null) {
                val keys = buildList {
                    addAll(rows.map { it.id })
                    addAll(pendingSends.map { "pending:" + it.id })
                    addAll(pendingVoice.map { "voice:" + it.id })
                    add("timeline:tail")
                }
                anchor.position(keys)?.let { (index, offset) ->
                    list.requestScrollToItem(index, offset)
                }
            }
            prependCursor = null
        }
        val index = rows.size + pendingSends.size + pendingVoice.size
        val tail = state.session.items.lastOrNull()
        val voiceTail = pendingVoice.lastOrNull()
        if (followTail && !jumping && !dragging && (tail != null || voiceTail != null || pendingSends.isNotEmpty()) &&
            (appliedRows != index || appliedTail != tail || appliedVoice != voiceTail)) {
            appliedRows = index; appliedTail = tail; appliedVoice = voiceTail
            list.requestScrollToItem(index)
        }
    }
    LaunchedEffect(list, owner) {
        snapshotFlow {
            val layout = list.layoutInfo
            val last = layout.visibleItemsInfo.lastOrNull()
            followTail && !jumping && !dragging && !list.isScrollInProgress && layout.totalItemsCount > 0 &&
                (last == null || last.index < layout.totalItemsCount - 1 || last.offset + last.size > layout.viewportEndOffset)
        }.collectLatest { needsTail -> if (needsTail) list.requestScrollToItem((list.layoutInfo.totalItemsCount - 1).coerceAtLeast(0)) }
    }
    val beginReading = {
        scrollIntent = scrollIntent.reading()
        vm.timelineFollowing(state.machine?.id, state.session.id, false)
    }
    CompositionLocalProvider(LocalWorkDisclosure provides beginReading, LocalMarkdownBeforeNavigate provides {
        scrollIntent = scrollIntent.reading()
        vm.timelineFollowing(state.machine?.id, state.session.id, false)
    }) {
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
        LazyColumn(Modifier.fillMaxSize().nestedScroll(scrollConnection), state = list, contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = topInset + 16.dp, bottom = composerHeight + 16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            if (state.session.items.isEmpty() && pendingSends.isEmpty() && pendingVoice.isEmpty() && !state.busy) item {
                Text("What are we working on?", style = MaterialTheme.typography.headlineSmall)
                Text("Work runs on ${state.machine?.name.orEmpty()}.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
            }
            items(rows, key = { it.id }) { row ->
                if (row is ChatRailRow.Work) TimelineWorkSummary(row, vm::inspectAction) { MediaImages(it.raw, vm) }
                else if (row is ChatRailRow.Message) {
                val item = row.item
                when (item.kind) {
                    "approval_requested" -> ApprovalCard(item, connected && item.id !in state.responding, vm)
                    "user_input_requested" -> Unit // The active form lives in the composer.
                    "tool", "deferred" -> { TimelineTool(item) { vm.inspect(item) }; MediaImages(item.raw, vm) }
                    "interrupted" -> Text(item.text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    "resolved" -> Unit // The canonical response renders its question/answer summary.
                    else -> TimelineMessage(item, media = { MediaImages(item.raw, vm) }, questionAnswers = questionAnswers[item.id].orEmpty()) { vm.inspect(item) }
                }
                }
            }
            items(pendingSends, key = { "pending:" + it.id }) { send ->
                PendingSendContent(send, state.machine?.id.orEmpty(), state.session.id, connected, vm)
            }
            items(pendingVoice, key = { "voice:" + it.id }) { VoiceTranscriptMessage(it) }
            item(key = "timeline:tail") { Spacer(Modifier.height(4.dp)) }
        }
        if (state.loadingHistory) {
            Surface(Modifier.align(Alignment.TopCenter).padding(top = topInset + 8.dp), shape = CircleShape,
                color = MaterialTheme.colorScheme.surfaceContainer) {
                CircularProgressIndicator(Modifier.padding(8.dp).size(18.dp), strokeWidth = 2.dp)
            }
        }
        androidx.compose.animation.AnimatedVisibility(!followTail, Modifier.align(Alignment.BottomCenter).padding(bottom = composerHeight + 12.dp),
            enter = fadeIn(androidx.compose.animation.core.tween(if (reducedMotion) 0 else 150)),
            exit = fadeOut(androidx.compose.animation.core.tween(if (reducedMotion) 0 else 150))) {
            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainer, shadowElevation = 4.dp,
                border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                IconButton(enabled = !jumping, onClick = {
                    scope.launch {
                        jumping = true
                        try {
                            val last = (list.layoutInfo.totalItemsCount - 1).coerceAtLeast(0)
                            if (reducedMotion) list.scrollToItem(last) else list.animateScrollToItem(last)
                            scrollIntent = TimelineScrollIntent()
                        } finally { jumping = false }
                    }
                }) { AppIcon(R.drawable.ic_arrow_down, "Jump to latest", Modifier.size(20.dp)) }
            }
        }
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().onSizeChanged { composerHeight = with(density) { it.height.toDp() } }
            .background(Brush.verticalGradient(0f to Color.Transparent, .65f to MaterialTheme.colorScheme.background.copy(alpha = .28f), 1f to MaterialTheme.colorScheme.background))
            .padding(top = 16.dp)) { ChatComposer(state, vm) }
        }
    }
}
}
@Composable private fun ApprovalCard(item: TimelineItem, connected: Boolean, vm: MobileSession) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Approval needed", style = MaterialTheme.typography.titleMedium)
            SelectionContainer { Text(item.text, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyMedium) }
            TextButton(onClick = { vm.inspect(item) }) { Text("Review full request") }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ZyraButton(enabled = connected && item.pending, onClick = { vm.respond(item.id, "acceptOnce") }) { Text("Allow once") }
                ZyraOutlinedButton(enabled = connected && item.pending, onClick = { vm.respond(item.id, "decline") }) { Text("Decline") }
            }
        }
    }
}


