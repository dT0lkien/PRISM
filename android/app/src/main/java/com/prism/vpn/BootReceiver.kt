package com.prism.vpn

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.VpnService
import org.json.JSONObject

/**
 * Автоподключение после перезагрузки телефона.
 *
 * Для автозапуска нужен актуальный конфиг и выданное ранее разрешение на VPN:
 * системный диалог показывается лишь из открытого приложения, и без него служба
 * всё равно не смогла бы создать туннель.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val prefs = context.getSharedPreferences("prism", Context.MODE_PRIVATE)
        val enabled = runCatching {
            JSONObject(prefs.getString("settings", "{}") ?: "{}").optBoolean("autoConnect", false)
        }.getOrDefault(false)
        if (!enabled) return

        if (prefs.getString("activeNodeId", null).isNullOrBlank()) return
        // prepare возвращает намерение, когда разрешения ещё нет — значит молчим
        if (VpnService.prepare(context) != null) return
        if (TunnelStore.readConfig(context, requireCurrentProfile = true) == null) return

        context.startForegroundService(
            Intent(context, TunnelService::class.java).setAction(TunnelService.ACTION_CACHED_START)
        )
    }
}
