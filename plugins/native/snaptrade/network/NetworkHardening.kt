package com.oxsabbir.snaptrade.network

import android.app.Application
import android.content.Context
import android.util.Log
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import com.facebook.react.modules.network.ReactCookieJarContainer
import com.facebook.react.modules.websocket.WebSocketModule
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Connection
import okhttp3.EventListener
import okhttp3.OkHttpClient
import okhttp3.Protocol

/**
 * Installs carrier-safe socket networking for the app:
 *
 *  - Every WebSocket dial gets a 3s connect deadline (React Native's default is 10s; on
 *    carrier paths a dial into a blackholed address spends its whole life in the SYN queue,
 *    and a fast close lets the JS retry ladder fall through to the next candidate address).
 *  - All URLs — sockets and REST alike — resolve DNS through `SmartDns`, so IPv4 is tried
 *    before IPv6 and the last address that connected successfully goes first next time. The
 *    okHttp event listener feeds that cache from `connectionAcquired`.
 *  - The WebSocket keepalive (native protocol pings every 20s, outside the JS runtime) is
 *    gated: it always runs while an activity is in the foreground, and in the background only
 *    when trading mode is on — the JS toggle mirrors its state here via
 *    [NotificationListenerModule.syncKeepaliveMode]. Pings are a dial-time decision: a socket
 *    opened in the foreground keeps them for its lifetime, which is exactly the path the
 *    background case needs (dial happens before backgrounding).
 *
 * Installed from `MainApplication.onCreate` with the Application context, before any React
 * instance is loaded.
 */
object NetworkHardening {
  const val TAG = "SnapTrade"

  private const val PREFS_NAME = "snaptrade_network"
  private const val PREFS_KEY_TRADING_MODE = "trading_mode_enabled"

  /** Mirrored from the JS trading-mode toggle; read synchronously by the dial-time gate. */
  @Volatile
  private var tradingMode = false

  /** Activities currently resumed; > 0 means the user is in the app right now. */
  @Volatile
  private var resumedActivities = 0

  fun install(context: Context) {
    WebSocketModule.setCustomClientBuilder(WebSocketClientCustomizer)
    OkHttpClientProvider.setOkHttpClientFactory(RestClientFactory)
    tradingMode = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getBoolean(PREFS_KEY_TRADING_MODE, false)
    (context.applicationContext as? Application)
      ?.registerActivityLifecycleCallbacks(ForegroundTracker)
    Log.d(TAG, "${System.currentTimeMillis()} HardeningInstalled tradingMode=$tradingMode")
  }

  /** True when a dial should carry the native keepalive: foreground always, background only with trading mode. */
  val keepaliveEnabled: Boolean
    get() = resumedActivities > 0 || tradingMode

  /** Mirrors the JS trading-mode toggle into memory + SharedPreferences. */
  fun setTradingMode(context: Context, enabled: Boolean) {
    tradingMode = enabled
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(PREFS_KEY_TRADING_MODE, enabled)
      .apply()
    Log.d(TAG, "${System.currentTimeMillis()} KeepaliveMode tradingMode=$enabled")
  }

  private object ForegroundTracker : Application.ActivityLifecycleCallbacks {
    override fun onActivityResumed(activity: android.app.Activity) {
      resumedActivities += 1
    }

    override fun onActivityPaused(activity: android.app.Activity) {
      resumedActivities = (resumedActivities - 1).coerceAtLeast(0)
    }

    override fun onActivityCreated(activity: android.app.Activity, savedInstanceState: android.os.Bundle?) {}
    override fun onActivityStarted(activity: android.app.Activity) {}
    override fun onActivityStopped(activity: android.app.Activity) {}
    override fun onActivitySaveInstanceState(activity: android.app.Activity, outState: android.os.Bundle) {}
    override fun onActivityDestroyed(activity: android.app.Activity) {}
  }
}

/** Applied after WebSocketModule's own builder presets, so it can tighten their timeouts. */
object WebSocketClientCustomizer : com.facebook.react.modules.network.CustomClientBuilder {
  override fun apply(builder: OkHttpClient.Builder) {
    builder
      .connectTimeout(3, TimeUnit.SECONDS)
      .writeTimeout(5, TimeUnit.SECONDS)
      .readTimeout(0, TimeUnit.MINUTES)
      .eventListenerFactory(SuccessListenerFactory)
    // Native protocol-level keepalive, independent of the JS thread: when the app is
    // backgrounded (or the screen is off and JS timers are throttled or the process
    // frozen), these pings keep the carrier NAT mapping for the socket alive. Without
    // them a 20-30 minute idle lets the mapping expire, and the "open" socket becomes a
    // zombie: sends vanish, and coming back needs a data toggle before anything lands.
    // A missed pong closes the socket natively, which the JS layer sees as a normal close.
    // Gated at dial time: foreground always; background only with trading mode on.
    if (NetworkHardening.keepaliveEnabled) {
      builder.pingInterval(20, TimeUnit.SECONDS)
    }
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
 * time; and logs the connect phases — DNS answer count, TCP/TLS connect results, and call
 * failures with the underlying exception — so a field logcat shows WHERE a dial lost time
 * (resolver, SYN blackhole, TLS) instead of just that it did. Fires per call (the factory
 * creates a fresh listener).
 */
class SuccessListener : EventListener() {
  override fun connectionAcquired(call: Call, connection: Connection) {
    val address: InetAddress? = connection.socket().inetAddress
    val host: String? = call.request().url.host
    if (address != null && host != null) {
      SmartDns.recordSuccess(host, address)
    }
  }

  override fun dnsEnd(call: Call, domainName: String, inetAddressList: List<InetAddress>) {
    Log.d(NetworkHardening.TAG, "${System.currentTimeMillis()} DnsDone $domainName ${inetAddressList.size}addr")
  }

  override fun connectEnd(
    call: Call,
    inetSocketAddress: InetSocketAddress,
    proxy: Proxy,
    protocol: Protocol?
  ) {
    Log.d(NetworkHardening.TAG, "${System.currentTimeMillis()} ConnectDone ${call.request().url.host} $protocol")
  }

  override fun connectFailed(
    call: Call,
    inetSocketAddress: InetSocketAddress,
    proxy: Proxy,
    protocol: Protocol?,
    failure: IOException
  ) {
    Log.d(
      NetworkHardening.TAG,
      "${System.currentTimeMillis()} ConnectFailed ${call.request().url.host} ${failure.message}"
    )
  }

  override fun callFailed(call: Call, e: IOException) {
    // The native verdict on a socket's death: timeouts name the phase (read vs connect vs
    // SSL), and a missed-pong keepalive death shows up here as a SocketTimeoutException —
    // the exact signal for whether KuCoin answers protocol pings.
    Log.d(NetworkHardening.TAG, "${System.currentTimeMillis()} CallFailed ${call.request().url.host} ${e.message}")
  }
}
