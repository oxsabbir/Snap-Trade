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
 * (ticker + TPs for TP posts, ticker + marker + market price for gem posts, ticker + buy
 * context + `CMP <price>` for cmp posts) — has to be made
 * here. The settings the JS side owns are mirrored into the same SharedPreferences file this
 * service reads; see [NotificationListenerModule.syncSignalSettings].
 *
 * On a signal the service starts the MainActivity through a `snaptrade://trade/<symbol>` deep
 * link (with `?tp1=<price>` for TP posts and `?entry=<price>` for gem posts). If the process is
 * alive the activity is brought
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
        private const val MAX_LOG_FIELD_CHARS = 2_000

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

    // Hashtag ticker fallback, e.g. `#P2P`.
    private val hashtagPattern = Pattern.compile("#([A-Za-z0-9]+)")

    private val ignoredHashtags = setOf(
        "KUCOIN",
        "MEXC",
        "BINANCE",
        "BYBIT",
        "GATEIO",
        "OKX",
        "BITGET",
        "COINBASE",
        "KRAKEN",
        "HTX",
        "HUOBI",
        "SIGNAL",
        "SIGNALS",
        "VIP",
        "ENTRY",
        "TARGET",
        "TARGETS",
        "STOPLOSS"
    )

    private val mcPattern = Pattern.compile("(?i)\\b(?:MC|MCAP|MARKET\\s*CAP)\\b")
    private val wordPattern = Pattern.compile("\\b[A-Za-z][A-Za-z0-9]*\\b")

    private val ignoredWords = ignoredHashtags + setOf(
        "DEX", "CEX", "UNISWAP", "PANCAKESWAP",
        "CALL", "CALLS", "PREMIUM", "ALERT", "ALERTS", "UPDATE", "UPDATES", "NEWS",
        "TRADE", "TRADES", "TRADING", "SETUP", "SETUPS",
        "BUY", "BUYING", "BOUGHT", "SELL", "SELLING", "SOLD", "LONG", "SHORT", "SPOT", "FUTURES", "FUTURE", "HOLD", "HODL",
        "ENTRIES", "STOP", "LOSS", "TP", "SL", "PROFIT", "PROFITS", "LEVERAGE", "MARGIN", "RISK",
        "MARKET", "MARKETS", "MCAP", "MC", "CAP", "CAPITAL", "PRICE", "PRICES", "VOLUME", "VOL", "HIGH", "LOW", "ATH",
        "GEM", "GEMS", "COIN", "COINS", "TOKEN", "TOKENS", "PAIR", "PAIRS", "ALTCOIN", "ALTCOINS", "CRYPTO", "CRYPTOS", "PROJECT", "PROJECTS", "ALPHA", "BETA", "BULLISH", "BEARISH", "PUMP", "PUMPING", "DUMP", "MOON", "ROCKET", "BOMB", "LISTING", "LISTED", "LAUNCH", "PRESALE",
        "TODAY", "TONIGHT", "DAILY", "WEEKLY", "MONTHLY", "NOW", "SOON", "HERE", "NEXT", "NEW", "FIRST", "LAST", "BEST", "TOP", "BIG", "HUGE", "MASSIVE", "EASY", "GOOD", "GREAT", "SUPER", "FREE",
        "ON", "IN", "AT", "TO", "FOR", "OF", "WITH", "FROM", "BY", "THE", "THIS", "THAT", "THESE", "THOSE", "A", "AN", "AND", "OR", "IS", "ARE", "WAS", "WERE", "HAVE", "HAS", "HAD", "WILL", "CAN", "COULD", "WOULD", "SHOULD", "ABOUT", "INTO", "OVER", "AFTER", "BEFORE", "UNDER", "ABOVE",
        "MORNING", "EVENING", "NIGHT", "TRADERS", "HELLO", "HEY", "CHECK", "WATCH", "LOOK", "READY"
    )

    // `TP1: 0.016`, `T.P 1 = 0,016`, `TP 1: .0160` — label, optional separator, value.
    private val tpPattern =
        Pattern.compile("(?i)(?:TP|T\\.P)\\s*[.:]?\\s*(\\d+)\\s*[=:]*\\s*([\\d,.]+)")

    // `TP 1 0.0160` with only whitespace between the number and the value.
    private val tpAltPattern =
        Pattern.compile("(?i)(?:TP|T\\.P)\\s*(\\d+)\\s+([\\d,.]+)(?![=:])")

    // Gem-post marker: compare only letters/digits so newlines, emoji and X formatting between
    // the words do not change recognition of `Buying this GEM on #KuCoin`.
    private val gemMarker = "buyingthisgemonkucoin"

    // `Current market price - 0.0007306 $` — value kept as a plain string, not a Double,
    // so the deep link carries the exact posted decimal (no scientific notation).
    private val gemPricePattern =
        Pattern.compile("(?i)current\\s+market\\s+price\\s*[-–:]?\\s*([\\d.,]+)")

    // Cmp-post marker: `Buying CMP 0.000552 Keeping high targets SL manage`. Only the letters
    // and digits are compared, so emoji and X formatting cannot hide a `buy`/`Buying` context;
    // the anchor that fires the signal is the literal `CMP <price>`, an exact closing price.
    private val cmpPricePattern =
        Pattern.compile("(?i)\\bCMP\\b\\s*[-–:=]?\\s*([\\d.,]+)")

    override fun onCreate() {
        super.onCreate()
        log("ListenerCreated", "service created")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null) return

        val packageName = sbn.packageName
        log("ListenerFired", "package=$packageName")
        logNotificationFields(sbn)

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
        // X may expose the expanded post in BIG_TEXT or as separate TEXT_LINES. Keep BIG_TEXT
        // first so ticker extraction retains the existing behavior when the fields overlap.
        val textLines = extras?.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            ?.joinToString("\n") { it.toString() }
            .orEmpty()
        val primaryText = listOf(bigText, text, textLines)
            .filter { it.isNotBlank() }
            .distinct()
            .joinToString("\n")

        val tpsResult = extractTps(primaryText)
        val tps = tpsResult.tps
        val isTpSignal = tps.size >= 3
        val hasGemMarker = hasGemMarker(primaryText)
        val gemResult = if (!isTpSignal) extractGemPrice(primaryText) else GemResult(null, null)
        val cmpResult =
            if (!isTpSignal && gemResult.price == null) extractCmpPrice(primaryText) else CmpResult(null, null)
        val entryPrice = gemResult.price ?: cmpResult.price

        val searchRegion = when {
            isTpSignal && tpsResult.firstTpIndex != null ->
                primaryText.substring(0, tpsResult.firstTpIndex)
            !isTpSignal && gemResult.priceIndex != null ->
                primaryText.substring(0, gemResult.priceIndex)
            !isTpSignal && cmpResult.priceIndex != null ->
                primaryText.substring(0, cmpResult.priceIndex)
            else ->
                primaryText
        }

        val ticker = extractTicker(searchRegion)
        log(
            "SignalParse",
            "ticker=${ticker ?: "none"}, tps=${tps.size}, gemMarker=$hasGemMarker, " +
                "gemPrice=${gemResult.price ?: "none"}, cmpPrice=${cmpResult.price ?: "none"}, " +
                "inputChars=${primaryText.length}"
        )
        if (ticker == null) {
            log("Decision", "not signal (ticker=none, tps=${tps.size})")
            return
        }

        // Format 1 (TP posts): a cashtag/hashtag plus at least three numbered take-profits.
        // Format 2 (gem posts): a cashtag/hashtag plus the marker phrase and a market price line.
        // Format 3 (cmp posts): a cashtag/hashtag plus a buy context marker and a `CMP <price>`.
        // The trailing cashtag list in gem posts is a decoy — only the first cashtag is
        // ever taken as the ticker.
        if (!isTpSignal && entryPrice == null) {
            log(
                "Decision",
                "not signal (ticker=$ticker, tps=${tps.size}, " +
                    "gemMarker=$hasGemMarker, gemPrice=${gemResult.price ?: "none"}, " +
                    "cmpPrice=${cmpResult.price ?: "none"})"
            )
            return
        }

        val now = System.currentTimeMillis()
        val previous = lastLaunchByTicker[ticker]
        if (previous != null && now - previous < DEDUPE_WINDOW_MS) {
            log("Decision", "ignored (dedupe ${ticker} within ${DEDUPE_WINDOW_MS}ms)")
            return
        }
        lastLaunchByTicker[ticker] = now

        val format = when {
            isTpSignal -> "tp"
            gemResult.price != null -> "gem"
            else -> "cmp"
        }
        val tp1 = if (isTpSignal) extractTp1(primaryText) else null
        val pricePart = entryPrice?.let { ", price=$it" } ?: ""
        val tpPart = tp1?.let { ", tp1=$it" } ?: ""
        log("Decision", "signal $ticker (format=$format, tps=${tps.size}$pricePart$tpPart)")
        launchTradeScreen(ticker, entryPrice, tp1)
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

        // Priority 1: Cashtag `$TICKER`
        val cashMatcher = tickerPattern.matcher(text)
        if (cashMatcher.find()) {
            val symbol = cashMatcher.group(1)?.uppercase()
            if (!symbol.isNullOrBlank()) return symbol
        }

        // Priority 2: Hashtag `#TICKER` (excluding blacklisted exchange and system tags)
        val hashMatcher = hashtagPattern.matcher(text)
        while (hashMatcher.find()) {
            val tag = hashMatcher.group(1)?.uppercase() ?: continue
            if (tag !in ignoredHashtags && tag.length in 2..10) {
                return tag
            }
        }

        // Priority 3: Fallback plain-text ticker before MC/TP
        return extractFallbackTicker(text)
    }

    private fun extractFallbackTicker(text: String): String? {
        val mcMatcher = mcPattern.matcher(text)
        val region = if (mcMatcher.find()) text.substring(0, mcMatcher.start()) else text

        val lines = region.lines().map { it.trim() }.filter { it.isNotEmpty() }
        for (line in lines) {
            val words = mutableListOf<String>()
            val matcher = wordPattern.matcher(line)
            while (matcher.find()) {
                words.add(matcher.group())
            }
            if (words.isEmpty()) continue

            val candidates = words
                .map { it.uppercase() }
                .filter { it.length in 2..10 && it !in ignoredWords }

            if (candidates.isNotEmpty() && words.size <= 4) {
                return candidates.first()
            }
        }
        return null
    }

    private data class TpsResult(
        val tps: List<Double>,
        val firstTpIndex: Int?
    )

    private fun extractTps(text: String): TpsResult {
        if (text.isBlank()) return TpsResult(emptyList(), null)

        val tps = mutableListOf<Double>()
        val seen = mutableSetOf<Int>()
        var earliestIndex: Int? = null

        val primary = tpPattern.matcher(text)
        while (primary.find()) {
            val number = primary.group(1)?.toIntOrNull() ?: continue
            val value = normalizeNumber(primary.group(2)) ?: continue
            if (number in 1..10 && seen.add(number)) {
                tps.add(value)
                val start = primary.start()
                if (earliestIndex == null || start < earliestIndex) {
                    earliestIndex = start
                }
            }
        }

        // Same TP numbers the primary pattern already claimed are skipped, so the two passes
        // cannot double-count a single line.
        val alternate = tpAltPattern.matcher(text)
        while (alternate.find()) {
            val number = alternate.group(1)?.toIntOrNull() ?: continue
            val value = normalizeNumber(alternate.group(2)) ?: continue
            if (number in 1..10 && seen.add(number)) {
                tps.add(value)
                val start = alternate.start()
                if (earliestIndex == null || start < earliestIndex) {
                    earliestIndex = start
                }
            }
        }

        return TpsResult(tps, earliestIndex)
    }

    /**
     * TP1 as the exact posted decimal string, so the deep link carries the same digits the
     * source wrote (a small value must not come out as scientific notation). Null when the post
     * did not label a TP1.
     */
    private fun extractTp1(text: String): String? {
        if (text.isBlank()) return null

        val primary = tpPattern.matcher(text)
        while (primary.find()) {
            if (primary.group(1)?.toIntOrNull() == 1) return normalizeDecimal(primary.group(2))
        }

        val alternate = tpAltPattern.matcher(text)
        while (alternate.find()) {
            if (alternate.group(1)?.toIntOrNull() == 1) return normalizeDecimal(alternate.group(2))
        }

        return null
    }

    /** Comma to dot, a bare `.0160` gains its leading zero, and anything non-decimal is dropped. */
    private fun normalizeDecimal(raw: String?): String? {
        if (raw == null) return null
        var value = raw.trim().replace(',', '.')
        if (value.startsWith('.')) value = "0$value"
        return if (Regex("^\\d+(\\.\\d+)?$").matches(value)) value else null
    }

    /** Accepts `0.016`, `0,016` and `.016` (a missing leading zero). */
    private fun normalizeNumber(raw: String?): Double? {
        if (raw.isNullOrBlank()) return null
        val value = raw.replace(',', '.').trim().toDoubleOrNull() ?: return null
        return if (value.isFinite()) value else null
    }

    private data class GemResult(
        val price: String?,
        val priceIndex: Int?
    )

    private data class CmpResult(
        val price: String?,
        val priceIndex: Int?
    )

    /**
     * Gem-format anchor: returns the posted market price as a plain decimal string, or null
     * unless the post carries both the constant marker phrase and a parseable price line —
     * a stray "current market price" mention without the marker is not a signal. Also captures
     * the start position of the price line so trailing cashtags after it are excluded from
     * ticker extraction.
     */
    private fun extractGemPrice(text: String): GemResult {
        if (text.isBlank() || !hasGemMarker(text)) return GemResult(null, null)

        val matcher = gemPricePattern.matcher(text)
        if (!matcher.find()) return GemResult(null, null)

        val priceIndex = matcher.start()
        // Comma decimal separator to dot; BigDecimal keeps the posted precision as-is.
        val normalized = matcher.group(1)?.replace(',', '.')?.trim() ?: return GemResult(null, priceIndex)
        val plain = try {
            java.math.BigDecimal(normalized).toPlainString()
        } catch (e: NumberFormatException) {
            null
        }
        return GemResult(plain, priceIndex)
    }

    private fun hasGemMarker(text: String): Boolean {
        val normalized = text.lowercase().filter { it.isLetterOrDigit() }
        return gemMarker in normalized
    }

    /**
     * Cmp-format anchor: returns the posted `CMP` price as a plain decimal string, or null
     * unless the post carries both a buy context marker (`Buy`, `Buying`, …) and a parseable
     * `CMP <price>` — e.g. `Buying CMP 0.000552`. Also captures the start position of the
     * price line so trailing cashtags after it are excluded from ticker extraction.
     */
    private fun extractCmpPrice(text: String): CmpResult {
        if (text.isBlank() || !hasBuyMarker(text)) return CmpResult(null, null)

        val matcher = cmpPricePattern.matcher(text)
        if (!matcher.find()) return CmpResult(null, null)

        val priceIndex = matcher.start()
        // Comma decimal separator to dot; BigDecimal keeps the posted precision as-is.
        val normalized = matcher.group(1)?.replace(',', '.')?.trim() ?: return CmpResult(null, priceIndex)
        return try {
            CmpResult(java.math.BigDecimal(normalized).toPlainString(), priceIndex)
        } catch (e: NumberFormatException) {
            CmpResult(null, priceIndex)
        }
    }

    private fun hasBuyMarker(text: String): Boolean {
        val normalized = text.lowercase().filter { it.isLetterOrDigit() }
        return "buy" in normalized
    }

    private fun launchTradeScreen(ticker: String, entryPrice: String? = null, tp1: String? = null) {
        val symbol = "${ticker.uppercase()}-USDT"
        val params = mutableListOf<String>()
        entryPrice?.let { params.add("entry=$it") }
        tp1?.let { params.add("tp1=$it") }
        val query = if (params.isEmpty()) "" else "?" + params.joinToString("&")
        val url = "snaptrade://trade/$symbol$query"
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

    /** Logs the exact notification extras that feed signal detection, with line breaks visible. */
    private fun logNotificationFields(sbn: StatusBarNotification) {
        val extras = sbn.notification.extras
        fun visible(value: CharSequence?): String =
            value?.toString()
                ?.replace("\\", "\\\\")
                ?.replace("\r", "\\r")
                ?.replace("\n", "\\n")
                ?.replace("\t", "\\t")
                ?.take(MAX_LOG_FIELD_CHARS)
                ?: ""

        log("NotificationFields", "title=${visible(extras?.getCharSequence(Notification.EXTRA_TITLE))}")
        log("NotificationFields", "text=${visible(extras?.getCharSequence(Notification.EXTRA_TEXT))}")
        log("NotificationFields", "bigText=${visible(extras?.getCharSequence(Notification.EXTRA_BIG_TEXT))}")
        log("NotificationFields", "subText=${visible(extras?.getCharSequence(Notification.EXTRA_SUB_TEXT))}")
        val textLines = extras?.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
        log(
            "NotificationFields",
            "textLines=${textLines?.joinToString(" | ") { visible(it) } ?: ""}"
        )
    }

}
