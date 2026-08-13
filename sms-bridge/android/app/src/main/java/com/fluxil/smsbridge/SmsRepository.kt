package com.fluxil.smsbridge

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class SmsPayload(
    val id: String,
    val address: String,
    val body: String,
    val timestamp: Long,
    val type: String = "received"
)

object SmsRepository {
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .writeTimeout(8, TimeUnit.SECONDS)
        .build()

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    fun sendSms(serverUrl: String, pairingCode: String, message: SmsPayload): Boolean {
        val payload = JSONObject()
            .put("id", message.id)
            .put("address", message.address)
            .put("body", message.body)
            .put("timestamp", message.timestamp)
            .put("type", message.type)

        val request = Request.Builder()
            .url("${serverUrl.trimEnd('/')}/api/messages")
            .addHeader("X-Pairing-Code", pairingCode)
            .post(payload.toString().toRequestBody(jsonMedia))
            .build()

        client.newCall(request).execute().use { response ->
            return response.isSuccessful
        }
    }

    fun sendMany(serverUrl: String, pairingCode: String, messages: List<SmsPayload>): Boolean {
        if (messages.isEmpty()) return true
        val arr = JSONArray()
        for (message in messages) {
            arr.put(
                JSONObject()
                    .put("id", message.id)
                    .put("address", message.address)
                    .put("body", message.body)
                    .put("timestamp", message.timestamp)
                    .put("type", message.type)
            )
        }
        val payload = JSONObject().put("messages", arr)
        val request = Request.Builder()
            .url("${serverUrl.trimEnd('/')}/api/messages")
            .addHeader("X-Pairing-Code", pairingCode)
            .post(payload.toString().toRequestBody(jsonMedia))
            .build()

        client.newCall(request).execute().use { response ->
            return response.isSuccessful
        }
    }

    fun ping(serverUrl: String, pairingCode: String): Boolean {
        val request = Request.Builder()
            .url("${serverUrl.trimEnd('/')}/api/session")
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return false
            val body = response.body?.string().orEmpty()
            val json = JSONObject(body)
            return json.optString("pairingCode").equals(pairingCode, ignoreCase = true)
        }
    }
}
