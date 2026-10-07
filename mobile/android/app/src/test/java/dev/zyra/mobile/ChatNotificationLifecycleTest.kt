package dev.zyra.mobile

import dev.zyra.mobile.data.Chat
import dev.zyra.mobile.notifications.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChatNotificationLifecycleTest {
    @Test fun openingAndEnablingDoesNotStartAnAnnouncingService() {
        var enabled = false; var starts = 0; var stops = 0
        val lifecycle = ChatNotificationLifecycle({ enabled }, { starts++ }, { stops++ })
        lifecycle.foreground(); assertEquals(0, starts); assertEquals(1, stops)
        enabled = true // foreground monitoring observes the preference; it does not start a service
        assertEquals(0, starts)
        lifecycle.background(false); assertEquals(1, starts)
        lifecycle.background(false); assertEquals(1, starts)
        lifecycle.foreground(); assertEquals(2, stops)
        lifecycle.background(true); assertEquals(1, starts) // rotation is not background work
        lifecycle.foreground(); enabled = false; lifecycle.background(false); assertEquals(1, starts)
    }
    @Test fun sharedMonitoringSendsOnlyRealEdgesAcrossForegroundBackgroundHandoffs() = runTest {
        val changes = MutableSharedFlow<Unit>(extraBufferCapacity=1)
        val enabled = MutableStateFlow(false)
        var foreground = false; var service = false; var reads = 0; var saves = 0
        var chat = Chat("c", "Title", "p", "ready", null, false, "pc", lastTurnId="old", lastTurnState="completed", lastTurnCompletedAt="1970-01-01T00:00:01Z")
        val alerts = mutableListOf<String>()
        ChatAlertMonitor(backgroundScope, changes, enabled, ChatAlertPolicy(linkedMapOf(), 2000),
            { foreground || service }, { reads++; listOf(chat) }, { null }, { _, message -> alerts.add(message) }, { saves++ })
        runCurrent(); advanceTimeBy(300); runCurrent(); assertEquals(0, reads)
        foreground = true; enabled.value = true; runCurrent(); advanceTimeBy(300); runCurrent()
        assertTrue(reads > 0); assertTrue(alerts.isEmpty()) // opening never emits a self-announcement or old completion
        val baselineSaves = saves
        changes.emit(Unit); runCurrent(); advanceTimeBy(300); runCurrent()
        assertEquals(baselineSaves, saves) // unchanged refreshes do not serialize/write receipts
        chat = chat.copy(state="running", lastTurnId="new", lastTurnState="running")
        changes.emit(Unit); runCurrent(); advanceTimeBy(300); runCurrent()
        chat = chat.copy(state="ready", lastTurnState="completed", lastTurnCompletedAt="1970-01-01T00:00:03Z")
        changes.emit(Unit); runCurrent(); advanceTimeBy(300); runCurrent()
        assertEquals(listOf("Response ready"), alerts)
        foreground = false; service = true; changes.emit(Unit); runCurrent(); advanceTimeBy(300); runCurrent()
        foreground = true; service = false; changes.emit(Unit); runCurrent(); advanceTimeBy(300); runCurrent()
        assertEquals(1, alerts.size) // one observer/receipt survives both ownership changes
        chat = chat.copy(attention="user-input"); changes.emit(Unit); runCurrent(); advanceTimeBy(300); runCurrent()
        assertEquals("Your response is needed", alerts.last())
        assertTrue(saves > 0)
        enabled.value = false; chat = chat.copy(attention="approval"); changes.emit(Unit); runCurrent(); advanceTimeBy(300); runCurrent()
        assertEquals(2, alerts.size)
    }
}
