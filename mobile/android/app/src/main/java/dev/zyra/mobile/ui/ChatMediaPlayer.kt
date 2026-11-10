package dev.zyra.mobile.ui

import android.view.SurfaceHolder
import android.view.SurfaceView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.zyra.mobile.R
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File

private val playbackExtensions = setOf("mp4", "m4v", "webm", "ogv", "mp3", "m4a", "wav", "ogg", "opus", "flac", "weba")
fun isPlaybackDestination(destination: String): Boolean = destination.substringBefore('?').substringBefore('#').substringAfterLast('.').lowercase() in playbackExtensions

@Composable fun ChatMediaCard(destination: String, description: String, state: MobileState, vm: MobileSession, rootId: String? = null, basePath: String? = null) {
    val owner = "${state.machine?.id}:${state.session.id}:$destination:$rootId:$basePath"
    key(owner) {
        var file by remember { mutableStateOf<File?>(null) }
        var mime by remember { mutableStateOf("") }
        var loading by remember { mutableStateOf(false) }
        var progress by remember { mutableIntStateOf(0) }
        var error by remember { mutableStateOf<String?>(null) }
        val scope = rememberCoroutineScope()
        Surface(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
            Column {
                if (file != null) ChatMediaPlayer(file!!, mime.startsWith("video/"), description)
                else Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    AppIcon(R.drawable.ic_play, modifier = Modifier.size(20.dp))
                    Column(Modifier.weight(1f)) {
                        Text(description.ifBlank { "Audio or video" }, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelLarge)
                        if (error != null) Text(error!!, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                        if (loading) LinearProgressIndicator(progress = { progress / 100f }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                    }
                    TextButton(enabled = !loading && state.connection == dev.zyra.mobile.data.ConnectionState.Connected, onClick = {
                        loading = true; error = null
                        scope.launch {
                            try {
                                val loaded = vm.playbackMedia(destination, rootId, basePath) { offset, total -> progress = (offset * 100 / total).toInt() }
                                mime = loaded.first.optString("mimeType"); file = loaded.second
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (failure: Exception) { error = failure.message ?: "Media unavailable" }
                            finally { loading = false }
                        }
                    }) { Text(if (loading) "$progress%" else if (error != null) "Retry" else "Load") }
                }
            }
        }
    }
}

@Composable fun ChatMediaPlayer(file: File, video: Boolean, description: String) {
    var retry by remember(file) { mutableIntStateOf(0) }
    val playback = remember(file, retry) { NativeMediaPlayback(file) }
    val state by playback.state.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var fullscreen by remember(file) { mutableStateOf(false) }
    DisposableEffect(playback, lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) playback.pause() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); playback.close() }
    }
    LaunchedEffect(playback, state.playing) { while (state.playing) { playback.tick(); delay(250) } }
    @Composable fun Content() {
        ChatMediaPlayerContent(state, video, description, fullscreen, { fullscreen = !fullscreen }, playback::toggle, playback::seek, playback::mute, { retry++ }) {
            AndroidView(modifier = Modifier.fillMaxSize(), factory = { context -> SurfaceView(context).apply {
                    holder.addCallback(object : SurfaceHolder.Callback {
                        override fun surfaceCreated(holder: SurfaceHolder) { playback.surface(holder) }
                        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) { playback.surface(holder) }
                        override fun surfaceDestroyed(holder: SurfaceHolder) { playback.detach(holder) }
                    })
                } })
        }
    }
    if (fullscreen) Dialog({ fullscreen = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth(), color = Color.Black) { Content() }
    } else Content()
}

@Composable internal fun ChatMediaPlayerContent(state: PlaybackState, video: Boolean, description: String, fullscreen: Boolean,
    expand: () -> Unit, toggle: () -> Unit, seek: (Int) -> Unit, mute: () -> Unit, retry: () -> Unit, footage: @Composable () -> Unit) {
        Column(Modifier.fillMaxWidth()) {
            if (video) Box(Modifier.fillMaxWidth().aspectRatio(state.aspectRatio.coerceIn(.4f, 3f)).background(Color.Black)) {
                footage()
                IconButton(expand, Modifier.align(Alignment.TopEnd)) {
                    CompositionLocalProvider(LocalContentColor provides Color.White) { AppIcon(if (fullscreen) R.drawable.ic_x else R.drawable.ic_fullscreen, if (fullscreen) "Close fullscreen" else "Fullscreen") }
                }
            }
            if (state.failed) Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("This format couldn't be played.", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                TextButton(retry) { Text("Retry") }
            } else Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(toggle, enabled = state.ready) {
                    if (!state.ready) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 1.5.dp)
                    else AppIcon(if (state.playing) R.drawable.ic_pause else R.drawable.ic_play, if (state.playing) "Pause" else "Play")
                }
                Column(Modifier.weight(1f)) {
                    if (!video) Text(description, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelMedium)
                    Slider(state.position.toFloat().coerceIn(0f, state.duration.coerceAtLeast(1).toFloat()), { seek(it.toInt()) }, valueRange = 0f..state.duration.coerceAtLeast(1).toFloat(), enabled = state.ready && state.duration > 0, modifier = Modifier.height(32.dp))
                }
                fun time(ms: Int) = "${ms / 60000}:${(ms / 1000 % 60).toString().padStart(2, '0')}"
                Text("${time(state.position)} / ${time(state.duration)}", Modifier.padding(horizontal = 6.dp), style = MaterialTheme.typography.labelSmall)
                IconButton(mute) { AppIcon(R.drawable.ic_volume_2, if (state.muted) "Unmute" else "Mute", Modifier.size(18.dp)) }
            }
        }
    }
