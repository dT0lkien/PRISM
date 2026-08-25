package main

import (
	"encoding/binary"
	"fmt"
	"net"
	"syscall"
	"unsafe"
)

/*
Кто на том конце сокета.

Основная защита — права на файл сокета (chown на разрешённый uid, 0600).
Это проверка в глубину: если сокет когда-нибудь пересоздадут с широкими
правами, соединение всё равно не пройдёт.

В стандартной библиотеке Go LOCAL_PEERCRED не выставлен наружу, а тащить
golang.org/x/sys в демон, работающий от root, не хочется — поэтому зовём
getsockopt напрямую. Структура xucred на darwin:
    u_int  cr_version;   // 0..3
    uid_t  cr_uid;       // 4..7   — то, что нам нужно
    short  cr_ngroups;
    gid_t  cr_groups[16];
*/

const (
	solLocal      = 0     // SOL_LOCAL
	localPeercred = 0x001 // LOCAL_PEERCRED
	xucredSize    = 76
)

func peerUID(c *net.UnixConn) (uint32, error) {
	raw, err := c.SyscallConn()
	if err != nil {
		return 0, err
	}
	var buf [xucredSize]byte
	length := uint32(xucredSize)
	var errno syscall.Errno
	cerr := raw.Control(func(fd uintptr) {
		_, _, errno = syscall.Syscall6(
			syscall.SYS_GETSOCKOPT, fd, uintptr(solLocal), uintptr(localPeercred),
			uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&length)), 0,
		)
	})
	if cerr != nil {
		return 0, cerr
	}
	if errno != 0 {
		return 0, fmt.Errorf("getsockopt(LOCAL_PEERCRED): %w", errno)
	}
	if length < 8 {
		return 0, fmt.Errorf("xucred короче ожидаемого: %d байт", length)
	}
	return binary.LittleEndian.Uint32(buf[4:8]), nil
}
