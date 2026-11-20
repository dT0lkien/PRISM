package com.prism.vpn

import android.content.Context
import android.os.SystemClock
import io.nekohasekai.libbox.Libbox
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import org.json.JSONArray
import org.json.JSONObject

internal enum class PingMethod { TCP, URL }

internal sealed interface PingResult {
    data object Pending : PingResult
    data object Unavailable : PingResult
    data class Delay(val milliseconds: Long) : PingResult
}

internal fun measureServer(context: Context, node: ServerNode, method: PingMethod): PingResult {
    return try {
        val milliseconds = when (method) {
            PingMethod.TCP -> tcpDelay(node)
            PingMethod.URL -> urlDelay(context, node)
        }
        PingResult.Delay(milliseconds.coerceAtLeast(1))
    } catch (_: Exception) {
        PingResult.Unavailable
    }
}

private fun tcpDelay(node: ServerNode): Long {
    val destination = InetSocketAddress(node.server, node.port)
    return Socket().use { socket ->
        val started = SystemClock.elapsedRealtimeNanos()
        socket.connect(destination, 4_000)
        (SystemClock.elapsedRealtimeNanos() - started) / 1_000_000
    }
}

private fun urlDelay(context: Context, node: ServerNode): Long {
    TunnelStore.setupCore(context)
    val outbound = JSONObject(node.json.getJSONObject("outbound").toString()).put("tag", "probe")
    // Resolve the server through Android and preserve its hostname in the outbound for TLS.
    val host = outbound.getString("server")
    val addresses = InetAddress.getAllByName(host).mapNotNull { it.hostAddress?.substringBefore('%') }
    val resolver = JSONObject()
        .put("type", "hosts")
        .put("tag", "dns-direct")
        .put("predefined", JSONObject().put(host, JSONArray(addresses)))
    val config = JSONObject()
        .put("log", JSONObject().put("disabled", true))
        .put("dns", JSONObject().put("servers", JSONArray().put(resolver)))
        .put("outbounds", JSONArray().put(outbound))
        .put("route", JSONObject().put("final", "probe").put("default_domain_resolver", "dns-direct"))
    return Libbox.prismProbeURL(config.toString(), "https://www.gstatic.com/generate_204").toLong()
}
