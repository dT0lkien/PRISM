package main

import (
	"fmt"
	"path/filepath"
	"strings"
)

/*
Валидатор конфига, который будет исполнять ядро от root.

Модель угрозы: store.json лежит в домашнем каталоге и доступен на запись
пользователю, а значит и любому процессу под его учёткой. Поле extraConfig
вливается в конфиг последним через deepMerge и может переписать что угодно.
Поэтому helper не доверяет присланному конфигу вообще: он сверяет каждый
ключ с белым списком путей, которые реально порождает наш генератор, и
принудительно переставляет всё, через что можно дотянуться до файловой
системы или открыть управляющий порт наружу.

Белый список, а не чёрный: у sing-box богатая схема, и перечислить всё
опасное заведомо не выйдет. Плата — extraConfig на macOS ограничен теми же
ключами; неизвестный ключ вернёт внятную ошибку с его путём.
*/

// Белый список путей живёт в allowed_paths.go и генерируется скриптом
// scripts/gen-helper-paths.mjs из фикстур: держать его руками нельзя.

// Служебные типы тут разрешены, в отличие от разбора подписки: селекторы и
// direct/block создаёт сам генератор. Запрещён прежде всего `tor` — ядро
// запускает по executable_path внешний бинарник, а тут оно идёт от root.
var allowedOutboundTypes = map[string]bool{
	"vless": true, "vmess": true, "trojan": true, "shadowsocks": true, "hysteria2": true,
	"hysteria": true, "tuic": true, "anytls": true, "wireguard": true, "ssh": true,
	"http": true, "socks": true, "shadowtls": true,
	"selector": true, "urltest": true, "direct": true, "block": true, "dns": true,
}

var allowedInboundTypes = map[string]bool{"tun": true, "mixed": true}

// Pins — значения, которые helper ставит сам и не берёт у приложения.
type Pins struct {
	RulesDir  string // каталог с .srs, root-owned
	CachePath string // кэш ядра, root-owned
	ClashAddr string // всегда петля: наружу управляющий порт не открываем
}

// Sanitize проверяет конфиг и возвращает копию с переставленными пинами.
func Sanitize(cfg map[string]any, p Pins) (map[string]any, error) {
	if err := walk(cfg, "", 0); err != nil {
		return nil, err
	}
	if err := checkTypes(cfg); err != nil {
		return nil, err
	}
	return applyPins(cfg, p)
}

func pathAllowed(path string) bool {
	if allowedPaths[path] {
		return true
	}
	for _, pre := range allowedPrefixes {
		if strings.HasPrefix(path, pre) && !strings.Contains(path[len(pre):], ".") {
			return true
		}
	}
	return false
}

func walk(v any, path string, depth int) error {
	if depth > 32 {
		return fmt.Errorf("конфиг вложен слишком глубоко возле %q", path)
	}
	switch t := v.(type) {
	case map[string]any:
		for k, child := range t {
			next := k
			if path != "" {
				next = path + "." + k
			}
			if err := walk(child, next, depth+1); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range t {
			if err := walk(child, path+"[]", depth+1); err != nil {
				return err
			}
		}
	default:
		if !pathAllowed(path) {
			return fmt.Errorf("в конфиге ключ %q — его не создаёт генератор, а от root исполняется только known-good", path)
		}
	}
	return nil
}

func checkTypes(cfg map[string]any) error {
	check := func(key string, allowed map[string]bool, what string) error {
		list, _ := cfg[key].([]any)
		for i, it := range list {
			m, ok := it.(map[string]any)
			if !ok {
				return fmt.Errorf("%s[%d] не объект", key, i)
			}
			typ, _ := m["type"].(string)
			if !allowed[typ] {
				return fmt.Errorf("%s[%d]: тип %q запрещён", key, i, typ)
			}
		}
		return nil
	}
	if err := check("outbounds", allowedOutboundTypes, "outbound"); err != nil {
		return err
	}
	return check("inbounds", allowedInboundTypes, "inbound")
}

// applyPins переставляет всё, через что можно дотянуться до файловой системы
// или выставить управляющий порт наружу. Значения приложения игнорируются.
func applyPins(cfg map[string]any, p Pins) (map[string]any, error) {
	if exp, ok := cfg["experimental"].(map[string]any); ok {
		if cf, ok := exp["cache_file"].(map[string]any); ok {
			cf["path"] = p.CachePath
		}
		if api, ok := exp["clash_api"].(map[string]any); ok {
			api["external_controller"] = p.ClashAddr
		}
	}
	route, _ := cfg["route"].(map[string]any)
	if route == nil {
		return cfg, nil
	}
	sets, _ := route["rule_set"].([]any)
	for i, it := range sets {
		m, ok := it.(map[string]any)
		if !ok {
			continue
		}
		tag, _ := m["tag"].(string)
		// Тег уходит в имя файла — путь наружу каталога недопустим.
		if tag == "" || tag != filepath.Base(tag) || strings.ContainsAny(tag, `/\`) || strings.Contains(tag, "..") {
			return nil, fmt.Errorf("route.rule_set[%d]: недопустимый tag %q", i, tag)
		}
		m["path"] = filepath.Join(p.RulesDir, tag+".srs")
	}
	return cfg, nil
}
