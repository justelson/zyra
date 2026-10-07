package dev.zyra.mobile.notifications

import android.app.*
import android.content.*
import android.content.pm.ServiceInfo
import android.os.*
import dev.zyra.mobile.*
import dev.zyra.mobile.lifecycle.SessionStore
import dev.zyra.mobile.ui.MobileSession
import kotlinx.coroutines.*

/** Background connection ownership only. The shared session owns actual chat alerts. */
class ChatNotificationService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var lease: SessionStore.Lease<MobileSession>? = null
    private val manager get() = getSystemService(NotificationManager::class.java)
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) { lease?.value?.preferences?.notifications(false); stopSelf(); return START_NOT_STICKY }
        if (lease != null) return START_NOT_STICKY
        val owner = (application as ZyraApplication).sessions.acquire(); lease = owner
        if (owner.value.notificationUiVisible() || !owner.value.preferences.notifications.value || !allowed(this)) { stopSelf(); return START_NOT_STICKY }
        manager.createNotificationChannel(NotificationChannel(CONNECTION, "Chat connection", NotificationManager.IMPORTANCE_LOW).apply {
            setSound(null, null); enableVibration(false)
        })
        val stop = PendingIntent.getService(this, 0, Intent(this, javaClass).setAction(STOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val status = Notification.Builder(this, CONNECTION).setSmallIcon(R.drawable.ic_bell).setContentTitle("Zyra connected")
            .setContentText("Connected to your computers in the background").setOngoing(true).setOnlyAlertOnce(true)
            .setSound(null).setVibrate(null).setDefaults(0).setShowWhen(false)
            .addAction(Notification.Action.Builder(null, "Turn off", stop).build()).build()
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(1201, status, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING) else startForeground(1201, status)
        } catch (_: Exception) { owner.value.preferences.notifications(false); stopSelf(); return START_NOT_STICKY }
        owner.value.notificationConnection(true)
        scope.launch {
            while (isActive) {
                if (!allowed(this@ChatNotificationService) || !owner.value.preferences.notifications.value) { stopSelf(); break }
                delay(30000)
            }
        }
        return START_NOT_STICKY
    }
    override fun onDestroy() { scope.cancel(); lease?.value?.notificationConnection(false); lease?.close(); lease = null; stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy() }
    companion object {
        const val OPEN = "dev.zyra.mobile.OPEN_CHAT_ALERT"
        private const val STOP = "dev.zyra.mobile.STOP_CHAT_ALERTS"
        private const val CONNECTION = "chat-connection"
        fun allowed(context: Context) = context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()
        fun start(context: Context): Boolean = runCatching {
            if (!allowed(context)) false else { context.startForegroundService(Intent(context, ChatNotificationService::class.java)); true }
        }.getOrDefault(false)
        fun stop(context: Context) { context.stopService(Intent(context, ChatNotificationService::class.java)) }
    }
}
