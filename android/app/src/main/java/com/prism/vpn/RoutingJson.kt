package com.prism.vpn

import android.util.JsonReader
import android.util.JsonToken
import java.io.StringReader
import org.json.JSONArray
import org.json.JSONObject

internal object RoutingJson {
    const val MAX_LENGTH = 128 * 1024
    const val EMPTY = "{\n  \"route\": {}\n}"
    const val EXAMPLE = """{
  "route": {
    "rules": [
      { "domain_suffix": ["example.org"], "action": "route", "outbound": "direct" },
      { "ip_cidr": ["203.0.113.0/24"], "action": "reject" }
    ]
  }
}"""

    fun format(text: String, extractRoute: Boolean = false): String {
        require(text.length <= MAX_LENGTH) { "Файл маршрутов слишком большой" }
        JsonReader(StringReader(text)).use { reader ->
            require(reader.peek() == JsonToken.BEGIN_OBJECT) { "Ожидается объект JSON" }
            var depth = 0
            do {
                when (reader.peek()) {
                    JsonToken.BEGIN_OBJECT -> {
                        reader.beginObject()
                        depth++
                    }
                    JsonToken.BEGIN_ARRAY -> {
                        reader.beginArray()
                        depth++
                    }
                    JsonToken.END_OBJECT -> {
                        reader.endObject()
                        depth--
                    }
                    JsonToken.END_ARRAY -> {
                        reader.endArray()
                        depth--
                    }
                    JsonToken.NAME -> reader.nextName()
                    JsonToken.END_DOCUMENT -> error("Объект JSON не закрыт")
                    else -> reader.skipValue()
                }
                require(depth <= 64) { "Слишком много вложенных объектов в JSON" }
            } while (depth > 0)
            require(reader.peek() == JsonToken.END_DOCUMENT) { "После объекта JSON есть лишний текст" }
        }
        val patch = JSONObject(text)
        require(extractRoute || patch.length() == 1) { "В редакторе поддерживается секция route" }
        val route = patch.optJSONObject("route") ?: error("Добавьте объект route")
        return JSONObject().put("route", route).toString(2)
    }

    fun apply(config: String, patch: String): String {
        if (patch.isBlank()) return config
        val document = JSONObject(config)
        val route = document.getJSONObject("route")
        val custom = JSONObject(format(patch)).getJSONObject("route")
        val outbounds = document.getJSONArray("outbounds")
        val tags = (0 until outbounds.length()).map { outbounds.getJSONObject(it).getString("tag") }.toSet()
        val customRules = if (custom.has("rules")) custom.getJSONArray("rules") else JSONArray()
        val generated = route.getJSONArray("rules")
        val merged = JSONArray()

        // Sniff and DNS interception precede custom traffic rules.
        val serviceActions = setOf("sniff", "hijack-dns")
        for (index in 0 until generated.length()) {
            val rule = generated.getJSONObject(index)
            if (rule.optString("action") in serviceActions) merged.put(rule)
        }
        for (index in 0 until customRules.length()) {
            val rule = customRules.getJSONObject(index)
            val outbound = rule.optString("outbound")
            require(outbound.isEmpty() || outbound in tags) { "Правило ${index + 1}: неизвестный outbound «$outbound»" }
            merged.put(rule)
        }
        for (index in 0 until generated.length()) {
            val rule = generated.getJSONObject(index)
            if (rule.optString("action") !in serviceActions) merged.put(rule)
        }
        route.put("rules", merged)

        if (custom.has("rule_set")) {
            val sets = linkedMapOf<String, JSONObject>()
            val existing = route.optJSONArray("rule_set") ?: JSONArray()
            val overrides = custom.getJSONArray("rule_set")
            for (index in 0 until existing.length()) {
                val set = existing.getJSONObject(index)
                sets[set.getString("tag")] = set
            }
            val userTags = mutableSetOf<String>()
            for (index in 0 until overrides.length()) {
                val set = overrides.getJSONObject(index)
                val tag = set.getString("tag")
                require(tag.isNotBlank() && userTags.add(tag)) { "Повторяющийся или пустой тег rule_set «$tag»" }
                sets[tag] = set
            }
            route.put("rule_set", JSONArray(sets.values.toList()))
        }

        for (key in custom.keys()) {
            if (key != "rules" && key != "rule_set") route.put(key, custom.get(key))
        }
        val finalTag = route.optString("final")
        require(finalTag.isEmpty() || finalTag in tags) { "Неизвестный outbound в route.final «$finalTag»" }
        return document.toString()
    }
}
