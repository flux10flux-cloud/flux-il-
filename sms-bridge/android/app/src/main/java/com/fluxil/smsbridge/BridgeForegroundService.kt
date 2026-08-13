package com.fluxil.smsbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.provider.Telephony
import androidx.core.app.NotificationCompat
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class BridgeForegroundService : Service() {
    private val prefs by lazy { BridgePreferences(this) }
    private val executor = Executors.newSingleThreadScheduledExecutor()
    private val started = AtomicBoolean(false)
    private var syncedHistory = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification(getString(R.string.service_running)))
        if (started.compareAndSet(false, true)) {
            executor.scheduleAtFixedRate({ heartbeat() }, 0, 20, TimeUnit.SECONDS)
        }
        return START_STICKY
    }

    private fun heartbeat() {
        if (!prefs.enabled) {
            stopSelf()
            return
        }
        try {
            val ok = SmsRepository.ping(prefs.serverUrl, prefs.pairingCode)
            if (ok && !syncedHistory) {
                syncedHistory = syncRecentInbox()
            }
            val text = if (ok) {
                getString(R.string.service_running)
            } else {
                getString(R.string.service_waiting)
            }
            val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(NOTIFICATION_ID, buildNotification(text))
        } catch (_: Exception) {
            val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(NOTIFICATION_ID, buildNotification(getString(R.string.service_waiting)))
        }
    }

    private fun syncRecentInbox(): Boolean {
        return try {
            val cursor = contentResolver.query(
                Telephony.Sms.Inbox.CONTENT_URI,
                arrayOf(
                    Telephony.Sms._ID,
                    Telephony.Sms.ADDRESS,
                    Telephony.Sms.BODY,
                    Telephony.Sms.DATE
                ),
                null,
                null,
                "${Telephony.Sms.DATE} DESC"
            ) ?: return false

            val payloads = mutableListOf<SmsPayload>()
            cursor.use {
                val idIdx = it.getColumnIndexOrThrow(Telephony.Sms._ID)
                val addressIdx = it.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
                val bodyIdx = it.getColumnIndexOrThrow(Telephony.Sms.BODY)
                val dateIdx = it.getColumnIndexOrThrow(Telephony.Sms.DATE)
                var count = 0
                while (it.moveToNext() && count < 40) {
                    payloads += SmsPayload(
                        id = "inbox-${it.getString(idIdx)}",
                        address = it.getString(addressIdx) ?: "לא ידוע",
                        body = it.getString(bodyIdx) ?: "",
                        timestamp = it.getLong(dateIdx),
                        type = "received"
                    )
                    count += 1
                }
            }
            SmsRepository.sendMany(prefs.serverUrl, prefs.pairingCode, payloads)
        } catch (_: Exception) {
            false
        }
    }

    private fun buildNotification(content: String): Notification {
        val channelId = "flux_sms_bridge"
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            channelId,
            getString(R.string.channel_name),
            NotificationManager.IMPORTANCE_LOW
        )
        manager.createNotificationChannel(channel)

        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(content)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        started.set(false)
        executor.shutdownNow()
        super.onDestroy()
    }

    companion object {
        private const val NOTIFICATION_ID = 42
    }
}
