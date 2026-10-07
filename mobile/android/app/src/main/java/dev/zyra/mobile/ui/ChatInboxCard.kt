package dev.zyra.mobile.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.zyra.mobile.R
import dev.zyra.mobile.data.*
import java.time.Instant

/** Fixed clock for native previews; production updates only visible working pills. */
internal val LocalChatStatusNow = staticCompositionLocalOf<Long?> { null }

/** Desktop inbox hierarchy; explicit settled turns use a quieter, inset two-line row. */
@Composable fun ChatInboxCard(chat: Chat, machineName: String?, artwork: ProjectMark?, selected: Boolean, open: () -> Unit, rename: () -> Unit, archive: () -> Unit, settled: Boolean = false, settle: (() -> Unit)? = null) {
    val colors = MaterialTheme.colorScheme
    val active = chat.working || chat.attention != null
    Surface(onClick = open, shape = RoundedCornerShape(12.dp),
        color = when { selected -> colors.surfaceContainer; active -> colors.primary.copy(alpha = .045f); else -> Color.Transparent },
        border = if (active) BorderStroke(1.dp, colors.primary.copy(alpha = .15f)) else null,
        modifier = Modifier.fillMaxWidth().padding(start = if (settled) 12.dp else 0.dp, end = if (settled) 6.dp else 0.dp, bottom = if (active) 8.dp else 4.dp)) {
        if (settled) Row(Modifier.padding(start = 10.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
            ChatProjectArtwork(chat, artwork)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(chat.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(listOf(projectLabel(chat.project, artwork), chat.modelLabel, machineName.orEmpty()).filter { it.isNotBlank() }.joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (chat.tuiOpen) AppIcon(R.drawable.ic_terminal, "Open in terminal", Modifier.size(14.dp))
            ChatInboxMenu(chat, true, settle, rename, archive)
        } else Column(Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                ChatProjectArtwork(chat, artwork)
                Text(if (isPersonalChat(chat.project)) "Chat" else projectLabel(chat.project, artwork), Modifier.weight(1f), style = MaterialTheme.typography.labelMedium,
                    color = colors.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                ChatInboxStatus(chat)
                ChatInboxMenu(chat, false, settle, rename, archive)
            }
            Text(chat.title, Modifier.padding(end = 12.dp), style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(Modifier.fillMaxWidth().padding(top = 4.dp, end = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(listOfNotNull(chat.modelLabel, machineName?.takeIf { it.isNotBlank() }).joinToString(" · "), Modifier.weight(1f),
                    style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (chat.tuiOpen) AppIcon(R.drawable.ic_terminal, "Open in terminal", Modifier.size(14.dp))
            }
        }
    }
}

@Composable private fun ChatProjectArtwork(chat: Chat, artwork: ProjectMark?) {
    if (isPersonalChat(chat.project)) AppIcon(R.drawable.ic_message_square, modifier = Modifier.size(18.dp)) else ProjectArtwork(artwork)
}

@Composable private fun ChatInboxMenu(chat: Chat, settled: Boolean, settle: (() -> Unit)?, rename: () -> Unit, archive: () -> Unit) {
    var menu by remember(chat.key) { mutableStateOf(false) }
    Box {
        IconButton({ menu = true }, Modifier.size(40.dp)) { AppIcon(R.drawable.ic_ellipsis, "Options for ${chat.title}", Modifier.size(17.dp)) }
        DropdownMenu(menu, { menu = false }, shape = MaterialTheme.shapes.medium, containerColor = MaterialTheme.colorScheme.surfaceContainer, tonalElevation = 0.dp) {
            if (settle != null && (settled || ChatSettlement.marker(chat) != null)) DropdownMenuItem(text = { Text(if (settled) "Move to recent" else "Settle chat") },
                leadingIcon = { AppIcon(if (settled) R.drawable.ic_arrow_up else R.drawable.ic_check) }, onClick = { menu = false; settle() })
            DropdownMenuItem(text = { Text("Rename") }, leadingIcon = { AppIcon(R.drawable.ic_pencil) }, onClick = { menu = false; rename() })
            DropdownMenuItem(text = { Text(if (chat.archived) "Restore" else "Archive") }, leadingIcon = { AppIcon(R.drawable.ic_archive) }, onClick = { menu = false; archive() })
        }
    }
}

@Composable private fun ChatInboxStatus(chat: Chat) {
    val fixedNow = LocalChatStatusNow.current
    var now by remember(chat.key, chat.activeTurnStartedAt) { mutableLongStateOf(fixedNow ?: System.currentTimeMillis()) }
    LaunchedEffect(chat.working, chat.activeTurnStartedAt, fixedNow) {
        if (fixedNow == null && chat.working && chat.activeTurnStartedAt.isNotBlank()) while (true) {
            now = System.currentTimeMillis(); kotlinx.coroutines.delay(1000)
        }
    }
    val label = when {
        chat.attention == "approval" -> "Review"
        chat.attention != null -> "Input needed"
        chat.working -> listOfNotNull(if (chat.state == "background") "Background" else "Working", chatWorkingDuration(chat, fixedNow ?: now)).joinToString(" · ")
        chat.lastTurnState in setOf("failed", "error") -> "Failed"
        chat.lastTurnState == "interrupted" && chat.lastTurnId != chat.lastSeenCompletedTurnId -> "Stopped"
        chat.lastTurnState == "completed" && chat.lastTurnId != chat.lastSeenCompletedTurnId -> "Done"
        else -> relativeChatTime(chat.modifiedAt)
    }
    if (label.isEmpty()) return
    val active = chat.working || chat.attention != null
    val color = when { active -> MaterialTheme.colorScheme.primary; chat.lastTurnState in setOf("failed", "error") -> MaterialTheme.colorScheme.error; else -> MaterialTheme.colorScheme.onSurfaceVariant }
    Row(if (active) Modifier.background(color.copy(alpha = .12f), CircleShape).padding(horizontal = 8.dp, vertical = 5.dp) else Modifier,
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        if (chat.working && chat.attention == null && !LocalReduceMotion.current) CircularProgressIndicator(Modifier.size(9.dp), strokeWidth = 1.dp, color = color)
        Text(label, style = MaterialTheme.typography.labelSmall, color = color, maxLines = 1)
    }
}
fun relativeChatTime(timestamp: String, now: Long = System.currentTimeMillis()): String {
    val time = runCatching { Instant.parse(timestamp).toEpochMilli() }.getOrNull() ?: return ""
    val minutes = ((now - time).coerceAtLeast(0) / 60000)
    return when { minutes < 1 -> "Now"; minutes < 60 -> "${minutes}m"; minutes < 1440 -> "${minutes / 60}h"; minutes < 10080 -> "${minutes / 1440}d"; else -> "${minutes / 10080}w" }
}
