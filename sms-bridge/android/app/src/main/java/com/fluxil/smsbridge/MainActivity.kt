package com.fluxil.smsbridge

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
    private lateinit var serverUrlInput: EditText
    private lateinit var pairingCodeInput: EditText
    private lateinit var statusView: TextView
    private lateinit var prefs: BridgePreferences

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        val granted = result.entries.all { it.value }
        statusView.text = if (granted) {
            getString(R.string.status_permissions_ok)
        } else {
            getString(R.string.status_permissions_missing)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = BridgePreferences(this)
        serverUrlInput = findViewById(R.id.serverUrl)
        pairingCodeInput = findViewById(R.id.pairingCode)
        statusView = findViewById(R.id.status)

        serverUrlInput.setText(prefs.serverUrl)
        pairingCodeInput.setText(prefs.pairingCode)

        findViewById<Button>(R.id.requestPermissions).setOnClickListener {
            requestNeededPermissions()
        }

        findViewById<Button>(R.id.connectButton).setOnClickListener {
            connect()
        }

        findViewById<Button>(R.id.disconnectButton).setOnClickListener {
            prefs.enabled = false
            stopService(Intent(this, BridgeForegroundService::class.java))
            statusView.text = getString(R.string.status_disconnected)
        }

        if (prefs.enabled && prefs.serverUrl.isNotBlank() && prefs.pairingCode.isNotBlank()) {
            startBridgeService()
            statusView.text = getString(R.string.status_connected)
        }
    }

    private fun connect() {
        val url = serverUrlInput.text.toString().trim().trimEnd('/')
        val code = pairingCodeInput.text.toString().trim().uppercase()

        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            Toast.makeText(this, R.string.error_bad_url, Toast.LENGTH_SHORT).show()
            return
        }
        if (code.length < 4) {
            Toast.makeText(this, R.string.error_bad_code, Toast.LENGTH_SHORT).show()
            return
        }

        prefs.serverUrl = url
        prefs.pairingCode = code
        prefs.enabled = true

        requestNeededPermissions()
        startBridgeService()
        statusView.text = getString(R.string.status_connected)
        Toast.makeText(this, R.string.toast_connected, Toast.LENGTH_SHORT).show()
    }

    private fun startBridgeService() {
        val intent = Intent(this, BridgeForegroundService::class.java)
        ContextCompat.startForegroundService(this, intent)
    }

    private fun requestNeededPermissions() {
        val needed = mutableListOf(
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_SMS
        )
        if (Build.VERSION.SDK_INT >= 33) {
            needed += Manifest.permission.POST_NOTIFICATIONS
        }

        val missing = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            permissionLauncher.launch(missing.toTypedArray())
        }
    }
}
