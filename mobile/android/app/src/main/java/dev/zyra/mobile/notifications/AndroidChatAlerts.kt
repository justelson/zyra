package dev.zyra.mobile.notifications

import android.app.*
import android.content.*
import android.media.AudioAttributes
import android.media.RingtoneManager
import dev.zyra.mobile.MainActivity
import dev.zyra.mobile.R
import dev.zyra.mobile.data.Chat
import dev.zyra.mobile.ui.MobileSession
import kotlinx.coroutines.CoroutineScope
import org.json.JSONObject

/** Native delivery is separate from observing chats and keeping a connection alive. */
class AndroidChatAlerts(private val context: Context, scope: CoroutineScope, owner: MobileSession) {
    private val manager = context.getSystemService(NotificationManager::class.java)
    private val prefs = context.getSharedPreferences("chat-alert-receipts", Context.MODE_PRIVATE)
    private val seen = linkedMapOf<String, String>()
    init {
        val saved = runCatching { JSONObject(prefs.getString("seen", "{}")!!) }.getOrDefault(JSONObject())
        saved.keys().forEach { seen[it] = saved.optString(it) }
        ChatAlertMonitor(scope, owner.notificationChanges, owner.preferences.notifications,
            ChatAlertPolicy(seen, System.currentTimeMillis()),
            { owner.notificationMonitoringActive() && ChatNotificationService.allowed(context) },
            owner::notificationChats, owner::visibleChatKey, ::notify,
            { prefs.edit().putString("seen", JSONObject(seen as Map<*, *>).toString()).apply() })
    }
    private fun notify(chat: Chat, message: String) {
        manager.createNotificationChannel(NotificationChannel(ALERTS, "Chat responses and requests", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Heads-up alerts for replies, approvals, questions, and errors"
            enableVibration(true); vibrationPattern = longArrayOf(0, 180, 80, 240)
            setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT).build())
        })
        val intent = Intent(context, MainActivity::class.java).setAction(ChatNotificationService.OPEN)
            .setData(android.net.Uri.Builder().scheme("zyra-alert").authority("chat").appendPath(chat.machineId).appendPath(chat.id).build())
            .putExtra("machine", chat.machineId).putExtra("chat", chat.id)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val open = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val alert = Notification.Builder(context, ALERTS).setSmallIcon(R.drawable.ic_bell).setContentTitle(chat.title)
            .setContentText(message).setContentIntent(open).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_SOUND or Notification.DEFAULT_VIBRATE)
            .setCategory(if (chat.attention != null) Notification.CATEGORY_REMINDER else Notification.CATEGORY_MESSAGE).build()
        manager.notify(chat.key, 1202, alert)
    }
    companion object { private const val ALERTS = "chat-alerts-v2" }
}
