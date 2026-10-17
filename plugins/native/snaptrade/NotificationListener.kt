package com.oxsabbir.snaptrade

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.oxsabbir.snaptrade.notification.NotificationListenerModule
import java.util.concurrent.ConcurrentHashMap
import java.util.regex.Pattern

/**
 * Reads the signal source's notifications directly on device, without the JS runtime.
 *
 * The app process can be dead (swiped from recents) when a notification lands, so the whole
 * decision — package gate, toggle, trusted display names, and the format-specific anchors
 * (ticker + TPs for TP posts, ticker + marker + market price for gem posts) — has to be made
 * here. The settings the JS side owns are mirrored into the same SharedPreferences file this
 * service reads; see [NotificationListenerModule.syncSignalSettings].
 *
 * On a signal the service starts the MainActivity through a `snaptrade://trade/<symbol>` deep
 * link (with `?entry=<price>` for gem posts). If the process is alive the activity is brought
 * forward and the link is re-delivered; if it was killed, that link becomes the app's initial
 * route.
 */
class NotificationListener : NotificationListenerService() {

    companion object {
        const val TAG = "SnapTrade"

        private const val PACKAGE_X = "com.twitter.android"
        private const val PACKAGE_SHELL = "com.android.shell"

        private const val PREFS_NAME = "signal_settings"
        private const val PREFS_KEY_ENABLED = "signal_detection_enabled"
        private const val PREFS_KEY_DISPLAY_NAME = "signal_source_display_name"
        private const val DEFAULT_DISPLAY_NAME = "My Signal Source"

        /** X reposts and then updates the same notification; don't relaunch for the same coin. */
        private const val DEDUPE_WINDOW_MS = 10_000L

        private val lastLaunchByTicker = ConcurrentHashMap<String, Long>()

        /**
         * Ask the OS to re-attach this listener after a reboot or an app update. Safe to call
         * even when the user has not granted notification access; the OS simply ignores it.
         */
        fun requestRebind(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
            try {
                NotificationListenerService.requestRebind(
                    ComponentName(context.applicationContext, NotificationListener::class.java)
                )
                Log.d(TAG, "${System.currentTimeMillis()} ListenerRebindRequested")
            } catch (t: Throwable) {
                Log.w(TAG, "${System.currentTimeMillis()} ListenerRebindFailed: ${t.message}")
            }
        }
    }

    // Cashtag ticker, e.g. `$SKY`.
    private val tickerPattern = Pattern.compile("\\$([A-Za-z0-9]+)")

    // `TP1: 0.016`, `T.P 1 = 0,016`, `TP 1: .0160` — label, optional separator, value.
    private val tpPattern =
        Pattern.compile("(?i)(?:TP|T\\.P)\\s*[.:]?\\s*(\\d+)\\s*[=:]*\\s*([\\d,.]+)")

    // `TP 1 0.0160` with only whitespace between the number and the value.
    private val tpAltPattern =
        Pattern.compile("(?i)(?:TP|T\\.P)\\s*(\\d+)\\s+([\\d,.]+)(?![=:])")

    // Gem-post marker: `Buying this GEM on #KuCoin` (constant across the source's posts).
    private val gemMarkerPattern =
        Pattern.compile("(?i)buying\\s+this\\s+gem\\s+on\\s+#?kucoin")

    // `Current market price - 0.0007306 $` — value kept as a plain string, not a Double,
    // so the deep link carries the exact posted decimal (no scientific notation).
    private val gemPricePattern =
        Pattern.compile("(?i)current\\s+market\\s+price\\s*[-–:]?\\s*([\\d.,]+)")

    override fun onCreate() {
        super.onCreate()
        log("ListenerCreated", "service created")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null) return

        val packageName = sbn.packageName
        log("ListenerFired", "package=$packageName")

        // Keep the JS debug listeners fed while the runtime happens to be alive. The decision
        // below is entirely native and does not depend on this succeeding.
        NotificationListenerModule.instance?.onNotificationPosted(sbn)

        if (!isAcceptedPackage(packageName)) {
            log("Decision", "not signal (ignored: package $packageName)")
            return
        }
        if (!isSignalDetectionEnabled()) {
            log("Decision", "not signal (ignored: signal detection off)")
            return
        }
        if (!titleMatchesTrustedSource(sbn)) {
            log("Decision", "not signal (ignored: display name mismatch)")
            return
        }

        val extras = sbn.notification.extras
        val text = extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
        val bigText = extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""
        val primaryText = if (bigText.isNotBlank()) bigText else text

        val ticker = extractTicker(primaryText)
        val tps = extractTps(primaryText)
        if (ticker == null) {
            log("Decision", "not signal (ticker=none, tps=${tps.size})")
            return
        }

        // Format 1 (TP posts): a cashtag plus at least three numbered take-profits.
        // Format 2 (gem posts): a cashtag plus the marker phrase and a market price line.
        // The trailing cashtag list in gem posts is a decoy — only the first cashtag is
        // ever taken as the ticker.
        val entryPrice = if (tps.size < 3) extractGemPrice(primaryText) else null
        if (tps.size < 3 && entryPrice == null) {
            log("Decision", "not signal (ticker=$ticker, tps=${tps.size}, gem=false)")
            return
        }

