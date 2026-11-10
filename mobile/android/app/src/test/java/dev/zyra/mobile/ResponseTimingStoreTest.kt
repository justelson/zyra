package dev.zyra.mobile

import dev.zyra.mobile.data.ResponseTimingStore
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.ExperimentalCoroutinesApi
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
import java.io.File

class ResponseTimingStoreTest {
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun localPersistenceWorksWithoutAnyUploadConsentAndCorruptFilesDoNotBlockIt() = runTest {
        val directory = Files.createTempDirectory("zyra-phone-timing-").toFile()
        try {
            val file = File(directory, "response-timings.json"); file.writeText("broken JSON")
            val shared = mutableListOf<String>()
            val store = ResponseTimingStore(directory, this, share = { id, _ -> shared.add(id) })
            store.recorder.start("mobile:fixture", "private-model", "variant:private")
            store.recorder.finish("mobile:fixture", "completed")
            store.flush()
            assertEquals("other", JSONArray(file.readText()).getJSONObject(0).getString("model"))
            assertTrue(file.length() <= ResponseTimingStore.MAX_BYTES)
            assertFalse(file.readText().contains("private-model"))
            advanceUntilIdle()
        } finally { directory.deleteRecursively() }
    }
}
