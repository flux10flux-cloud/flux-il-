package com.fluxil.smsbridge

import android.content.Context

class BridgePreferences(context: Context) {
    private val prefs = context.getSharedPreferences("flux_sms_bridge", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString("server_url", "") ?: ""
        set(value) = prefs.edit().putString("server_url", value).apply()

    var pairingCode: String
        get() = prefs.getString("pairing_code", "") ?: ""
        set(value) = prefs.edit().putString("pairing_code", value.uppercase()).apply()

    var enabled: Boolean
        get() = prefs.getBoolean("enabled", false)
        set(value) = prefs.edit().putBoolean("enabled", value).apply()
}
