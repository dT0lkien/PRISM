package main

import "testing"

func TestРазборВыводаNetworksetup(t *testing.T) {
	cases := []struct {
		name          string
		in            string
		wantEn        bool
		wantSrv, want string
	}{
		{"выключен", "Enabled: No\nServer: \nPort: 0\nAuthenticated Proxy Enabled: 0", false, "", "0"},
		{"включён чужой", "Enabled: Yes\nServer: 10.0.0.1\nPort: 3128\nAuthenticated Proxy Enabled: 0", true, "10.0.0.1", "3128"},
		{"наш", "Enabled: Yes\nServer: 127.0.0.1\nPort: 2080\nAuthenticated Proxy Enabled: 0", true, "127.0.0.1", "2080"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			en, srv, port := parseProxyOutput(c.in)
			if en != c.wantEn || srv != c.wantSrv || port != c.want {
				t.Errorf("разобрано (%v, %q, %q), ожидалось (%v, %q, %q)", en, srv, port, c.wantEn, c.wantSrv, c.want)
			}
		})
	}
}

// Только чтение: настройки сети не трогаем.
func TestПереборАктивныхСервисов(t *testing.T) {
	svc, err := activeServices()
	if err != nil {
		t.Skipf("networksetup недоступен: %v", err)
	}
	t.Logf("активных сервисов: %d — %v", len(svc), svc)
	if len(svc) == 0 {
		t.Skip("на машине нет активных сетевых сервисов")
	}
	// Смысл фильтра: отсеять десятки USB-переходников без адреса.
	all, err := networksetup("-listallnetworkservices")
	if err != nil {
		t.Fatal(err)
	}
	total := 0
	for _, l := range splitLines(all) {
		if l != "" && !hasPrefix(l, "An asterisk") {
			total++
		}
	}
	if total > 0 && len(svc) >= total {
		t.Errorf("фильтр не отсеял ничего: активных %d из %d всего", len(svc), total)
	}
	t.Logf("всего сервисов на машине: %d, отобрано активных: %d", total, len(svc))
}

func splitLines(s string) []string {
	var out []string
	cur := ""
	for _, r := range s {
		if r == '\n' {
			out = append(out, cur)
			cur = ""
			continue
		}
		cur += string(r)
	}
	return append(out, cur)
}

func hasPrefix(s, p string) bool { return len(s) >= len(p) && s[:len(p)] == p }
