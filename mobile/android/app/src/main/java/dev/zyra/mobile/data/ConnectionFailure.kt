package dev.zyra.mobile.data

import java.security.cert.CertificateException
import javax.net.ssl.SSLPeerUnverifiedException

enum class ConnectionRecovery { Retry, PairAgain, Update }
data class ConnectionFailure(val message: String, val recovery: ConnectionRecovery) {
    val retryAutomatically get() = recovery == ConnectionRecovery.Retry
}

/** Safe actionable copy. Never show credentials, endpoint details or TLS internals. */
fun connectionFailure(error: Throwable, code: String? = null): ConnectionFailure {
    val causes = generateSequence(error) { it.cause }.take(8).toList()
    return when {
        code in setOf("DEVICE_REVOKED", "UNAUTHORIZED", "AUTH_REQUIRED", "HOST_IDENTITY_CHANGED", "INVALID_PIN") ||
            causes.any { it is CertificateException || it is SSLPeerUnverifiedException } ->
            ConnectionFailure("Pair again from this PC to verify its identity and access.", ConnectionRecovery.PairAgain)
        code in setOf("UNSUPPORTED_PROTOCOL", "PROTOCOL_MISMATCH", "UPGRADE_REQUIRED") ->
            ConnectionFailure("Update Zyra on this phone and PC to connect.", ConnectionRecovery.Update)
        else -> ConnectionFailure("Can't reach this PC. Check that Zyra is running and online.", ConnectionRecovery.Retry)
    }
}
