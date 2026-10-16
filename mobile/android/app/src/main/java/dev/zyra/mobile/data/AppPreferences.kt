package dev.zyra.mobile.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class Appearance(val mode: String = "system", val dark: String = "vercel", val light: String = "paper-light", val reduceMotion: Boolean = false, val sidebar: String = "v2", val font: String = "bricolage", val timestamps: Boolean = false, val workDetails: Boolean = true, val actionCounts: Boolean = false, val thoughtProcesses: Boolean = false, val collapseActiveWork: Boolean = false)
class AppPreferences(context: Context) {
    private val prefs = context.getSharedPreferences("appearance-navigation", Context.MODE_PRIVATE)
    private val mutable = MutableStateFlow(Appearance(prefs.getString("mode", "system")!!, prefs.getString("dark", "vercel").takeUnless { it == "dark" } ?: "vercel", prefs.getString("light", "paper-light")!!, prefs.getBoolean("reduceMotion", false), prefs.getString("sidebar", "v2")!!, prefs.getString("font", "bricolage")!!, prefs.getBoolean("timestamps", false), prefs.getBoolean("workDetailsV2", true), prefs.getBoolean("actionCounts", false), prefs.getBoolean("thoughtProcesses", false), prefs.getBoolean("collapseActiveWork", false)))
    val appearance = mutable.asStateFlow()
    private val notificationsMutable = MutableStateFlow(prefs.getBoolean("notifications", false))
    val notifications = notificationsMutable.asStateFlow()
    fun notifications(enabled: Boolean) { notificationsMutable.value = enabled; prefs.edit().putBoolean("notifications", enabled).apply() }
    private val settledMutable = MutableStateFlow(ChatSettlement.decode(prefs.getString("settledTurns", "{}").orEmpty()))
    val settlements = settledMutable.asStateFlow()
    private fun saveSettlements(value: Map<String, String>) {
        if (value == settledMutable.value) return
        settledMutable.value = value
        prefs.edit().putString("settledTurns", ChatSettlement.encode(value)).apply()
    }
    fun setChatSettled(chat: Chat, settled: Boolean) = saveSettlements(ChatSettlement.update(settledMutable.value, chat, settled))
    fun reconcileSettlements(chats: List<Chat>) = saveSettlements(ChatSettlement.reconcile(settledMutable.value, chats))
    fun forgetSettlement(key: String) = saveSettlements(settledMutable.value - key)

    private val voiceMutable = MutableStateFlow(dev.zyra.mobile.voice.VoiceChoice.resolve(prefs.getString("voice", "cove")).id)
    val voice = voiceMutable.asStateFlow()
    private val dictationMutable = MutableStateFlow(prefs.getBoolean("dictation", false))
    val dictation = dictationMutable.asStateFlow()
    private val optimizePhotosMutable = MutableStateFlow(prefs.getBoolean("optimizePhotos", true))
    val optimizePhotos = optimizePhotosMutable.asStateFlow()
    fun optimizePhotos(enabled: Boolean) { optimizePhotosMutable.value = enabled; prefs.edit().putBoolean("optimizePhotos", enabled).apply() }
    fun enableDictation(enabled: Boolean) { dictationMutable.value = enabled; prefs.edit().putBoolean("dictation", enabled).apply() }
    fun selectVoice(id: String) {
        val selected = dev.zyra.mobile.voice.VoiceChoice.resolve(id).id
        voiceMutable.value = selected
        prefs.edit().putString("voice", selected).apply()
    }
    fun update(value: Appearance) {
        mutable.value = value
        prefs.edit().putString("mode", value.mode).putString("dark", value.dark).putString("light", value.light).putBoolean("reduceMotion", value.reduceMotion).putString("sidebar", value.sidebar).putString("font", value.font).putBoolean("timestamps", value.timestamps).putBoolean("workDetailsV2", value.workDetails).putBoolean("actionCounts", value.actionCounts).putBoolean("thoughtProcesses", value.thoughtProcesses).putBoolean("collapseActiveWork", value.collapseActiveWork).apply()
    }
    var lastMachine: String
        get() = prefs.getString("lastMachine", "").orEmpty()
        set(value) { prefs.edit().putString("lastMachine", value).apply() }
}

