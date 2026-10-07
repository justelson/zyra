package dev.zyra.mobile.notifications

/** Foreground alerts use the existing UI session. Only background delivery needs a service. */
class ChatNotificationLifecycle(private val enabled: () -> Boolean, private val start: () -> Unit, private val stop: () -> Unit) {
    private var visible = false
    fun foreground() { visible = true; stop() }
    fun background(changingConfiguration: Boolean) {
        if (!visible) return
        visible = false
        if (!changingConfiguration && enabled()) start()
    }
}
