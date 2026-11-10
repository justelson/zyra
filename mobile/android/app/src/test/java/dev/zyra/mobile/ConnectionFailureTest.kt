package dev.zyra.mobile

import dev.zyra.mobile.data.*
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.security.cert.CertificateException

class ConnectionFailureTest {
    @Test fun identityAndAccessFailuresStopAutomaticRetries() {
        for (code in listOf("DEVICE_REVOKED", "HOST_IDENTITY_CHANGED", "INVALID_PIN", "UNAUTHORIZED")) {
            val failure = connectionFailure(IOException("secret endpoint"), code)
            assertEquals(ConnectionRecovery.PairAgain, failure.recovery)
            assertFalse(failure.retryAutomatically)
            assertFalse(failure.message.contains("secret"))
        }
        assertEquals(ConnectionRecovery.PairAgain, connectionFailure(IOException("TLS", CertificateException("bad pin"))).recovery)
    }
    @Test fun incompatibleProtocolRequiresUpdateAndTemporaryOutagesRetry() {
        assertEquals(ConnectionRecovery.Update, connectionFailure(IOException(), "UNSUPPORTED_PROTOCOL").recovery)
        assertTrue(connectionFailure(IOException("offline")).retryAutomatically)
    }
}
