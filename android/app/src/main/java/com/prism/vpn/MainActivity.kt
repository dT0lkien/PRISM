package com.prism.vpn

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.net.VpnService
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.flow.MutableStateFlow

private val tileConnectionRequested = MutableStateFlow(false)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val model: AppViewModel = viewModel()
            PrismTheme {
                SideEffect {
                    WindowCompat.getInsetsController(window, window.decorView).apply {
                        isAppearanceLightStatusBars = false
                        isAppearanceLightNavigationBars = false
                    }
                }

                // Служба живёт дольше экрана и меняет состояние сама: связь
                // теряется, возвращается, туннель может остановиться. Экран
                // сверяется с ней постоянно, а не только при открытии.
                LaunchedEffect(Unit) { model.watchTunnel() }

                val notifications = rememberLauncherForActivityResult(
                    ActivityResultContracts.RequestPermission()
                ) { model.connect() }
                val connect = {
                    val preferences = getPreferences(MODE_PRIVATE)
                    if (Build.VERSION.SDK_INT >= 33 &&
                        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
                        !preferences.getBoolean("notifications_requested", false)
                    ) {
                        preferences.edit().putBoolean("notifications_requested", true).apply()
                        notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else {
                        model.connect()
                    }
                    Unit
                }

                // Разрешение на туннель выдаёт пользователь системным диалогом.
                // Никаких платных аккаунтов и особых прав, в отличие от iOS.
                val consent = rememberLauncherForActivityResult(
                    ActivityResultContracts.StartActivityForResult()
                ) { result ->
                    if (result.resultCode == Activity.RESULT_OK) {
                        connect()
                    } else {
                        model.status = "Без разрешения системы туннель не поднять"
                    }
                }

                val requestConnection = {
                    val intent = VpnService.prepare(this@MainActivity)
                    // null означает, что разрешение уже выдано раньше
                    if (intent == null) connect() else consent.launch(intent)
                }
                val pendingTileConnection by tileConnectionRequested.collectAsState()
                val lifecycleState by lifecycle.currentStateFlow.collectAsState()
                LaunchedEffect(model.core, pendingTileConnection, lifecycleState) {
                    if (pendingTileConnection && model.core != null && lifecycleState == Lifecycle.State.RESUMED) {
                        tileConnectionRequested.value = false
                        if (model.nodes.isEmpty()) {
                            model.status = "Добавьте сервер для подключения из шторки"
                        } else if (TunnelService.phase == TunnelPhase.Off) {
                            requestConnection()
                        }
                    }
                }
                HomeScreen(model, onConnectRequested = requestConnection)
            }
        }
    }
}

class TileConnectActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        tileConnectionRequested.value = true
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        )
        finish()
    }
}
