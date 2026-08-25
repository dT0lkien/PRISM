package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
)

/*
prism-helper — привилегированный демон Prism.

Запускается launchd от root по LaunchDaemon-плисту. Всё, что демон считает
доверенным — путь к ядру, каталог правил, рабочий каталог и разрешённый uid —
приходит флагами из плиста. Плист root-owned, значит приложение эти значения
подменить не может; от приложения приходит только конфиг, и тот проходит
Sanitize (см. validate.go).

Собирается: go build -trimpath -ldflags "-s -w" -o prism-helper .
*/

var version = "1"

func main() {
	var (
		socketPath = flag.String("socket", "/Library/Application Support/Prism/run/helper.sock", "путь к unix-сокету")
		corePath   = flag.String("core", "", "путь к бинарю sing-box (root-owned)")
		rulesDir   = flag.String("rules", "", "каталог с .srs (root-owned)")
		stateDir   = flag.String("state", "", "рабочий каталог: конфиг и кэш (root-owned)")
		uid        = flag.Int("uid", -1, "uid, которому разрешено управлять туннелем")
		showVer    = flag.Bool("version", false, "показать версию и выйти")
	)
	flag.Parse()

	if *showVer {
		fmt.Println(version)
		return
	}

	log.SetFlags(log.LstdFlags)
	log.SetPrefix("prism-helper: ")

	if os.Geteuid() != 0 {
		log.Fatal("демон обязан работать от root — его запускает launchd")
	}
	if *uid < 0 {
		log.Fatal("не задан -uid: некому разрешать управление")
	}
	if *uid == 0 {
		log.Fatal("-uid 0 бессмысленен: root и так может всё")
	}
	for name, v := range map[string]string{"-core": *corePath, "-rules": *rulesDir, "-state": *stateDir} {
		if v == "" {
			log.Fatalf("не задан %s", name)
		}
	}

	// Рабочий каталог держим закрытым: в нём лежит конфиг с секретами серверов.
	if err := os.MkdirAll(*stateDir, 0o700); err != nil {
		log.Fatalf("не создать рабочий каталог: %v", err)
	}
	if err := os.Chmod(*stateDir, 0o700); err != nil {
		log.Fatalf("не выставить права на рабочий каталог: %v", err)
	}

	paths := Paths{Core: *corePath, RulesDir: *rulesDir, StateDir: *stateDir}

	// Сокет живёт не в /var/run: тот сам по себе root:daemon 0775, и проверка
	// доверенности обязана браковать всю цепочку — право переименовать каталог
	// равно праву подменить сокет, а через подменённый сокет с приложением
	// говорил бы кто угодно. В /Library/Application Support цепочка root-only.
	sockDir := filepath.Dir(*socketPath)
	if err := os.MkdirAll(sockDir, 0o755); err != nil {
		log.Fatalf("не создать каталог сокета: %v", err)
	}
	if err := os.Chmod(sockDir, 0o755); err != nil {
		log.Fatalf("не выставить права на каталог сокета: %v", err)
	}

	// Всё, чему демон доверяет, обязано принадлежать root и быть закрыто на
	// запись остальным. Если это не так, подделывать конфиг незачем — проще
	// подменить бинарь, который root запустит. Тогда лучше не стартовать.
	if err := CheckAllTrusted(paths); err != nil {
		log.Fatalf("отказываюсь стартовать: %v", err)
	}
	if err := CheckTrusted(sockDir); err != nil {
		log.Fatalf("отказываюсь стартовать: каталог сокета: %v", err)
	}

	mgr := NewManager(paths)
	ln, err := Listen(*socketPath, *uid)
	if err != nil {
		log.Fatalf("не поднять сокет %s: %v", *socketPath, err)
	}
	log.Printf("версия %s, сокет %s, разрешён uid %d", version, *socketPath, *uid)

	// launchd шлёт SIGTERM при выключении и при выгрузке задачи. Туннель за
	// собой уносим: ядро, пережившее демона, останется держать utun.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		s := <-sig
		log.Printf("сигнал %v — гашу ядро и выхожу", s)
		if err := mgr.Stop(); err != nil {
			log.Printf("ядро не погасло чисто: %v", err)
		}
		if err := mgr.ClearSystemProxy(); err != nil {
			log.Printf("системный прокси не снят: %v", err)
		}
		ln.Close()
		_ = os.Remove(*socketPath)
		os.Exit(0)
	}()

	d := NewDaemon(mgr, uint32(*uid))
	if err := d.Serve(ln); err != nil {
		log.Printf("сокет закрыт: %v", err)
	}
	_ = mgr.Stop()
	_ = mgr.ClearSystemProxy()
	_ = os.Remove(*socketPath)
}
