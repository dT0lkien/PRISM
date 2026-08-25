package main

import (
	"bufio"
	"encoding/json"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

/* Поднимает настоящий демон на временном сокете с подставным «ядром».
   root не нужен: проверка на root живёт в main(), а логика — здесь. */

const fakeCore = `#!/bin/sh
echo "ядро стартовало, конфиг: $3"
echo "второй строкой, чтобы проверить поток"
# держимся, пока не прибьют
while true; do sleep 0.1; done
`

type client struct {
	conn *net.UnixConn
	sc   *bufio.Scanner
}

func dial(t *testing.T, sock string) *client {
	t.Helper()
	c, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: sock, Net: "unix"})
	if err != nil {
		t.Fatalf("не подключиться: %v", err)
	}
	sc := bufio.NewScanner(c)
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	return &client{conn: c, sc: sc}
}

func (c *client) send(t *testing.T, v any) {
	t.Helper()
	b, _ := json.Marshal(v)
	if _, err := c.conn.Write(append(b, '\n')); err != nil {
		t.Fatalf("не отправить: %v", err)
	}
}

// next читает следующую строку. skipEvents=true — ждём именно ответ на
// команду, пропуская поток событий (log, exit), который идёт вперемешку.
func (c *client) next(t *testing.T, skipEvents bool) map[string]any {
	t.Helper()
	_ = c.conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	for c.sc.Scan() {
		var m map[string]any
		if err := json.Unmarshal(c.sc.Bytes(), &m); err != nil {
			t.Fatalf("не разобрать ответ %q: %v", c.sc.Text(), err)
		}
		if skipEvents && m["ev"] != nil {
			continue
		}
		return m
	}
	t.Fatalf("ответа не дождались: %v", c.sc.Err())
	return nil
}

func setup(t *testing.T) (string, *Manager) {
	t.Helper()
	dir := t.TempDir()
	core := filepath.Join(dir, "fake-core")
	if err := os.WriteFile(core, []byte(fakeCore), 0o755); err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(dir, "state")
	if err := os.MkdirAll(state, 0o700); err != nil {
		t.Fatal(err)
	}
	rules, _ := filepath.Abs("../resources/rules")
	mgr := NewManager(Paths{Core: core, RulesDir: rules, StateDir: state})

	// Сокет в t.TempDir() бывает длиннее лимита sun_path — кладём в /tmp
	sock, err := os.CreateTemp("/tmp", "prism-test-*.sock")
	if err != nil {
		t.Fatal(err)
	}
	sock.Close()
	os.Remove(sock.Name())

	ln, err := Listen(sock.Name(), os.Getuid())
	if err != nil {
		t.Fatalf("не поднять сокет: %v", err)
	}
	d := NewDaemon(mgr, uint32(os.Getuid()))
	go d.Serve(ln)
	t.Cleanup(func() { ln.Close(); os.Remove(sock.Name()); mgr.Stop() })
	return sock.Name(), mgr
}

func goodConfig(t *testing.T) map[string]any {
	t.Helper()
	b, err := os.ReadFile("testdata/proxy-global.json")
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestПротоколЖизненногоЦикла(t *testing.T) {
	sock, mgr := setup(t)
	c := dial(t, sock)
	defer c.conn.Close()

	c.send(t, map[string]any{"cmd": "hello"})
	r := c.next(t, true)
	if r["ok"] != true || r["version"] != protocolVersion {
		t.Fatalf("hello вернул %v", r)
	}
	if r["running"] != false {
		t.Errorf("на старте ядро не должно быть запущено: %v", r)
	}

	c.send(t, map[string]any{"cmd": "start", "config": goodConfig(t), "clashPort": 9291})
	r = c.next(t, true)
	if r["ok"] != true {
		t.Fatalf("start не удался: %v", r)
	}
	if running, _ := mgr.Running(); !running {
		t.Fatal("менеджер считает, что ядро не запущено")
	}

	// Журнал ядра обязан доехать до клиента
	gotLog := false
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		m := c.next(t, false)
		if m["ev"] == "log" {
			gotLog = true
			break
		}
	}
	if !gotLog {
		t.Error("строки журнала до клиента не доехали")
	}

	c.send(t, map[string]any{"cmd": "stop"})
	if r = c.next(t, true); r["ok"] != true {
		t.Fatalf("stop не удался: %v", r)
	}
	if running, _ := mgr.Running(); running {
		t.Error("после stop ядро всё ещё живо")
	}
}

// Конфиг проверяется на стороне демона, а не на слово приложения.
func TestДемонОтвергаетОпасныйКонфиг(t *testing.T) {
	sock, mgr := setup(t)
	c := dial(t, sock)
	defer c.conn.Close()

	bad := map[string]any{"outbounds": []any{map[string]any{
		"type": "tor", "tag": "pwn", "executable_path": "/bin/sh", "extra_args": []any{"-c", "id"},
	}}}
	c.send(t, map[string]any{"cmd": "start", "config": bad, "clashPort": 9291})
	r := c.next(t, true)
	if r["ok"] != false {
		t.Fatalf("опасный конфиг приняли: %v", r)
	}
	if running, _ := mgr.Running(); running {
		t.Fatal("ядро запустилось на опасном конфиге")
	}
}