        val now = System.currentTimeMillis()
        val previous = lastLaunchByTicker[ticker]
        if (previous != null && now - previous < DEDUPE_WINDOW_MS) {
            log("Decision", "ignored (dedupe ${ticker} within ${DEDUPE_WINDOW_MS}ms)")
            return
        }
        lastLaunchByTicker[ticker] = now

        val format = if (tps.size >= 3) "tp" else "gem"
        val pricePart = entryPrice?.let { ", price=$it" } ?: ""
        log("Decision", "signal $ticker (format=$format, tps=${tps.size}$pricePart)")
        launchTradeScreen(ticker, entryPrice)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        super.onNotificationRemoved(sbn)
        if (sbn == null) return
        NotificationListenerModule.instance?.onNotificationRemoved(sbn)
    }

    /**
     * Trusts notifications from the real X app and from `adb shell` posts on every build type,
     * so the detection pipeline can be exercised end-to-end in the field without shipping a
     * debug-only affordance. Spoofing `com.android.shell` is not possible for third-party apps:
     * only the shell UID (adb) can post under that package name.
     */
    private fun isAcceptedPackage(packageName: String): Boolean =
        packageName == PACKAGE_X || packageName == PACKAGE_SHELL

    private fun isSignalDetectionEnabled(): Boolean =
        prefs().getBoolean(PREFS_KEY_ENABLED, false)

    private fun trustedDisplayNames(): List<String> {
        val stored = prefs().getString(PREFS_KEY_DISPLAY_NAME, DEFAULT_DISPLAY_NAME).orEmpty()
        // The JS store holds a comma-separated list ("Alpha Calls, Gem Hunter"); an empty
        // segment falls back so a stray comma never widens the match to everything.
        return stored.split(',').map { it.trim() }.filter { it.isNotEmpty() }
    }

    private fun prefs() = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun titleMatchesTrustedSource(sbn: StatusBarNotification): Boolean {
        val trusted = trustedDisplayNames()
        if (trusted.isEmpty()) return false
        val extras = sbn.notification.extras
        val title = extras?.getString(Notification.EXTRA_TITLE)?.trim().orEmpty()
        val subText = extras?.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()?.trim().orEmpty()
        return trusted.any { name ->
            title.contains(name, ignoreCase = true) ||
                subText.contains(name, ignoreCase = true)
        }
    }

    private fun extractTicker(text: String): String? {
        if (text.isBlank()) return null
        val matcher = tickerPattern.matcher(text)
        return if (matcher.find()) matcher.group(1)?.uppercase() else null
    }

    private fun extractTps(text: String): List<Double> {
        if (text.isBlank()) return emptyList()

        val tps = mutableListOf<Double>()
        val seen = mutableSetOf<Int>()

        val primary = tpPattern.matcher(text)
        while (primary.find()) {
            val number = primary.group(1)?.toIntOrNull() ?: continue
            val value = normalizeNumber(primary.group(2)) ?: continue
            if (number in 1..10 && seen.add(number)) tps.add(value)
        }

        // Same TP numbers the primary pattern already claimed are skipped, so the two passes
        // cannot double-count a single line.
        val alternate = tpAltPattern.matcher(text)
        while (alternate.find()) {
            val number = alternate.group(1)?.toIntOrNull() ?: continue
            val value = normalizeNumber(alternate.group(2)) ?: continue
            if (number in 1..10 && seen.add(number)) tps.add(value)
        }

        return tps
    }

    /** Accepts `0.016`, `0,016` and `.016` (a missing leading zero). */
    private fun normalizeNumber(raw: String?): Double? {
        if (raw.isNullOrBlank()) return null
        val value = raw.replace(',', '.').trim().toDoubleOrNull() ?: return null
        return if (value.isFinite()) value else null
    }

    /**
     * Gem-format anchor: returns the posted market price as a plain decimal string, or null
     * unless the post carries both the constant marker phrase and a parseable price line —
     * a stray "current market price" mention without the marker is not a signal.
     */
    private fun extractGemPrice(text: String): String? {
        if (text.isBlank()) return null
        if (!gemMarkerPattern.matcher(text).find()) return null

        val matcher = gemPricePattern.matcher(text)
        if (!matcher.find()) return null

        // Comma decimal separator to dot; BigDecimal keeps the posted precision as-is.
        val normalized = matcher.group(1)?.replace(',', '.')?.trim() ?: return null
        return try {
            java.math.BigDecimal(normalized).toPlainString()
        } catch (e: NumberFormatException) {
            null
        }
    }

    private fun launchTradeScreen(ticker: String, entryPrice: String? = null) {
        val symbol = "${ticker.uppercase()}-USDT"
        val url = if (entryPrice != null) {
            "snaptrade://trade/$symbol?entry=$entryPrice"
        } else {
            "snaptrade://trade/$symbol"
        }
        val intent = Intent(Intent.ACTION_VIEW).apply {
            data = Uri.parse(url)
            setPackage(packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            // Background activity starts are blocked without this on modern Android; surface it
            // in the log rather than letting the intent disappear silently.
            log("OverlayMissing", "startActivity from background may be dropped")
        }

        try {
            startActivity(intent)
            log("IntentSent", url)
        } catch (t: Throwable) {
            log("IntentFailed", "$symbol: ${t.message}")
        }
    }

    private fun log(stage: String, message: String) {
        Log.d(TAG, "${System.currentTimeMillis()} $stage $message")
    }
}
