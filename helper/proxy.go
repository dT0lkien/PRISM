package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

/*
Системный прокси.

Живёт в helper-е, а не в приложении, по необходимости: networksetup не setuid,
а право system.services.systemconfiguration.network требует пароля админа.
Из-под root он отрабатывает молча — иначе macOS спрашивала бы пароль при
каждом подключении.

Адрес прокси клиент не задаёт: всегда 127.0.0.1 и только порт. Приложению
незачем уводить системный трафик на чужой хост, а запрет убирает целый класс
неприятностей, если приложение когда-нибудь скомпрометируют.

Прежнее состояние сохраняем на диск, а не в память: демон может быть
перезапущен launchd-ом, и без файла мы бы не знали, что возвращать.
*/

type proxyState struct {
	Service string `json:"service"`
	Enabled bool   `json:"enabled"`
	Server  string `json:"server"`
	Port    string `json:"port"`
}

func (m *Manager) proxyBackupPath() string {
	return filepath.Join(m.paths.StateDir, "proxy-backup.json")
}

func networksetup(args ...string) (string, error) {
	out, err := exec.Command("/usr/sbin/networksetup", args...).CombinedOutput()
	s := strings.TrimSpace(string(out))
	if err != nil {
		return s, fmt.Errorf("networksetup %s: %v: %s", strings.Join(args, " "), err, s)
	}
	// networksetup любит сообщать об ошибке нулевым кодом возврата
	if strings.HasPrefix(s, "** Error") {
		return s, fmt.Errorf("networksetup %s: %s", strings.Join(args, " "), s)
	}
	return s, nil
}

// activeServices — сервисы, за которыми стоит живой интерфейс с адресом.
// Перебирать вообще все нельзя: на машине с USB-переходниками их десятки,
// и каждый вызов networksetup стоит десятки миллисекунд.
func activeServices() ([]string, error) {
	order, err := networksetup("-listnetworkserviceorder")
	if err != nil {
		return nil, err
	}
	var out []string
	var name string
	for _, line := range strings.Split(order, "\n") {
		line = strings.TrimSpace(line)
		// «(1) Wi-Fi» — имя сервиса; со звёздочкой значит отключён
		if strings.HasPrefix(line, "(") && !strings.HasPrefix(line, "(Hardware") {
			if i := strings.Index(line, ") "); i > 0 {
				name = strings.TrimSpace(line[i+2:])
				if strings.HasPrefix(name, "*") {
					name = ""
				}
			}
			continue
		}
		// «(Hardware Port: Wi-Fi, Device: en0)»
		if strings.HasPrefix(line, "(Hardware Port:") && name != "" {
			dev := ""
			if i := strings.Index(line, "Device: "); i > 0 {
				dev = strings.TrimSuffix(strings.TrimSpace(line[i+len("Device: "):]), ")")
			}
			if dev != "" && hasIPv4(dev) {
				out = append(out, name)
			}
			name = ""
		}
	}
	return out, nil
}

func hasIPv4(dev string) bool {
	out, err := exec.Command("/sbin/ifconfig", dev).Output()
	if err != nil {
		return false
	}
	for _, l := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(strings.TrimSpace(l), "inet ") {
			return true
		}
	}
	return false
}

// parseProxyOutput разбирает вывод -getsocksfirewallproxy / -getwebproxy.
func parseProxyOutput(s string) (enabled bool, server, port string) {
	for _, line := range strings.Split(s, "\n") {
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		switch k {
		case "Enabled":
			enabled = strings.EqualFold(v, "Yes")
		case "Server":
			server = v
		case "Port":
			port = v
		}
	}
	return
}

// SetSystemProxy направляет системный трафик в наш локальный порт.
func (m *Manager) SetSystemProxy(port int) error {
	if port < 1 || port > 65535 {
		return fmt.Errorf("порт вне диапазона: %d", port)
	}
	services, err := activeServices()
	if err != nil {
		return err
	}
	if len(services) == 0 {
		return fmt.Errorf("не нашлось ни одного активного сетевого сервиса")
	}

	var saved []proxyState
	for _, svc := range services {
		cur, err := networksetup("-getsocksfirewallproxy", svc)
		if err != nil {
			return err
		}
		en, srv, p := parseProxyOutput(cur)
		saved = append(saved, proxyState{Service: svc, Enabled: en, Server: srv, Port: p})
	}
	// Сохраняем до изменений: если на середине что-то отвалится, будет что вернуть.
	if b, err := json.Marshal(saved); err == nil {
		_ = os.WriteFile(m.proxyBackupPath(), b, 0o600)
	}

	for _, svc := range services {
		if _, err := networksetup("-setsocksfirewallproxy", svc, "127.0.0.1", strconv.Itoa(port)); err != nil {
			return err
		}
		if _, err := networksetup("-setsocksfirewallproxystate", svc, "on"); err != nil {
			return err
		}
	}
	return nil
}

// ClearSystemProxy возвращает то, что было до нас.
func (m *Manager) ClearSystemProxy() error {
	b, err := os.ReadFile(m.proxyBackupPath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil // мы прокси и не трогали
		}
		return err
	}
	var saved []proxyState
	if err := json.Unmarshal(b, &saved); err != nil {
		return err
	}
	var firstErr error
	for _, s := range saved {
		// Возвращаем ровно то, что было, включая чужой прокси.
		if s.Enabled && s.Server != "" && s.Server != "127.0.0.1" {
			if _, err := networksetup("-setsocksfirewallproxy", s.Service, s.Server, s.Port); err != nil && firstErr == nil {
				firstErr = err
			}
			if _, err := networksetup("-setsocksfirewallproxystate", s.Service, "on"); err != nil && firstErr == nil {
				firstErr = err
			}
			continue
		}
		if _, err := networksetup("-setsocksfirewallproxystate", s.Service, "off"); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	_ = os.Remove(m.proxyBackupPath())
	return firstErr
}
