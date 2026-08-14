import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.prism.vpn"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.prism.vpn"
        // Android 8: ниже нет ни нужных возможностей VpnService, ни движка JavaScript
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.1.0"

        ndk {
            // Только arm64: на нём работают все современные телефоны, и эмулятор
            // на маках Apple Silicon тоже. Каждая лишняя архитектура добавляет
            // к APK около 60 МБ — столько занимает ядро sing-box.
            abiFilters += listOf("arm64-v8a")
        }
    }

    buildFeatures {
        compose = true
        // Нужен для номера версии на экране «О программе»
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // Ключ подписи и пароли читаются из android/keystore.properties, которого
    // нет в git. Хранить их в build.gradle означало бы выложить ключ вместе с
    // исходниками, а подписанный им APK ставится поверх установленного.
    val keystoreFile = rootProject.file("keystore.properties")
    val keystore = Properties().apply {
        if (keystoreFile.exists()) keystoreFile.inputStream().use(::load)
    }

    signingConfigs {
        if (keystoreFile.exists()) {
            create("release") {
                storeFile = rootProject.file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // Отладку выключает сам тип сборки, но для VPN это принципиально:
            // с ней конфиг с ключами сервера читается любым процессом,
            // подключившимся отладчиком
            isDebuggable = false
            // R8 оставлен выключенным намеренно: ядро sing-box вызывается через
            // gomobile, и обрезка по отражению ломается молча, уже в работе
            isMinifyEnabled = false
            if (keystoreFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

// Правила маршрутизации берутся из общего каталога resources/rules, а не
// копируются в android/: 43 файла лежали бы в git дважды и разъезжались бы
// с Windows-сборкой. Все вместе они весят 350 КБ.
val rulesAssets = layout.buildDirectory.dir("generated/rulesAssets")

val copyRules by tasks.registering(Copy::class) {
    from(rootProject.file("../resources/rules")) { include("*.srs") }
    into(rulesAssets.map { it.dir("rules") })
}

android.sourceSets["main"].assets.srcDir(rulesAssets)
tasks.named("preBuild") { dependsOn(copyRules) }

dependencies {
    // Ядро sing-box, собранное скриптом scripts/build-libbox-android.sh.
    // В git не хранится: около ста мегабайт на архитектуру.
    implementation(fileTree("libs") { include("*.aar") })

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")

    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // Движок JavaScript для общего ядра: встроенного JavaScriptCore, как на iOS,
    // в Android нет, а этот работает на V8 из системного WebView и обменивается
    // строками — ровно та схема, что уже используется в PrismCore
    implementation("androidx.javascriptengine:javascriptengine:1.0.0-beta01")
    implementation("com.google.guava:guava:33.3.1-android")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
