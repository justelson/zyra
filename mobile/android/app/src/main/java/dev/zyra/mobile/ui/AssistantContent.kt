package dev.zyra.mobile.ui

import android.webkit.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import dev.zyra.mobile.data.VisualizationBlocks
import dev.zyra.mobile.data.VisualizationDocument
import dev.zyra.mobile.data.VisualizationPart

@Composable internal fun AssistantContent(text: String, streaming: Boolean = false, turnId: String? = null) {
    val parts = remember(text) { VisualizationBlocks.parse(text) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (part in parts) key(part.start) {
            if (part.state == "text") ResponseTextDisplay(turnId) { Markdown(part.text) }
            else if (part.state == "complete") InlineVisualization(part)
            else Text(if (part.state == "too-large") "Visualization is too large" else "Preparing visualization…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable private fun InlineVisualization(part: VisualizationPart) {
    val colors = MaterialTheme.colorScheme
    fun hex(color: androidx.compose.ui.graphics.Color) = "#%06x".format(color.toArgb() and 0xffffff)
    val document = remember(part.html, colors) { VisualizationDocument.build(part.html.orEmpty(), hex(colors.background), hex(colors.onSurface), hex(colors.onSurfaceVariant), hex(colors.primary), hex(colors.outlineVariant)) }
    var rendererFailed by remember(part.html) { mutableStateOf(false) }
    if (rendererFailed) {
        TextButton(onClick = { rendererFailed = false }) { Text("Reload visualization") }
        return
    }
    if (LocalInspectionMode.current) { Spacer(Modifier.fillMaxWidth().height(part.height.dp)); return }
    AndroidView(modifier = Modifier.fillMaxWidth().height(part.height.dp).clipToBounds(), factory = { context ->
        WebView(context).apply {
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            settings.javaScriptEnabled = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.blockNetworkLoads = true
            settings.domStorageEnabled = false
            settings.setSupportMultipleWindows(false)
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            webViewClient = object : WebViewClient() {
                override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean { rendererFailed = true; return true }
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?) = true
                override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? =
                    if (request?.url?.scheme == "data") null else WebResourceResponse("text/plain", "utf-8", java.io.ByteArrayInputStream(ByteArray(0)))
            }
        }
    }, update = { view ->
        view.contentDescription = part.title
        // Do not reload on message deltas, scrolling or unrelated recomposition.
        if (view.tag != document) { view.tag = document; view.loadDataWithBaseURL(null, document, "text/html", "UTF-8", null) }
    }, onRelease = { it.stopLoading(); it.destroy() })
}
