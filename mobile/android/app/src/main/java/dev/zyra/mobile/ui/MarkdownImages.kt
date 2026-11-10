package dev.zyra.mobile.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.zyra.mobile.R
import dev.zyra.mobile.data.MarkdownDocument
import kotlinx.coroutines.CancellationException
import org.commonmark.node.Image
import org.json.JSONObject
import java.io.File

val LocalMarkdownImage = staticCompositionLocalOf<@Composable (Image) -> Unit> { { MarkdownImageLink(it) } }

@Composable private fun MarkdownImageLink(image: Image) {
    val uri = LocalUriHandler.current
    val external = image.destination.startsWith("https://", ignoreCase = true) || image.destination.startsWith("http://", ignoreCase = true)
    if (external) { RemoteMarkdownImage(image.destination, MarkdownDocument.imageAlt(image), LocalRemoteImageOwner.current); return }
    if (LocalMarkdownCompactImages.current) {
        Surface(onClick = { if (external) runCatching { uri.openUri(image.destination) } }, enabled = external,
            modifier = Modifier.fillMaxSize(), shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
            Box(contentAlignment = Alignment.Center) { AppIcon(R.drawable.ic_external_link, "Open image: ${MarkdownDocument.imageAlt(image)}", Modifier.size(22.dp)) }
        }; return
    }
    TextButton(onClick = { if (external) runCatching { uri.openUri(image.destination) } }, enabled = external) {
        AppIcon(R.drawable.ic_camera, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp)); Text(MarkdownDocument.imageAlt(image), maxLines = 2)
        if (external) { Spacer(Modifier.width(8.dp)); AppIcon(R.drawable.ic_external_link, "Open image in browser", Modifier.size(14.dp)) }
    }
}

private data class InlineImage(val ref: JSONObject? = null, val file: File? = null, val error: String? = null, val loading: Boolean = true)

@Composable fun SessionMarkdownImage(image: Image, state: MobileState, vm: MobileSession, rootId: String? = null, basePath: String? = null) {
    if (isPlaybackDestination(image.destination) && !image.destination.startsWith("https://", true) && !image.destination.startsWith("http://", true)) {
        ChatMediaCard(image.destination, MarkdownDocument.imageAlt(image), state, vm, rootId, basePath); return
    }
    if (image.destination.startsWith("https://", ignoreCase = true) || image.destination.startsWith("http://", ignoreCase = true)) {
        RemoteMarkdownImage(image.destination, MarkdownDocument.imageAlt(image), "${state.machine?.id}:${state.session.id}:${state.page}:${rootId.orEmpty()}:${basePath.orEmpty()}"); return
    }
    val revision by vm.media.cacheRevision.collectAsStateWithLifecycle()
    var retry by remember(image.destination) { mutableIntStateOf(0) }
    val selected by produceState(InlineImage(), state.machine?.id, state.session.id, state.connection, image.destination, revision, retry, rootId, basePath) {
        value = InlineImage()
        try { val (ref, file) = vm.markdownImage(image.destination, rootId, basePath); value = InlineImage(ref, file, loading = false) }
        catch (error: Exception) { if (error is CancellationException) throw error; value = InlineImage(error = error.message ?: "Image unavailable", loading = false) }
    }
    MarkdownImageCard(MarkdownDocument.imageAlt(image), selected.file, selected.loading, selected.error,
        selected.ref?.optLong("bytes"), { selected.ref?.let(vm::openImage) ?: run { retry++ } })
}
@Composable fun WorkspaceMarkdownImage(image: Image, vm: MobileSession) {
    val state by vm.state.collectAsStateWithLifecycle()
    val workspace by vm.workspace.state.collectAsStateWithLifecycle()
    SessionMarkdownImage(image, state, vm, workspace.root, workspace.file?.path?.substringBeforeLast('/', "") ?: workspace.path)
}

@Composable fun MarkdownImageCard(description: String, file: File?, loading: Boolean, error: String?, bytes: Long?, open: () -> Unit) {
    val compact = LocalMarkdownCompactImages.current
    if (compact) {
        Surface(onClick = open, enabled = !loading, shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer,
            modifier = Modifier.fillMaxSize().semantics { contentDescription = description }) {
            Box(contentAlignment = Alignment.Center) {
                if (file != null) LocalImage(file, description, 256, Modifier.fillMaxSize().padding(3.dp))
                else if (loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 1.5.dp)
                else AppIcon(if (error != null) R.drawable.ic_refresh_cw else R.drawable.ic_arrow_down, if (error != null) "Retry image" else "Open image", Modifier.size(21.dp))
            }
        }; return
    }
    Surface(onClick = open, enabled = !loading, shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth()) {
        if (file != null) LocalImage(file, description, 768, Modifier.fillMaxWidth().height(220.dp).padding(4.dp))
        else Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 1.5.dp) else AppIcon(R.drawable.ic_camera, modifier = Modifier.size(20.dp))
            Column(Modifier.weight(1f)) {
                Text(description, style = MaterialTheme.typography.labelLarge, maxLines = 2)
                if (!loading) Text(error ?: "Tap to load · ${(bytes ?: 0) / 1024} KB", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3)
            }
            if (!loading) AppIcon(if (error != null) R.drawable.ic_refresh_cw else R.drawable.ic_arrow_down, if (error != null) "Retry image" else "Open image", Modifier.size(16.dp))
        }
    }
}