// Отвалилось приложение — туннель уходит с ним, а не остаётся держать utun.
func TestУходПоследнегоКлиентаГаситЯдро(t *testing.T) {
	sock, mgr := setup(t)
	c := dial(t, sock)
	c.send(t, map[string]any{"cmd": "start", "config": goodConfig(t), "clashPort": 9291})
	if r := c.next(t, true); r["ok"] != true {
		t.Fatalf("start не удался: %v", r)
	}
	if running, _ := mgr.Running(); !running {
		t.Fatal("ядро не поднялось")
	}

	c.conn.Close() // имитируем падение приложения

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if running, _ := mgr.Running(); !running {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("ядро пережило уход последнего клиента")
}

func TestДваЗапускаПодрядНеПлодятЯдра(t *testing.T) {
	sock, _ := setup(t)
	c := dial(t, sock)
	defer c.conn.Close()
	cfg := goodConfig(t)
	c.send(t, map[string]any{"cmd": "start", "config": cfg, "clashPort": 9291})
	if r := c.next(t, true); r["ok"] != true {
		t.Fatalf("первый start не удался: %v", r)
	}
	c.send(t, map[string]any{"cmd": "start", "config": cfg, "clashPort": 9291})
	if r := c.next(t, true); r["ok"] != false {
		t.Fatal("второй start прошёл — так можно наплодить процессов ядра")
	}
}

func TestUidЗвонящегоОпределяется(t *testing.T) {
	sock, _ := setup(t)
	c := dial(t, sock)
	defer c.conn.Close()
	c.send(t, map[string]any{"cmd": "hello"})
	if r := c.next(t, true); r["ok"] != true {
		t.Fatalf("свой uid не признан своим: %v", r)
	}
	_ = exec.Command("true").Run()
}

// Сквозная проверка с настоящим ядром. TUN требует root, поэтому берём
// режим прокси: важно, что sing-box принимает именно тот конфиг, который
// собрал Sanitize, и что журнал доезжает до клиента живьём.
func TestНастоящееЯдроПоднимаетсяЧерезДемон(t *testing.T) {
	repo, _ := filepath.Abs("..")
	core := filepath.Join(repo, "resources/core/mac/sing-box")
	if _, err := os.Stat(core); err != nil {
		t.Skip("ядра нет — пропускаем")
	}

	dir := t.TempDir()
	state := filepath.Join(dir, "state")
	os.MkdirAll(state, 0o700)
	mgr := NewManager(Paths{Core: core, RulesDir: filepath.Join(repo, "resources/rules"), StateDir: state})

	sock, _ := os.CreateTemp("/tmp", "prism-real-*.sock")
	sock.Close()
	os.Remove(sock.Name())
	ln, err := Listen(sock.Name(), os.Getuid())
	if err != nil {
		t.Fatal(err)
	}
	go NewDaemon(mgr, uint32(os.Getuid())).Serve(ln)
	t.Cleanup(func() { ln.Close(); os.Remove(sock.Name()); mgr.Stop() })

	free := func() int {
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		defer l.Close()
		return l.Addr().(*net.TCPAddr).Port
	}

	cfg := goodConfig(t)
	// Порты подменяем на свободные, чтобы не подраться с чем-то на машине
	for _, in := range cfg["inbounds"].([]any) {
		in.(map[string]any)["listen_port"] = free()
	}
	clash := free()

	c := dial(t, sock.Name())
	defer c.conn.Close()
	c.send(t, map[string]any{"cmd": "start", "config": cfg, "clashPort": clash})
	if r := c.next(t, true); r["ok"] != true {
		t.Fatalf("настоящее ядро не запустилось: %v", r)
	}

	// Ждём живую строку журнала от sing-box
	var line string
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) && line == "" {
		m := c.next(t, false)
		if m["ev"] == "log" {
			line, _ = m["line"].(string)
		}
		if m["ev"] == "exit" {
			t.Fatalf("ядро сразу умерло: %v", m)
		}
	}
	if line == "" {
		t.Fatal("от настоящего ядра не пришло ни строки журнала")
	}
	t.Logf("живой журнал ядра: %s", line)

	if running, pid := mgr.Running(); !running {
		t.Fatal("ядро не считается запущенным")
	} else {
		t.Logf("pid ядра: %d", pid)
	}

	c.send(t, map[string]any{"cmd": "stop"})
	if r := c.next(t, true); r["ok"] != true {
		t.Fatalf("stop не удался: %v", r)
	}
	if running, _ := mgr.Running(); running {
		t.Fatal("настоящее ядро пережило stop")
	}
}
