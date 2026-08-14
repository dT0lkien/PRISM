import PrismCore
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @State private var showingAdd = false
    @State private var showingConfig = false

    var body: some View {
        NavigationStack {
            Group {
                if !model.coreIsReady {
                    CoreFailureView(message: model.failure ?? "Общее ядро не загрузилось")
                } else if model.nodes.isEmpty {
                    EmptyStateView(
                        onPaste: { showingAdd = true },
                        onSample: { model.addSampleNodes() }
                    )
                } else {
                    nodeList
                }
            }
            .navigationTitle("Prism")
            // Полоса состояния снаружи Group — иначе она видна только когда список
            // непустой, и при первом же добавлении ошибка уходит в никуда
            .safeAreaInset(edge: .bottom) { StatusBanner() }
            .toolbar {
                if model.coreIsReady && !model.nodes.isEmpty {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Конфиг", systemImage: "doc.text.magnifyingglass") {
                            showingConfig = true
                        }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Добавить", systemImage: "plus") { showingAdd = true }
                    }
                }
            }
            .sheet(isPresented: $showingAdd) { AddLinksSheet() }
            .sheet(isPresented: $showingConfig) { ConfigSheet() }
        }
    }

    private var nodeList: some View {
        List {
            Section {
                ConnectRow()
            }

            Section {
                ForEach(model.nodes) { node in
                    NodeRow(node: node, isActive: node.id == model.activeNodeId)
                        .contentShape(Rectangle())
                        .onTapGesture { model.activeNodeId = node.id }
                }
                .onDelete { model.remove(at: $0) }
            } header: {
                Text("Серверы")
            } footer: {
                Text("Туннель поднимается только на устройстве: в симуляторе NetworkExtension не запускается. Здесь проверяются разбор ссылок и сборка конфига.")
            }

        }
    }
}

// MARK: - Полоса состояния

/// Загрузка и сообщения. Показывается поверх любого экрана, включая пустой:
/// именно там пользователь добавляет первую подписку и должен видеть исход.
private struct StatusBanner: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        if model.isBusy || model.failure != nil {
            HStack(alignment: .top, spacing: 10) {
                if model.isBusy {
                    ProgressView()
                    Text("Загружаю подписку…")
                        .font(.footnote)
                } else if let failure = model.failure {
                    Image(systemName: "info.circle.fill")
                        .foregroundStyle(.orange)
                    Text(failure)
                        .font(.footnote)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                if !model.isBusy {
                    Button {
                        model.failure = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(12)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .animation(.default, value: model.isBusy)
        }
    }
}

// MARK: - Подключение

private struct ConnectRow: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var tunnel = TunnelController()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: tunnel.isConnected ? "lock.fill" : "lock.open")
                    .font(.title2)
                    .foregroundStyle(tunnel.isConnected ? Color.green : Color.secondary)
                    .frame(width: 28)

                VStack(alignment: .leading, spacing: 2) {
                    Text(tunnel.statusText).font(.body.weight(.medium))
                    if let node = model.nodes.first(where: { $0.id == model.activeNodeId }) {
                        Text(node.name).font(.caption).foregroundStyle(.secondary)
                    }
                }

                Spacer()

                if tunnel.isBusy {
                    ProgressView()
                } else {
                    Button(tunnel.isConnected ? "Отключить" : "Подключить") {
                        Task {
                            if tunnel.isConnected {
                                tunnel.disconnect()
                            } else if let config = try? model.configJSON() {
                                await tunnel.connect(configJSON: config)
                            } else {
                                tunnel.failure = "Не удалось собрать конфиг"
                            }
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                }
            }

            if let failure = tunnel.failure {
                Text(failure)
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
        .task { await tunnel.load() }
    }
}

// MARK: - Строка списка

private struct NodeRow: View {
    let node: ServerNode
    let isActive: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: isActive ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(isActive ? Color.accentColor : Color.secondary.opacity(0.4))
                .font(.title3)

