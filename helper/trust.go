package main

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

/*
Проверка доверенных путей.

Вся модель безопасности helper-а держится на том, что бинарь ядра, каталог
правил и рабочий каталог принадлежат root и никому больше не доступны на
запись. Иначе валидация конфига обесценивается: незачем подделывать конфиг,
если можно подменить сам бинарь, который root запустит.

Проверяем не только сам путь, но и всех его предков: право переименовать
каталог даёт ровно ту же возможность подмены, что и право писать в файл.
Демон отказывается стартовать, если что-то не так, — лучше не подняться,
чем стать лестницей до root.
*/

// CheckTrusted проверяет путь и все его родительские каталоги.
func CheckTrusted(path string) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	for p := abs; ; p = filepath.Dir(p) {
		fi, err := os.Lstat(p)
		if err != nil {
			return fmt.Errorf("%s: %w", p, err)
		}
		// Симлинк в цепочке — это подменяемое звено: куда он ведёт, решает
		// тот, кто им владеет, а не мы.
		if fi.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("%s — символическая ссылка, доверять цепочке нельзя", p)
		}
		st, ok := fi.Sys().(*syscall.Stat_t)
		if !ok {
			return fmt.Errorf("%s: не прочитать владельца", p)
		}
		if st.Uid != 0 {
			return fmt.Errorf("%s принадлежит uid %d, а должен root", p, st.Uid)
		}
		if perm := fi.Mode().Perm(); perm&0o022 != 0 {
			return fmt.Errorf("%s доступен на запись не только root (права %04o)", p, perm)
		}
		if p == "/" {
			return nil
		}
	}
}

// CheckAllTrusted проверяет всё, чему демон обязан доверять.
func CheckAllTrusted(p Paths) error {
	for name, path := range map[string]string{
		"бинарь ядра":     p.Core,
		"каталог правил":  p.RulesDir,
		"рабочий каталог": p.StateDir,
	} {
		if err := CheckTrusted(path); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	return nil
}
