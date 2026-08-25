package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

/*
Управление процессом ядра. Туннель в системе один, поэтому и процесс один:
менеджер держит его состояние и рассылает вывод всем подключённым клиентам.

Пути к бинарю ядра, каталогу правил и рабочему каталогу задаются флагами из
plist, то есть root-owned и приложению неподконтрольны. Клиент присылает
только конфиг, и тот проходит Sanitize.
*/

type Manager struct {
	mu      sync.Mutex
	cmd     *exec.Cmd
	subs    map[chan []byte]struct{}
	paths   Paths
	stopped chan struct{}
	// Гасим ли мы ядро сами: приложению нужно отличать штатную остановку
	// от падения, иначе оно покажет «ядро упало» на обычное отключение.
	expected bool
}

// Paths — всё, что helper держит под собой и не берёт у приложения.
type Paths struct {
	Core     string // бинарь sing-box, root:wheel
	RulesDir string // .srs, root-owned
	StateDir string // конфиг и кэш, root-owned 0700
}

func NewManager(p Paths) *Manager {
	return &Manager{subs: map[chan []byte]struct{}{}, paths: p}
}

func (m *Manager) Subscribe() chan []byte {
	m.mu.Lock()
	defer m.mu.Unlock()
	ch := make(chan []byte, 256)
	m.subs[ch] = struct{}{}
	return ch
}

func (m *Manager) Unsubscribe(ch chan []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.subs[ch]; ok {
		delete(m.subs, ch)
		close(ch)
	}
}

// broadcast не блокируется: медленный клиент теряет строки журнала,
// но не останавливает ядро.
func (m *Manager) broadcast(ev any) {
	b, err := json.Marshal(ev)
	if err != nil {
		return
	}
	b = append(b, '\n')
	for ch := range m.subs {
		select {
		case ch <- b:
		default:
		}
	}
}

func (m *Manager) Running() (bool, int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cmd == nil || m.cmd.Process == nil {
		return false, 0
	}
	return true, m.cmd.Process.Pid
}

// Start валидирует конфиг, кладёт его в root-owned каталог и поднимает ядро.
func (m *Manager) Start(cfg map[string]any, clashPort int) (int, error) {
	if clashPort < 1 || clashPort > 65535 {
		return 0, fmt.Errorf("clashPort вне диапазона: %d", clashPort)
	}
	clean, err := Sanitize(cfg, Pins{
		RulesDir:  m.paths.RulesDir,
		CachePath: filepath.Join(m.paths.StateDir, "cache.db"),
		ClashAddr: fmt.Sprintf("127.0.0.1:%d", clashPort),
	})
	if err != nil {
		return 0, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cmd != nil {
		return 0, fmt.Errorf("ядро уже запущено")
	}

	body, err := json.MarshalIndent(clean, "", "  ")
	if err != nil {
		return 0, err
	}
	// 0600 root: приложение не должно иметь возможности подменить конфиг
	// между проверкой и запуском.
	cfgPath := filepath.Join(m.paths.StateDir, "config.json")
	if err := os.WriteFile(cfgPath, body, 0o600); err != nil {
		return 0, fmt.Errorf("не записать конфиг: %w", err)
	}

	cmd := exec.Command(m.paths.Core, "run", "-c", cfgPath, "-D", m.paths.StateDir)
	// Своя группа процессов: гасим ядро вместе с потомками одним сигналом.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	// Одна труба на stdout и stderr: ядро пишет журнал в оба, а приложению
	// нужен единый поток строк.
	pr, pw, err := os.Pipe()
	if err != nil {
		return 0, err
	}
	cmd.Stdout = pw
	cmd.Stderr = pw
	if err := cmd.Start(); err != nil {
		pr.Close()
		pw.Close()
		return 0, fmt.Errorf("не запустить ядро: %w", err)
	}
	// Пишущий конец в родителе закрываем, иначе читатель не дождётся EOF.
	pw.Close()
	m.cmd = cmd
	m.stopped = make(chan struct{})
	stopped := m.stopped

	go func() {
		defer pr.Close()
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			m.mu.Lock()
			m.broadcast(map[string]any{"ev": "log", "line": sc.Text()})
			m.mu.Unlock()
		}
	}()
	go func() {
		err := cmd.Wait()
		code := 0
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else if err != nil {
			code = -1
		}
		m.mu.Lock()
		m.cmd = nil
		m.broadcast(map[string]any{"ev": "exit", "code": code, "expected": m.expected})
		m.expected = false
		m.mu.Unlock()
		close(stopped)
	}()

	return cmd.Process.Pid, nil
}

// Stop гасит ядро мягко, через 5 секунд — жёстко.
func (m *Manager) Stop() error {
	m.mu.Lock()
	if m.cmd == nil || m.cmd.Process == nil {
		m.mu.Unlock()
		return nil
	}
	pid := m.cmd.Process.Pid
	stopped := m.stopped
	m.expected = true
	m.mu.Unlock()

	// Отрицательный pid — всей группе процессов
	_ = syscall.Kill(-pid, syscall.SIGTERM)
	select {
	case <-stopped:
		return nil
	case <-time.After(5 * time.Second):
		_ = syscall.Kill(-pid, syscall.SIGKILL)
		select {
		case <-stopped:
		case <-time.After(2 * time.Second):
			return fmt.Errorf("ядро не завершилось даже по SIGKILL")
		}
		return nil
	}
}
