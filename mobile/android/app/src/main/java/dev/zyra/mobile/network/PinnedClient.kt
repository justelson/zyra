package dev.zyra.mobile.network

import okhttp3.OkHttpClient
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

object PinnedClient {
    fun fingerprint(cert: X509Certificate): String = MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString("") { "%02x".format(it) }
    fun create(pin: String): OkHttpClient {
        if (!Regex("[a-f0-9]{64}").matches(pin)) throw HostFailure("INVALID_PIN", "Invalid host identity.")
        val trust = object : X509TrustManager {
            override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
            override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) { throw CertificateException("Client authentication is not supported here.") }
            override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
                val leaf = chain?.firstOrNull() ?: throw CertificateException("Host certificate is missing.")
                leaf.checkValidity()
                if (!MessageDigest.isEqual(fingerprint(leaf).toByteArray(), pin.toByteArray())) throw CertificateException("Host identity changed. Pair again from the PC.")
            }
        }
        val tls = SSLContext.getInstance("TLS").apply { init(null, arrayOf<TrustManager>(trust), null) }
        return OkHttpClient.Builder().sslSocketFactory(tls.socketFactory, trust)
            // The QR-pinned certificate is the identity, allowing LAN IP changes without weakening trust.
            .hostnameVerifier { _, session -> (session.peerCertificates.firstOrNull() as? X509Certificate)?.let { fingerprint(it) == pin } == true }
            .connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).writeTimeout(15, TimeUnit.SECONDS)
            .pingInterval(25, TimeUnit.SECONDS).retryOnConnectionFailure(false).build()
    }
}
