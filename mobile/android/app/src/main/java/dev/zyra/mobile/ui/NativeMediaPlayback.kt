package dev.zyra.mobile.ui

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.view.SurfaceHolder
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.io.File

data class PlaybackState(val ready: Boolean = false, val playing: Boolean = false, val position: Int = 0, val duration: Int = 0, val muted: Boolean = false, val failed: Boolean = false, val aspectRatio: Float = 16f / 9f)

/** One native decoder per opened card, independent of the inline/fullscreen surface. */
class NativeMediaPlayback(file: File) {
    private val mutable = MutableStateFlow(PlaybackState())
    val state = mutable.asStateFlow()
    private val player = MediaPlayer()
    private var released = false
    private var surface: SurfaceHolder? = null
    init {
        try {
            player.setAudioAttributes(AudioAttributes.Builder().setContentType(AudioAttributes.CONTENT_TYPE_MOVIE).setUsage(AudioAttributes.USAGE_MEDIA).build())
            player.setOnPreparedListener { if (!released) mutable.update { it.copy(ready = true, duration = player.duration.coerceAtLeast(0), aspectRatio = if (player.videoWidth > 0 && player.videoHeight > 0) player.videoWidth.toFloat() / player.videoHeight else it.aspectRatio) } }
            player.setOnCompletionListener { if (!released) mutable.update { it.copy(playing = false, position = it.duration) } }
            player.setOnErrorListener { _, _, _ -> if (!released) mutable.update { it.copy(failed = true, playing = false) }; true }
            player.setDataSource(file.absolutePath)
            player.prepareAsync()
        } catch (_: Exception) { mutable.update { it.copy(failed = true) } }
    }
    fun surface(holder: SurfaceHolder) { if (!released) { surface = holder; runCatching { player.setDisplay(holder) } } }
    fun detach(holder: SurfaceHolder) { if (!released && surface === holder) { surface = null; runCatching { player.setDisplay(null) } } }
    fun toggle() {
        if (released || !mutable.value.ready || mutable.value.failed) return
        if (mutable.value.playing) pause() else {
            active?.takeUnless { it === this }?.pause()
            active = this
            try {
                if (mutable.value.position >= mutable.value.duration) player.seekTo(0)
                player.start(); mutable.update { it.copy(playing = true) }
            } catch (_: Exception) { mutable.update { it.copy(failed = true, playing = false) } }
        }
    }
    fun pause() { if (!released && mutable.value.ready) { runCatching { player.pause() }; mutable.update { it.copy(playing = false) } } }
    fun seek(position: Int) { if (!released && mutable.value.ready) runCatching { player.seekTo(position.coerceIn(0, mutable.value.duration)) } }
    fun mute() { if (!released) { val muted = !mutable.value.muted; runCatching { player.setVolume(if (muted) 0f else 1f, if (muted) 0f else 1f) }; mutable.update { it.copy(muted = muted) } } }
    fun tick() { if (!released && mutable.value.ready) runCatching { mutable.update { it.copy(position = player.currentPosition.coerceAtLeast(0)) } } }
    fun close() { if (!released) { released = true; if (active === this) active = null; player.release(); surface = null } }
    companion object { private var active: NativeMediaPlayback? = null }
}
