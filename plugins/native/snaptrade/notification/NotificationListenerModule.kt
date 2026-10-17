package com.oxsabbir.snaptrade.notification

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import android.service.notification.StatusBarNotification
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.oxsabbir.snaptrade.NotificationListener

class NotificationListenerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "SnapTrade"
        private const val EVENT_NOTIFICATION_POSTED = "NotificationPosted"
        private const val EVENT_NOTIFICATION_REMOVED = "NotificationRemoved"

        private const val PREFS_NAME = "signal_settings"
        private const val PREFS_KEY_ENABLED = "signal_detection_enabled"
        private const val PREFS_KEY_DISPLAY_NAME = "signal_source_display_name"
        private const val DEFAULT_DISPLAY_NAME = "My Signal Source"

        /** Wide enough for several comma-separated sources ("Alpha Calls, Gem Hunter, ..."). */
        private const val MAX_DISPLAY_NAME_LENGTH = 80

        @Volatile
        var instance: NotificationListenerModule? = null
    }

    init {
        instance = this
    }

    override fun getName(): String = "NotificationListenerModule"

    fun onNotificationPosted(sbn: StatusBarNotification) {
        val extras = sbn.notification.extras
        val title = extras?.getString("android.title") ?: "no title"
        val text = extras?.getCharSequence("android.text")?.toString() ?: "no text"
        val bigText = extras?.getCharSequence("android.bigText")?.toString() ?: ""
        val subText = extras?.getCharSequence("android.subText")?.toString() ?: ""

        val params = Arguments.createMap()
        params.putString("packageName", sbn.packageName)
        params.putString("title", title)
        params.putString("text", text)
        params.putString("bigText", bigText)
        params.putString("subText", subText)
        params.putLong("postTime", sbn.postTime)
        params.putInt("id", sbn.id)

        sendEvent(EVENT_NOTIFICATION_POSTED, params)
    }

    fun onNotificationRemoved(sbn: StatusBarNotification) {
        val params = Arguments.createMap()
        params.putString("packageName", sbn.packageName)
        params.putInt("id", sbn.id)

        sendEvent(EVENT_NOTIFICATION_REMOVED, params)
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        try {
            val context = getReactApplicationContext()
            if (context.hasActiveCatalystInstance()) {
                context
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit(eventName, params)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send event: $eventName", e)
        }
    }

    @ReactMethod
    fun requestPermission(promise: Promise) {
        val intent = Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
        getReactApplicationContext().startActivity(intent)
        promise.resolve(Unit)
    }

    @ReactMethod
    fun isPermissionGranted(promise: Promise) {
        promise.resolve(isNotificationAccessGranted(getReactApplicationContext()))
    }

    // --- SharedPreferences mirror: the native listener reads these without the JS runtime. ---

    /**
     * Mirror the two settings the native [NotificationListener] reads out of the JS store.
     * Called whenever the toggle or the display name changes, including after hydration.
     */
    @ReactMethod
    fun syncSignalSettings(enabled: Boolean, displayName: String, promise: Promise) {
        val next = sanitizeDisplayName(displayName)
        prefs().edit()
            .putBoolean(PREFS_KEY_ENABLED, enabled)
            .putString(PREFS_KEY_DISPLAY_NAME, next)
            .apply()
        promise.resolve(next)
    }

    @ReactMethod
    fun setDisplayName(value: String, promise: Promise) {
        val next = sanitizeDisplayName(value)
        prefs().edit().putString(PREFS_KEY_DISPLAY_NAME, next).apply()
        promise.resolve(next)
    }

    @ReactMethod
    fun setIsEnabled(value: Boolean, promise: Promise) {
        prefs().edit().putBoolean(PREFS_KEY_ENABLED, value).apply()
        promise.resolve(Unit)
    }

    private fun sanitizeDisplayName(value: String): String {
        val cleaned = value.trim().replace("\\s+".toRegex(), " ").take(MAX_DISPLAY_NAME_LENGTH)
        return cleaned.ifEmpty { DEFAULT_DISPLAY_NAME }
    }

    private fun prefs() =
        getReactApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    // --- Permissions ---

    /** One call for the permissions screen to render every status it has to surface. */
    @ReactMethod
    fun getPermissionStatus(promise: Promise) {
        val context = getReactApplicationContext()
        val status = Arguments.createMap()
        status.putBoolean("notificationAccess", isNotificationAccessGranted(context))
        status.putBoolean("overlay", Settings.canDrawOverlays(context))
        status.putBoolean(
            "ignoringBatteryOptimizations",
            isIgnoringBatteryOptimizations(context)
        )
        promise.resolve(status)
    }

    @ReactMethod
    fun checkOverlayPermission(promise: Promise) {
        promise.resolve(Settings.canDrawOverlays(getReactApplicationContext()))
    }

    @ReactMethod
    fun requestOverlayPermission(promise: Promise) {
        val context = getReactApplicationContext()
        val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
            .setData(Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        promise.resolve(Unit)
    }

    @ReactMethod
    fun openBatteryOptimizationSettings() {
        val context = getReactApplicationContext()
        val request = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(request)
        } catch (t: Throwable) {
            val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(fallback)
        }
    }

    @ReactMethod
    fun openAutostartSettings() {
        val context = getReactApplicationContext()
        // Manufacturer autostart pages are not standard; try the known ones and fall back to the
        // app's details page. resolveActivity is unreliable on API 30+, so just attempt the start.
        val candidates = listOf(
            ComponentName(
                "com.miui.securitycenter",
                "com.miui.permcenter.autostart.AutoStartManagementActivity"
            ),
            ComponentName(
                "com.huawei.systemmanager",
                "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"
            ),
            ComponentName(
                "com.coloros.safecenter",
                "com.coloros.safecenter.permission.startup.StartupAppListActivity"
            ),
            ComponentName(
                "com.vivo.permissionmanager",
                "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"
            ),
            ComponentName(
                "com.samsung.android.lool",
                "com.samsung.android.sm.ui.battery.BatteryActivity"
            )
        )
        for (component in candidates) {
            try {
                context.startActivity(
                    Intent().setComponent(component).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
                return
            } catch (_: Throwable) {
                // Try the next manufacturer.
            }
        }
        context.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    // --- Listener resilience ---

    @ReactMethod
    fun requestRebind(promise: Promise) {
        NotificationListener.requestRebind(getReactApplicationContext())
        promise.resolve(true)
    }

    /** Kept for existing callers. */
    @ReactMethod
    fun rebindListener(promise: Promise) {
        NotificationListener.requestRebind(getReactApplicationContext())
        promise.resolve(true)
    }

    private fun isNotificationAccessGranted(context: Context): Boolean {
        val enabled = Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners"
        ) ?: return false
        return enabled.split(':').any { entry ->
            ComponentName.unflattenFromString(entry)?.packageName == context.packageName
        }
    }

    private fun isIgnoringBatteryOptimizations(context: Context): Boolean {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            ?: return false
        return powerManager.isIgnoringBatteryOptimizations(context.packageName)
    }
}
