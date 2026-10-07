package dev.zyra.mobile

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.zyra.mobile.ui.*

class MainActivity : ComponentActivity() {
    private val vm by viewModels<MobileViewModel>()
    private val session get() = vm.session
    private val chatNotificationLifecycle by lazy { dev.zyra.mobile.notifications.ChatNotificationLifecycle(
        { session.preferences.notifications.value },
        { dev.zyra.mobile.notifications.ChatNotificationService.start(this); Unit },
        { dev.zyra.mobile.notifications.ChatNotificationService.stop(this) }) }
    private val pairingLink = mutableStateOf("")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); enableEdgeToEdge(); acceptIntent(intent)
        setContent {
            val appearance by session.preferences.appearance.collectAsStateWithLifecycle()
            ZyraTheme(appearance) { ZyraApp(session, pairingLink.value, consumedLink = { pairingLink.value = "" }) }
        }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); acceptIntent(intent) }
    override fun onStart() { super.onStart(); session.foreground(true); chatNotificationLifecycle.foreground() }
    override fun onStop() { chatNotificationLifecycle.background(isChangingConfigurations); session.foreground(false); super.onStop() }
    private fun acceptIntent(intent: Intent) {
        if (intent.action == dev.zyra.mobile.notifications.ChatNotificationService.OPEN) {
            val machine = intent.getStringExtra("machine").orEmpty(); val chat = intent.getStringExtra("chat").orEmpty()
            getSystemService(android.app.NotificationManager::class.java).cancel("$machine:$chat", 1202)
            session.openNotification(machine, chat)
        }
        if (intent.action == Intent.ACTION_VIEW && intent.data?.scheme == "zyra") pairingLink.value = intent.data.toString()
        if (intent.action == Intent.ACTION_SEND && intent.type == "text/plain") session.setDraft(intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty())
    }
}
