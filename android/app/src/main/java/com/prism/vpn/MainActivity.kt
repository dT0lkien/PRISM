package com.prism.vpn

import android.app.Activity
import android.net.VpnService
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.viewmodel.compose.viewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PrismTheme {
                val model: AppViewModel = viewModel()

                // Служба живёт дольше экрана: при возврате состояние сверяется,
                // иначе кнопка покажет «отключено» у работающего туннеля
                LaunchedEffect(Unit) { model.syncTunnelState() }

                // Разрешение на туннель выдаёт пользователь системным диалогом.
                // Никаких платных аккаунтов и особых прав, в отличие от iOS.
                val consent = rememberLauncherForActivityResult(
                    ActivityResultContracts.StartActivityForResult()
                ) { result ->
                    if (result.resultCode == Activity.RESULT_OK) {
                        model.connect()
                    } else {
                        model.status = "Без разрешения системы туннель не поднять"
                    }
                }

                HomeScreen(model) {
                    val intent = VpnService.prepare(this@MainActivity)
                    // null означает, что разрешение уже выдано раньше
                    if (intent == null) model.connect() else consent.launch(intent)
                }
            }
        }
    }
}
