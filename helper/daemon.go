package main

import (
	"bufio"
	"encoding/json"
	"log"
	"net"
	"os"
	"sync"
)

/*
Протокол: по строке JSON в каждую сторону.

  запрос  {"cmd":"hello"}                       → {"ok":true,"version":"1",...}
          {"cmd":"status"}                      → {"ok":true,"running":true,"pid":123}
          {"cmd":"start","config":{…},"clashPort":9291}
          {"cmd":"stop"}
  событие {"ev":"log","line":"…"} / {"ev":"exit","code":0}

Ядро гасится, когда отключается последний клиент. Это не мелочь: на Windows
целый раздел README посвящён тому, что ядро переживает падение приложения и
остаётся держать TUN-адаптер, а пользователь видит «пропал интернет». Здесь
за живучестью следит launchd, и отвалившееся приложение туннель за собой
уносит.
*/

const protocolVersion = "1"

type Daemon struct {
	mgr      *Manager
	allowUID uint32
	mu       sync.Mutex
	clients  int
}

type request struct {
	Cmd       string         `json:"cmd"`
	Config    map[string]any `json:"config"`
	ClashPort int            `json:"clashPort"`
	On        bool           `json:"on"`
	Port      int            `json:"port"`
}

func NewDaemon(m *Manager, uid uint32) *Daemon { return &Daemon{mgr: m, allowUID: uid} }

func (d *Daemon) Serve(ln *net.UnixListener) error {
	for {
		conn, err := ln.AcceptUnix()
		if err != nil {
			return err
		}
		go d.handle(conn)
	}
}

func (d *Daemon) handle(conn *net.UnixConn) {
	defer conn.Close()

	uid, err := peerUID(conn)
	if err != nil {
		log.Printf("не определить uid звонящего, отказ: %v", err)
		return
	}
	if uid != d.allowUID {
		log.Printf("отказано uid=%d (разрешён %d)", uid, d.allowUID)
		_ = writeJSON(conn, map[string]any{"ok": false, "error": "не тот пользователь"})
		return
	}

	d.mu.Lock()
	d.clients++
	d.mu.Unlock()
	defer func() {
		d.mu.Lock()
		d.clients--
		last := d.clients == 0
		d.mu.Unlock()
		if last {
			if running, _ := d.mgr.Running(); running {
				log.Printf("последний клиент отключился — гашу ядро")
				if err := d.mgr.Stop(); err != nil {
					log.Printf("не удалось погасить ядро: %v", err)
				}
			}
			// Системный прокси снимаем всегда: оставить его после ухода
			// приложения — это «интернет пропал» для пользователя.
			if err := d.mgr.ClearSystemProxy(); err != nil {
				log.Printf("не удалось снять системный прокси: %v", err)
			}
		}
	}()

	events := d.mgr.Subscribe()
	defer d.mgr.Unsubscribe(events)

	// Пишем в сокет из одной горутины: и ответы, и события.
	out := make(chan []byte, 256)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case b, ok := <-events:
				if !ok {
					return
				}
				if _, err := conn.Write(b); err != nil {
					return
				}
			case b, ok := <-out:
				if !ok {
					return
				}
				if _, err := conn.Write(b); err != nil {
					return
				}
			}
		}
	}()

	sc := bufio.NewScanner(conn)
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024) // конфиг бывает крупный
	for sc.Scan() {
		var req request
		if err := json.Unmarshal(sc.Bytes(), &req); err != nil {
			d.send(out, map[string]any{"ok": false, "error": "не разобрал запрос"})
			continue
		}
		d.send(out, d.dispatch(req))
	}
	close(out)
	<-done
}

func (d *Daemon) dispatch(req request) map[string]any {
	switch req.Cmd {
	case "hello":
		running, pid := d.mgr.Running()
		return map[string]any{"ok": true, "version": protocolVersion, "running": running, "pid": pid}
	case "status":
		running, pid := d.mgr.Running()
		return map[string]any{"ok": true, "running": running, "pid": pid}
	case "start":
		if req.Config == nil {
			return map[string]any{"ok": false, "error": "конфиг не прислан"}
		}
		pid, err := d.mgr.Start(req.Config, req.ClashPort)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		return map[string]any{"ok": true, "pid": pid}
	case "stop":
		if err := d.mgr.Stop(); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		return map[string]any{"ok": true}
	case "proxy":
		// Хост не берём у клиента: всегда петля, только порт.
		var err error
		if req.On {
			err = d.mgr.SetSystemProxy(req.Port)
		} else {
			err = d.mgr.ClearSystemProxy()
		}
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		return map[string]any{"ok": true}
	default:
		return map[string]any{"ok": false, "error": "неизвестная команда: " + req.Cmd}
	}
}

func (d *Daemon) send(out chan<- []byte, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	select {
	case out <- append(b, '\n'):
	default:
	}
}

func writeJSON(w *net.UnixConn, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = w.Write(append(b, '\n'))
	return err
}

// Listen поднимает сокет и отдаёт его только разрешённому пользователю.
func Listen(path string, uid int) (*net.UnixListener, error) {
	// Сокет от прошлого запуска launchd не убирает.
	_ = os.Remove(path)
	ln, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		return nil, err
	}
	// Права на файл сокета — основная защита; peerUID её дублирует.
	if err := os.Chown(path, uid, -1); err != nil {
		ln.Close()
		return nil, err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		ln.Close()
		return nil, err
	}
	return ln, nil
}
