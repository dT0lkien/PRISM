package com.prism.vpn

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class PrismTileService : TileService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var listening: Job? = null
    private var action: Job? = null

    override fun onStartListening() {
        super.onStartListening()
        listening?.cancel()
        listening = scope.launch {
            TunnelService.phases.collect { phase ->
                qsTile?.apply {
                    state = when (phase) {
                        TunnelPhase.Connecting -> Tile.STATE_UNAVAILABLE
                        TunnelPhase.Off -> Tile.STATE_INACTIVE
                        else -> Tile.STATE_ACTIVE
                    }
                    if (Build.VERSION.SDK_INT >= 29) {
                        subtitle = when (phase) {
                            TunnelPhase.Off -> "Отключено"
                            TunnelPhase.Connecting -> "Подключение…"
                            TunnelPhase.On -> "Подключено"
                            TunnelPhase.Recovering, TunnelPhase.Blocked -> "Восстановление"
                        }
                    }
                    updateTile()
                }
            }
        }
    }

    override fun onStopListening() {
        listening?.cancel()
        listening = null
        super.onStopListening()
    }

    override fun onClick() {
        super.onClick()
        if (isLocked) unlockAndRun(::toggle) else toggle()
    }

    private fun toggle() {
        if (action?.isActive == true) return
        when (TunnelService.phase) {
            TunnelPhase.Connecting -> return
            TunnelPhase.Off -> action = scope.launch { connect() }
            else -> startService(Intent(this, TunnelService::class.java).setAction(TunnelService.ACTION_STOP))
        }
    }

    private suspend fun connect() {
        val hasConfig = withContext(Dispatchers.IO) {
            runCatching { TunnelStore.readConfig(this@PrismTileService, requireCurrentProfile = true) != null }
                .getOrDefault(false)
        }
        if (TunnelService.phase != TunnelPhase.Off) return
        if (!hasConfig || VpnService.prepare(this) != null) {
            openPrism()
            return
        }
        try {
            startForegroundService(Intent(this, TunnelService::class.java).setAction(TunnelService.ACTION_CACHED_START))
        } catch (_: IllegalStateException) {
            openPrism()
        } catch (_: SecurityException) {
            openPrism()
        }
    }

    // The PendingIntent overload is only available on Android 14 and newer.
    @SuppressLint("StartActivityAndCollapseDeprecated")
    @Suppress("DEPRECATION")
    private fun openPrism() {
        val intent = Intent(this, TileConnectActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) {
            val pending = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT)
            startActivityAndCollapse(pending)
        } else {
            startActivityAndCollapse(intent)
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
