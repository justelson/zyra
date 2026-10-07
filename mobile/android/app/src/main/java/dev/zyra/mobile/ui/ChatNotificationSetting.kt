package dev.zyra.mobile.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import dev.zyra.mobile.R
import dev.zyra.mobile.notifications.ChatNotificationService

@Composable fun ChatNotificationSetting(vm: MobileSession) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var allowed by remember { mutableStateOf(ChatNotificationService.allowed(context)) }
    val enabled by vm.preferences.notifications.collectAsState()
    var denied by remember { mutableStateOf(false) }
    DisposableEffect(lifecycle, context) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                allowed = ChatNotificationService.allowed(context)
                if (allowed) denied = false
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    fun enable(value: Boolean) {
        vm.preferences.notifications(value)
        if (!value) ChatNotificationService.stop(context)
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        allowed = granted
        denied = !granted
        if (granted) enable(true)
    }
    ZyraSettingRow(R.drawable.ic_bell, "Chat notifications", if (denied) "Allow notifications in Android settings" else "Replies and requests from connected computers", click = if (denied) ({ context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)) }) else null,
        trailing = { ZyraSwitch(enabled && allowed, { value ->
            if (!value) enable(false)
            else if (ChatNotificationService.allowed(context)) enable(true)
            else if (Build.VERSION.SDK_INT >= 33) permission.launch(Manifest.permission.POST_NOTIFICATIONS)
            else denied = true
        }) })
}
