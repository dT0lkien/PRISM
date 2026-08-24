package main

import (
	"encoding/json"
	"strings"
	"testing"
)

var pins = Pins{RulesDir: "/Library/Application Support/Prism/rules", CachePath: "/Library/Application Support/Prism/cache.db", ClashAddr: "127.0.0.1:9291"}

func parse(t *testing.T, s string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatalf("тестовый конфиг не разобрался: %v", err)
	}
	return m
}

// Минимальный, но реалистичный конфиг из нашего генератора.
const goodCfg = `{
  "log": {"level": "info", "timestamp": true},
  "inbounds": [{"type":"tun","tag":"tun-in","address":["172.19.0.1/30"],"mtu":9000,"auto_route":true,"strict_route":true,"stack":"mixed"}],
  "outbounds": [
    {"type":"vless","tag":"proxy","server":"example.com","server_port":443,"uuid":"11111111-2222-3333-4444-555555555555",
     "tls":{"enabled":true,"server_name":"a.com","utls":{"enabled":true,"fingerprint":"chrome"}},
     "transport":{"type":"ws","path":"/ws","headers":{"Host":"a.com"}}},
    {"type":"selector","tag":"select","outbounds":["proxy"],"default":"proxy"},
    {"type":"direct","tag":"direct"}
  ],
  "route": {"final":"select","auto_detect_interface":true,
    "rules":[{"action":"route","outbound":"direct","ip_is_private":true},{"process_name":["Discord"],"outbound":"select","action":"route"}],
    "rule_set":[{"type":"local","tag":"geoip-ru","format":"binary","path":"/чужой/путь.srs"}],
    "default_domain_resolver":{"server":"dns-direct"}},
  "dns": {"servers":[{"type":"udp","tag":"dns-direct","server":"1.1.1.1"}],"final":"dns-direct","strategy":"prefer_ipv4"},
  "experimental": {"cache_file":{"enabled":true,"path":"/чужой/cache.db"},
    "clash_api":{"external_controller":"0.0.0.0:9291","secret":"s"}}
}`

func TestЛегитимныйКонфигПроходит(t *testing.T) {
	if _, err := Sanitize(parse(t, goodCfg), pins); err != nil {
		t.Fatalf("честный конфиг отвергнут: %v", err)
	}
}

func TestПиныПереставляются(t *testing.T) {
	out, err := Sanitize(parse(t, goodCfg), pins)
	if err != nil {
		t.Fatal(err)
	}
	exp := out["experimental"].(map[string]any)
	if got := exp["cache_file"].(map[string]any)["path"]; got != pins.CachePath {
		t.Errorf("cache_file.path не запинен: %v", got)
	}
	// Управляющий порт обязан остаться на петле, даже если прислали 0.0.0.0
	if got := exp["clash_api"].(map[string]any)["external_controller"]; got != pins.ClashAddr {
		t.Errorf("external_controller не запинен: %v", got)
	}
	rs := out["route"].(map[string]any)["rule_set"].([]any)[0].(map[string]any)
	want := pins.RulesDir + "/geoip-ru.srs"
	if rs["path"] != want {
		t.Errorf("rule_set.path не запинен: %v (ждали %v)", rs["path"], want)
	}
}

// Тот самый payload, что мы закрыли в разборе подписки. Здесь он означал бы
// уже не RCE в приложении, а подъём до root.
func TestTorOutboundОтвергается(t *testing.T) {
	// Полный payload: рубится белым списком путей ещё до проверки типа —
	// executable_path/extra_args генератор не порождает.
	full := parse(t, `{"outbounds":[{"type":"tor","tag":"pwn","executable_path":"/bin/sh","extra_args":["-c","id > /tmp/pwned"]}]}`)
	err := mustFail(t, full, "полный tor-payload")
	if !strings.Contains(err.Error(), "executable_path") && !strings.Contains(err.Error(), "extra_args") {
		t.Errorf("ожидали отказ по опасному ключу, получили: %v", err)
	}

	// Голый tor без лишних ключей: тут срабатывает уже проверка типа.
	bare := parse(t, `{"outbounds":[{"type":"tor","tag":"pwn","server":"127.0.0.1","server_port":9050}]}`)
	err = mustFail(t, bare, "голый tor")
	if !strings.Contains(err.Error(), `"tor"`) {
		t.Errorf("ожидали отказ по типу outbound, получили: %v", err)
	}
}

func mustFail(t *testing.T, cfg map[string]any, what string) error {
	t.Helper()
	_, err := Sanitize(cfg, pins)
	if err == nil {
		t.Fatalf("%s прошёл валидацию", what)
	}
	return err
}

func TestНеизвестныйКлючОтвергается(t *testing.T) {
	for _, bad := range []string{
		`{"log":{"level":"info","output":"/etc/crontab"}}`,
		`{"outbounds":[{"type":"direct","tag":"d","detour_exec":"/bin/sh"}]}`,
		`{"services":[{"type":"resolved"}]}`,
	} {
		if _, err := Sanitize(parse(t, bad), pins); err == nil {
			t.Errorf("прошёл конфиг, который не должен был: %s", bad)
		}
	}
}

func TestОбходКаталогаЧерезTagОтвергается(t *testing.T) {
	cfg := parse(t, `{"route":{"rule_set":[{"type":"local","tag":"../../../../etc/passwd","format":"binary","path":"x"}]}}`)
	if _, err := Sanitize(cfg, pins); err == nil {
		t.Fatal("обход каталога через tag прошёл")
	}
}

func TestЗапрещённыйInbound(t *testing.T) {
	cfg := parse(t, `{"inbounds":[{"type":"redirect","tag":"r","listen":"0.0.0.0","listen_port":1}]}`)
	if _, err := Sanitize(cfg, pins); err == nil {
		t.Fatal("посторонний inbound прошёл")
	}
}
