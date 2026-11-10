package dev.zyra.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.android.tools.screenshot.PreviewTest
import dev.zyra.mobile.data.*
import dev.zyra.mobile.ui.*
import org.json.JSONObject

@PreviewTest @Preview(widthDp=360,heightDp=760)
@Composable fun ClientDiagnosticsDark() = DiagnosticsPreview("dark")
@PreviewTest @Preview(widthDp=320,heightDp=850,fontScale=1.3f)
@Composable fun ClientDiagnosticsLight() = DiagnosticsPreview("light")
@Composable private fun DiagnosticsPreview(mode: String) {
    ZyraTheme(Appearance(mode=mode)) { Surface {
        ResponseTimingsContent(listOf(JSONObject().put("turnId", "fixture").put("outcome", "completed").put("firstTextReceivedMs", 17540).put("firstDisplayMs",18120)), false, {}, {})
    } }
}
@PreviewTest @Preview(widthDp=360,heightDp=740)
@Composable fun ClientMediaStates() {
    ZyraTheme(Appearance(mode="dark")) { Surface { Column(Modifier.fillMaxSize().padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        Text("Media", style=MaterialTheme.typography.titleLarge)
        Surface(color=MaterialTheme.colorScheme.surfaceContainer,shape=MaterialTheme.shapes.medium) {
            ChatMediaPlayerContent(PlaybackState(ready=true,position=24000,duration=98000),true,"Browser recording",false,{},{},{},{},{}) {
                Box(Modifier.fillMaxSize().background(Color(0xff172634)))
            }
        }
        Surface(color=MaterialTheme.colorScheme.surfaceContainer,shape=MaterialTheme.shapes.medium) {
            ChatMediaPlayerContent(PlaybackState(ready=true,playing=true,position=16000,duration=42000),false,"Audio preview",false,{},{},{},{},{}) {}
        }
        Surface(color=MaterialTheme.colorScheme.surfaceContainer,shape=MaterialTheme.shapes.medium) {
            ChatMediaPlayerContent(PlaybackState(failed=true),false,"Unsupported media",false,{},{},{},{},{}) {}
        }
    } } }
}

@PreviewTest @Preview(widthDp=360,heightDp=640)
@Composable fun ClientCaptureLibrary() {
    ZyraTheme(Appearance(mode="dark")) { Surface { Column(Modifier.fillMaxSize().padding(20.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text("Browser captures",style=MaterialTheme.typography.titleLarge)
        Text("Workstation", style=MaterialTheme.typography.bodyMedium)
        BrowserCaptureRow(BrowserCapture("one",false,"image/png",126400,"2026-11-10T14:05:00Z"),false,{},{})
        BrowserCaptureRow(BrowserCapture("two",true,"video/webm",4352000,"2026-11-10T14:00:00Z"),false,{},{})
    } } }
}
