package com.fluxil.smsbridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import kotlin.concurrent.thread

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val prefs = BridgePreferences(context)
        if (!prefs.enabled || prefs.serverUrl.isBlank() || prefs.pairingCode.isBlank()) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isNullOrEmpty()) return

        val grouped = linkedMapOf<String, StringBuilder>()
        var timestamp = System.currentTimeMillis()
        var address = "לא ידוע"

        for (sms in messages) {
            address = sms.displayOriginatingAddress ?: address
            timestamp = sms.timestampMillis
            val key = address
            val builder = grouped.getOrPut(key) { StringBuilder() }
            builder.append(sms.displayMessageBody ?: "")
        }

        val pending = goAsync()
        thread {
            try {
                for ((addr, body) in grouped) {
                    val payload = SmsPayload(
                        id = "$timestamp-$addr-${body.toString().hashCode()}",
                        address = addr,
                        body = body.toString(),
                        timestamp = timestamp,
                        type = "received"
                    )
                    SmsRepository.sendSms(prefs.serverUrl, prefs.pairingCode, payload)
                }
            } finally {
                pending.finish()
            }
        }
    }
}
