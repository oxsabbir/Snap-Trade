package com.oxsabbir.snaptrade.network

import android.util.Log
import com.facebook.react.modules.network.OkHttpClientProvider
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * Signal-time native warmup — phase 1.
 *
 * When the notification listener decides a post is a signal, the app process may have been
 * dead for half an hour: the system restarts it for the service, the JS bundle takes seconds
 * to boot, and EVERY socket step — DNS, token fetch, TCP/TLS, the WebSocket handshake — waits
 * behind that boot. This object does the network half of the work natively, in parallel with
 * the activity launch and the JS boot, so the wire is already warm when JS starts dialing:
 *
 *  1. DNS + TCP + TLS to `api.kucoin.com` (the host every signed REST call and the token
 *     fetch use), via a timestamp request.
 *  2. A `bullet-public` call to learn the WebSocket edge host, then TCP + TLS completed to
 *     that host — the dial the JS bundle will make the moment it boots. The token in the
 *     response is discarded: JS owns the token cache; this only exists to warm the route.
 *
 * It shares OkHttp's connection pool with the app's own client, so the TLS session and the
 * resolved routes established here are reusable by JS's own dials rather than parallel work.
 *
 * Deliberately NOT here (phase 2, needs a separate go-ahead): pre-opening a native WebSocket
 * and handing the live socket to JS. Phase 1 is protocol-safe — no socket outlives this call,
 * nothing subscribes, and the cooldown keeps it to one warmup per signal burst.
 */
object SocketWarmup {
  private const val TAG = NetworkHardening.TAG

  /** One warmup per burst: notifications repost, the JS deep link re-delivers, signals repeat. */
  private const val COOLDOWN_MS = 10_000L

  private val lastWarmAt = AtomicLong(0)
  private val executor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "snaptrade-warmup").apply { isDaemon = true }
  }

  fun warm(reason: String) {
    val now = System.currentTimeMillis()
    val previous = lastWarmAt.get()
    if (now - previous < COOLDOWN_MS) return
    if (!lastWarmAt.compareAndSet(previous, now)) return
    Log.d(TAG, "${System.currentTimeMillis()} WarmupQueued[$reason]")
    executor.execute { runWarmup(reason) }
  }

  private fun runWarmup(reason: String) {
    try {
      val startedAt = System.currentTimeMillis()
      // The shared client's pool is what the app's own REST and WS dials reuse; the timeouts
      // here bound the warmup itself and do not affect the shared instance.
      val client: OkHttpClient = OkHttpClientProvider.getOkHttpClient().newBuilder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .writeTimeout(5, TimeUnit.SECONDS)
        .build()

      // 1. DNS + TCP + TLS to the REST host — the route the token fetch and every signed
      //    call will ride seconds later.
      val restRequest = Request.Builder()
        .url("https://api.kucoin.com/api/v1/timestamp")
        .build()
      client.newCall(restRequest).execute().use { response ->
        Log.d(
          TAG,
          "${System.currentTimeMillis()} Warmup[$reason] rest status=${response.code} " +
            "at=${System.currentTimeMillis() - startedAt}ms"
        )
      }

      // 2. Learn the WebSocket edge host, then complete TCP+TLS to it. The token is thrown
      //    away; only the warm route matters.
      val bulletRequest = Request.Builder()
        .url("https://api.kucoin.com/api/v1/bullet-public")
        .post("{}".toRequestBody("application/json".toMediaTypeOrNull()))
        .build()
      val endpoint = client.newCall(bulletRequest).execute().use { response ->
        val body = response.body?.string().orEmpty()
        val servers = JSONObject(body).optJSONArray("instanceServers")
        val host = servers?.optJSONObject(0)?.optString("endpoint").orEmpty()
        Log.d(
          TAG,
          "${System.currentTimeMillis()} Warmup[$reason] bullet status=${response.code} " +
            "endpoint=${host.ifEmpty { "none" }}"
        )
        host
      }
      if (endpoint.startsWith("wss://")) {
        val edgeRequest = Request.Builder().url(endpoint.replaceFirst("wss://", "https://")).build()
        client.newCall(edgeRequest).execute().use { response ->
          Log.d(
            TAG,
            "${System.currentTimeMillis()} Warmup[$reason] edge status=${response.code} " +
              "total=${System.currentTimeMillis() - startedAt}ms"
          )
        }
      }
    } catch (t: Throwable) {
      // Warmup is opportunistic: a failure changes nothing — JS's own ladder still runs.
      Log.d(TAG, "${System.currentTimeMillis()} Warmup[$reason] failed: ${t.message}")
    }
  }
}
