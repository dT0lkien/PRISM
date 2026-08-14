package com.prism.vpn

import android.content.Context
import androidx.javascriptengine.JavaScriptIsolate
import androidx.javascriptengine.JavaScriptSandbox
import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.Executor
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject

/**
 * Мост к общему ядру Prism.
 *
 * Собственной логики разбора ссылок и сборки конфига здесь нет: исполняется
 * assets/shared.js, собранный из TypeScript в каталоге src/shared — тех же
 * файлов, на которых работают Windows-версия и iOS. Пересборка бандла:
 * npm run build:shared
 *
 * На iOS ту же роль выполняет JavaScriptCore, встроенный в систему. В Android
 * его нет, поэтому берётся androidx.javascriptengine: он работает на движке V8
 * из системного WebView, исполняет код в отдельном изолированном процессе и
 * обменивается с приложением строками. Схема обмена в итоге та же, что в
 * PrismCore на Swift, — JSON внутрь, JSON наружу.
 */
class PrismCore private constructor(
    private val sandbox: JavaScriptSandbox,
    private val isolate: JavaScriptIsolate
) : AutoCloseable {

    class Failure(message: String, cause: Throwable? = null) : Exception(message, cause)

    companion object {
        private const val BUNDLE = "shared.js"

        suspend fun create(context: Context): PrismCore {
            if (!JavaScriptSandbox.isSupported()) {
                throw Failure("Системный WebView слишком старый: движок JavaScript недоступен")
            }
            val sandbox = try {
                JavaScriptSandbox.createConnectedInstanceAsync(context).await()
            } catch (e: Throwable) {
                throw Failure("Не удалось запустить движок JavaScript", e)
            }

            val isolate = sandbox.createIsolate()
            val source = try {
                context.assets.open(BUNDLE).bufferedReader().use { it.readText() }
            } catch (e: Throwable) {
                sandbox.close()
                throw Failure("Общее ядро не найдено в ресурсах: соберите npm run build:shared", e)
            }

            try {
                isolate.evaluateJavaScriptAsync(source).await()
            } catch (e: Throwable) {
                sandbox.close()
                throw Failure("Общее ядро не загрузилось", e)
            }
            return PrismCore(sandbox, isolate)
        }
    }

    override fun close() {
        isolate.close()
        sandbox.close()
    }

    // MARK: - Вызовы ядра

    /**
     * Движок возвращает значение последнего выражения строкой, поэтому каждый
     * вызов заворачивается в JSON.stringify — ровно как в версии на Swift.
     */
    private suspend fun eval(expression: String): String =
        try {
            isolate.evaluateJavaScriptAsync("JSON.stringify($expression)").await()
        } catch (e: Throwable) {
            throw Failure("Ошибка в общем ядре: ${e.message}", e)
        }

    private suspend fun evalObject(expression: String): JSONObject =
        JSONObject(eval(expression))

    private suspend fun evalArray(expression: String): JSONArray =
        JSONArray(eval(expression))

    /** Строка → безопасный литерал JavaScript */
    private fun quote(value: String?): String =
        if (value == null) "undefined" else JSONObject.quote(value)

    // MARK: - Настройки и пресеты

    suspend fun defaultSettings(): JSONObject = evalObject("PrismShared.DEFAULT_SETTINGS")

    suspend fun defaultEnabledPresets(): List<String> =
        evalArray("PrismShared.DEFAULT_ENABLED_PRESETS").toStringList()

    // MARK: - Узлы

    /** Разбирает список ссылок, по одной на строку. Нераспознанные пропускаются. */
    suspend fun nodesFromLinks(text: String): List<ServerNode> {
        val array = evalArray(
            """
            ${quote(text)}.split(/\r?\n/)
              .map(function (line) { return line.trim() })
              .filter(Boolean)
              .map(function (line) {
                var parsed = PrismShared.parseLink(line);
                return parsed ? PrismShared.parsedToNode(parsed, { link: line }) : null;
              })
              .filter(Boolean)
            """.trimIndent()
        )
        return array.toNodeList()
    }

    /**
     * Разбирает тело подписки: список ссылок, его же в base64 или конфиг sing-box.
     *
     * Clash YAML пропускается — разбор YAML требует стороннего пакета, которого
     * в движке нет. Ровно то же ограничение, что и на iOS.
     */
    suspend fun nodesFromSubscription(body: String, subscriptionId: String?): List<ServerNode> =
        evalArray(
            "PrismShared.parseSubscriptionBody(${quote(body)}, ${quote(subscriptionId)})"
        ).toNodeList()

    /**
     * Ключ узла для отсева дублей. Зависит от адреса и секрета, но не от имени:
     * в подписках один и тот же сервер часто приезжает переименованным.
     */
    suspend fun nodeKey(node: ServerNode): String =
        eval("PrismShared.nodeKey(${node.json})").trim('"')

    // MARK: - Конфиг

    /** Собирает конфиг sing-box в том виде, в каком его получит туннель. */
    suspend fun configJson(
        nodes: List<ServerNode>,
        activeNodeId: String?,
        cachePath: String
    ): String {
        val settings = defaultSettings()
        val presets = JSONArray(defaultEnabledPresets())
        val nodesJson = JSONArray().apply { nodes.forEach { put(it.json) } }

        return eval(
            """
            PrismShared.buildConfig({
              settings: $settings,
              platform: 'android',
              nodes: $nodesJson,
              activeNodeId: ${quote(activeNodeId)},
              appRules: [],
              customRules: [],
              enabledPresets: $presets,
              rulesDir: '',
              cachePath: ${quote(cachePath)},
              clashSecret: 'prism'
            })
            """.trimIndent()
        )
    }
}

/**
 * Узел хранится как JSON целиком: он уходит обратно в ядро при сборке конфига,
 * и раскладывать его по полям значило бы рисковать потерей чего-нибудь из
 * outbound при обратном превращении.
 */
data class ServerNode(val json: JSONObject) {
    val id: String get() = json.optString("id")
    val name: String get() = json.optString("name")
    val type: String get() = json.optString("type")
    val server: String get() = json.optString("server")
    val port: Int get() = json.optInt("port")

    fun withName(value: String): ServerNode =
        ServerNode(JSONObject(json.toString()).put("name", value))
}

// MARK: - Мелкие помощники

private fun JSONArray.toStringList(): List<String> =
    (0 until length()).map { optString(it) }

private fun JSONArray.toNodeList(): List<ServerNode> =
    (0 until length()).mapNotNull { optJSONObject(it)?.let(::ServerNode) }

/** Ожидание ListenableFuture без отдельной зависимости на kotlinx-coroutines-guava */
private suspend fun <T> ListenableFuture<T>.await(): T =
    suspendCancellableCoroutine { continuation ->
        val direct = Executor { it.run() }
        addListener({
            try {
                continuation.resume(get())
            } catch (e: Throwable) {
                continuation.resumeWithException(e.cause ?: e)
            }
        }, direct)
        continuation.invokeOnCancellation { cancel(false) }
    }
