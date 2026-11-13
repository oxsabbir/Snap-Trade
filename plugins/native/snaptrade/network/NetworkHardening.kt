package com.oxsabbir.snaptrade.network

import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import com.facebook.react.modules.network.ReactCookieJarContainer
import com.facebook.react.modules.websocket.WebSocketModule
import java.net.InetAddress
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Connection
import okhttp3.EventListener
import okhttp3.OkHttpClient

/**
 * Installs carrier-safe socket networking for the app:
 *
 *  - Every WebSocket dial gets a 3s connect deadline (React Native's default is 10s; on
 *    carrier paths a dial into a blackholed address spends its whole life in the SYN queue,
 *    and a fast close lets the JS retry ladder fall through to the next candidate address).
 *  - All URLs — sockets and REST alike — resolve DNS through `SmartDns`, so IPv4 is tried
 *    before IPv6 and the last address that connected successfully goes first next time. The
 *    okHttp event listener feeds that cache from `connectionAcquired`.
 *
 * Installed from `MainApplication.onCreate` before any React instance is loaded.
 */
object NetworkHardening {
  fun install() {
    WebSocketModule.setCustomClientBuilder(WebSocketClientCustomizer)
    OkHttpClientProvider.setOkHttpClientFactory(RestClientFactory)
  }
}

/** Applied after WebSocketModule's own builder presets, so it can tighten their timeouts. */
object WebSocketClientCustomizer : com.facebook.react.modules.network.CustomClientBuilder {
  override fun apply(builder: OkHttpClient.Builder) {
    builder
      .connectTimeout(3, TimeUnit.SECONDS)
      .writeTimeout(5, TimeUnit.SECONDS)
      .readTimeout(0, TimeUnit.MINUTES)
      // Native protocol-level keepalive, independent of the JS thread: when the app is
      // backgrounded (or the screen is off and JS timers are throttled or the process
      // frozen), these pings keep the carrier NAT mapping for the socket alive. Without
      // them a 20-30 minute idle lets the mapping expire, and the "open" socket becomes a
      // zombie: sends vanish, and coming back needs a data toggle before anything lands.
      // A missed pong closes the socket natively, which the JS layer sees as a normal close.
      .pingInterval(20, TimeUnit.SECONDS)
      .eventListenerFactory(SuccessListenerFactory)
  }
}

object RestClientFactory : OkHttpClientFactory {
  override fun createNewNetworkModuleClient(): OkHttpClient =
    OkHttpClient.Builder()
      .connectTimeout(0, TimeUnit.MILLISECONDS)
      .readTimeout(0, TimeUnit.MILLISECONDS)
      .writeTimeout(0, TimeUnit.MILLISECONDS)
      .cookieJar(ReactCookieJarContainer())
      .dns(SmartDns)
      .eventListenerFactory(SuccessListenerFactory)
      .build()
}

object SuccessListenerFactory : EventListener.Factory {
  override fun create(call: Call): EventListener = SuccessListener()
}

/**
 * Records the address whose connection was actually acquired, so `SmartDns` prefers it next
 * time. Fires per call (the factory creates a fresh listener), on success of the TCP dial.
 */
class SuccessListener : EventListener() {
  override fun connectionAcquired(call: Call, connection: Connection) {
    val address: InetAddress? = connection.socket().inetAddress
    val host: String? = call.request().url.host
    if (address != null && host != null) {
      SmartDns.recordSuccess(host, address)
    }
  }
}