            VStack(alignment: .leading, spacing: 3) {
                Text(node.name)
                    .font(.body.weight(isActive ? .semibold : .regular))
                    .lineLimit(1)
                // verbatim обязателен: обычная интерполяция в Text — это
                // локализуемая строка, и порт 8388 превращается в «8 388»
                Text(verbatim: "\(node.server):\(node.port)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            Text(node.type)
                .font(.caption2.weight(.medium))
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(badgeColor.opacity(0.15), in: Capsule())
                .foregroundStyle(badgeColor)
        }
        .padding(.vertical, 2)
    }

    /// Цвет по протоколу — чтобы список читался с одного взгляда
    private var badgeColor: Color {
        switch node.type {
        case "vless": .purple
        case "vmess": .blue
        case "trojan": .red
        case "shadowsocks": .green
        case "hysteria2", "hysteria": .orange
        case "tuic": .teal
        case "wireguard": .pink
        default: .gray
        }
    }
}

// MARK: - Пустой экран

private struct EmptyStateView: View {
    let onPaste: () -> Void
    let onSample: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "shield.lefthalf.filled")
                .font(.system(size: 56))
                .foregroundStyle(.tint)
            Text("Пока нет серверов")
                .font(.title3.weight(.semibold))
            Text("Вставь ссылки подписки — по одной на строку.\nПоддерживаются vless, vmess, trojan,\nshadowsocks, hysteria2 и tuic.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            VStack(spacing: 10) {
                Button(action: onPaste) {
                    Text("Вставить ссылки").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)

                Button("Добавить примеры", action: onSample)
                    .buttonStyle(.bordered)
            }
            .padding(.top, 4)
            .frame(maxWidth: 260)
        }
        .padding()
    }
}

// MARK: - Ошибка ядра

private struct CoreFailureView: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label("Общее ядро не загрузилось", systemImage: "xmark.octagon")
        } description: {
            Text(message)
        }
    }
}

// MARK: - Добавление ссылок

private struct AddLinksSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""

    var body: some View {
        NavigationStack {
            TextEditor(text: $text)
                .font(.system(.footnote, design: .monospaced))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .padding(.horizontal, 12)
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text("https://… — адрес подписки\n\nлибо ссылки, по одной на строку:\nvless://…\ntrojan://…")
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, 17)
                            .padding(.top, 8)
                            .allowsHitTesting(false)
                    }
                }
                // Коротко: рядом две кнопки, длинный заголовок обрезается
                .navigationTitle("Серверы")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Отмена") { dismiss() }
                    }
                    // Вставка в TextEditor на iOS требует тапа, долгого нажатия
                    // и выбора пункта меню. Промах по любому шагу оставляет поле
                    // пустым, кнопка «Добавить» остаётся серой, и нажатие на неё
                    // выглядит как полное бездействие приложения.
                    ToolbarItem(placement: .principal) {
                        Button("Вставить", systemImage: "doc.on.clipboard") {
                            if let clip = UIPasteboard.general.string, !clip.isEmpty {
                                text = clip
                            } else {
                                model.failure = "В буфере обмена пусто"
                            }
                        }
                        .labelStyle(.titleAndIcon)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Добавить") {
                            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                            // Одинокий http-адрес — это подписка, её надо скачать.
                            // Всё остальное разбираем как список ссылок.
                            if trimmed.lowercased().hasPrefix("http"), !trimmed.contains("\n") {
                                Task { await model.addSubscription(url: trimmed) }
                            } else {
                                model.addNodes(fromLinks: text)
                            }
                            dismiss()
                        }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
        }
    }
}

// MARK: - Просмотр конфига

private struct ConfigSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""

    var body: some View {
        NavigationStack {
            ScrollView([.horizontal, .vertical]) {
                Text(text)
                    .font(.system(size: 11, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
            }
            .navigationTitle("Конфиг sing-box")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { dismiss() }
                }
            }
            .task {
                do { text = try model.configJSON() } catch { text = "Ошибка: \(error.localizedDescription)" }
            }
        }
    }
}
