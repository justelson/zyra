package dev.zyra.mobile.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

val LocalResponseTextDisplayed = staticCompositionLocalOf<(String) -> Unit> { {} }

/** Two frames after layout, while clipped text intersects a focused foreground window. */
@Composable internal fun ResponseTextDisplay(turnId: String?, content: @Composable () -> Unit) {
    val view = LocalView.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val displayed = LocalResponseTextDisplayed.current
    var visible by remember(turnId) { mutableStateOf(false) }
    var foreground by remember { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) && view.hasWindowFocus()) }
    var reported by remember(turnId) { mutableStateOf(false) }
    DisposableEffect(view, lifecycle) {
        fun update() { foreground = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) && view.hasWindowFocus() }
        val observer = LifecycleEventObserver { _, _ -> update() }
        val focus = android.view.ViewTreeObserver.OnWindowFocusChangeListener { update() }
        lifecycle.addObserver(observer); view.viewTreeObserver.addOnWindowFocusChangeListener(focus)
        onDispose { lifecycle.removeObserver(observer); if (view.viewTreeObserver.isAlive) view.viewTreeObserver.removeOnWindowFocusChangeListener(focus) }
    }
    LaunchedEffect(turnId, visible, foreground) {
        if (!reported && turnId != null && visible && foreground) {
            withFrameNanos { }; withFrameNanos { }
            if (visible && foreground && view.isShown && view.hasWindowFocus()) { displayed(turnId); reported = true }
        }
    }
    Box(Modifier.onGloballyPositioned { coordinates ->
        val bounds = coordinates.boundsInWindow()
        val origin = IntArray(2).also(view::getLocationInWindow)
        visible = bounds.width > 0 && bounds.height > 0 && bounds.right > origin[0] && bounds.left < origin[0] + view.width && bounds.bottom > origin[1] && bounds.top < origin[1] + view.height
    }) { content() }
}

internal fun responseTimingTurnId(raw: String): String? = runCatching { org.json.JSONObject(raw).optString("_mobileTurnId").takeIf { it.isNotBlank() } }.getOrNull()
