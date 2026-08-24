package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

/*
Смыкает генератор и валидатор: конфиги из helper/testdata сняты настоящим
buildConfig по всем сочетаниям режимов. Если генератор начнёт порождать
新 ключ, тест покраснеет здесь, а не у пользователя на запуске туннеля.
*/
func TestНастоящиеКонфигиГенератораПроходят(t *testing.T) {
	files, err := filepath.Glob("testdata/*.json")
	if err != nil || len(files) == 0 {
		t.Fatalf("не нашёл фикстуры: %v", err)
	}
	repo, _ := filepath.Abs("..")
	bin := filepath.Join(repo, "resources/core/mac/sing-box")
	rules := filepath.Join(repo, "resources/rules")
	outDir := t.TempDir()

	p := Pins{RulesDir: rules, CachePath: filepath.Join(outDir, "cache.db"), ClashAddr: "127.0.0.1:9291"}
	_, hasBin := os.Stat(bin)

	for _, f := range files {
		t.Run(filepath.Base(f), func(t *testing.T) {
			raw, err := os.ReadFile(f)
			if err != nil {
				t.Fatal(err)
			}
			var cfg map[string]any
			if err := json.Unmarshal(raw, &cfg); err != nil {
				t.Fatal(err)
			}
			clean, err := Sanitize(cfg, p)
			if err != nil {
				t.Fatalf("настоящий конфиг генератора отвергнут: %v", err)
			}
			// Пины обязаны сработать: в фикстуре лежит заведомо неверный путь кэша
			exp := clean["experimental"].(map[string]any)
			if got := exp["cache_file"].(map[string]any)["path"]; got != p.CachePath {
				t.Errorf("cache_file.path не переставлен: %v", got)
			}
			if hasBin != nil {
				t.Skip("ядра нет — проверку sing-box check пропускаем")
			}
			// Санитайзер не должен ломать конфиг: ядро обязано его принять
			out := filepath.Join(outDir, filepath.Base(f))
			b, _ := json.MarshalIndent(clean, "", "  ")
			if err := os.WriteFile(out, b, 0o600); err != nil {
				t.Fatal(err)
			}
			if o, err := exec.Command(bin, "check", "-c", out).CombinedOutput(); err != nil {
				t.Fatalf("sing-box отверг очищенный конфиг: %v\n%s", err, o)
			}
		})
	}
}
