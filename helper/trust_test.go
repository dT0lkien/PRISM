package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestДоверенныеСистемныеПутиПроходят(t *testing.T) {
	// Эти пути на любой живой macOS root:wheel, и все их предки тоже.
	for _, p := range []string{"/usr/bin/true", "/Library/LaunchDaemons", "/Library/PrivilegedHelperTools", "/"} {
		if _, err := os.Lstat(p); err != nil {
			t.Skipf("%s нет на этой машине", p)
		}
		if err := CheckTrusted(p); err != nil {
			t.Errorf("системный путь %s забракован: %v", p, err)
		}
	}
}

func TestКаталогПользователяНеДоверенный(t *testing.T) {
	dir := t.TempDir() // принадлежит текущему пользователю, не root
	f := filepath.Join(dir, "fake-core")
	if err := os.WriteFile(f, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	err := CheckTrusted(f)
	if err == nil {
		t.Fatal("путь в пользовательском каталоге признан доверенным — это лестница до root")
	}
	if !strings.Contains(err.Error(), "принадлежит uid") {
		t.Errorf("ожидали отказ по владельцу, получили: %v", err)
	}
}

func TestСимлинкВЦепочкеОтвергается(t *testing.T) {
	dir := t.TempDir()
	link := filepath.Join(dir, "link")
	if err := os.Symlink("/usr/bin", link); err != nil {
		t.Fatal(err)
	}
	if err := CheckTrusted(filepath.Join(link, "true")); err == nil {
		t.Fatal("цепочка через симлинк признана доверенной")
	}
}

// Главный сценарий: правильный владелец, но слишком широкие права.
func TestГрупповаяЗаписьОтвергается(t *testing.T) {
	// Проверяем саму логику прав на пути, который точно root-овый,
	// но чьи права мы подделаем не можем — поэтому проверяем предиката
	// на реальном каталоге с групповой записью.
	if _, err := os.Lstat("/var/run"); err != nil {
		t.Skip("/var/run недоступен")
	}
	// /var/run на macOS root:daemon 0775 — групповая запись есть
	err := CheckTrusted("/var/run")
	if err == nil {
		t.Skip("на этой машине /var/run не group-writable, сценарий не воспроизводится")
	}
	if !strings.Contains(err.Error(), "на запись не только root") {
		t.Errorf("ожидали отказ по правам, получили: %v", err)
	}
}

func TestCheckAllTrustedНазываетВиновника(t *testing.T) {
	dir := t.TempDir()
	err := CheckAllTrusted(Paths{Core: "/usr/bin/true", RulesDir: "/Library/LaunchDaemons", StateDir: dir})
	if err == nil {
		t.Fatal("пользовательский рабочий каталог прошёл проверку")
	}
	if !strings.Contains(err.Error(), "рабочий каталог") {
		t.Errorf("ошибка должна называть виновника, получили: %v", err)
	}
}

/*
Регрессия. Сокет сначала лежал в /var/run/prism — и демон не стартовал:

	CheckTrusted обходит всех предков, а сам /var/run на macOS root:daemon 0775.
	Место было выбрано как раз из-за групповой записи в /var/run, но проверка
	к нему всё равно применялась — противоречие, которое вылезло только при
	живой установке. Тест закрепляет инвариант: цепочка над сокетом обязана
	быть доверенной ещё до того, как каталог создан.
*/
func TestЦепочкаНадСокетомДоверенная(t *testing.T) {
	const sock = "/Library/Application Support/Prism/run/helper.sock"
	// Идём вверх до первого существующего предка: остальное создаст установщик.
	p := filepath.Dir(sock)
	for {
		if _, err := os.Lstat(p); err == nil {
			break
		}
		next := filepath.Dir(p)
		if next == p {
			t.Fatal("не нашлось ни одного существующего предка")
		}
		p = next
	}
	if err := CheckTrusted(p); err != nil {
		t.Fatalf("цепочка над сокетом недоверенная (%s): %v\nдемон с таким путём не стартует", p, err)
	}
	t.Logf("первый существующий предок: %s — доверенный", p)
}
