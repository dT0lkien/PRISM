package libbox

import (
	"context"
	"errors"
	"time"

	"github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/adapter"
	"github.com/sagernet/sing-box/common/urltest"
	tun "github.com/sagernet/sing-tun"
	"github.com/sagernet/sing/common/logger"
	"github.com/sagernet/sing/service"
)

// PrismProbeURL measures an HTTP exchange through an isolated outbound.
func PrismProbeURL(config string, address string) (int32, error) {
	ctx, cancel := context.WithTimeout(baseContext(nil), 6*time.Second)
	defer cancel()
	options, err := parseConfig(ctx, config)
	if err != nil {
		return 0, err
	}
	ctx = service.ContextWith[adapter.PlatformInterface](ctx, &prismProbePlatform{})
	instance, err := box.New(box.Options{Context: ctx, Options: options})
	if err != nil {
		return 0, err
	}
	if err = instance.Start(); err != nil {
		// Start handles teardown on failure.
		return 0, err
	}
	defer instance.Close()
	outbound, ok := instance.Outbound().Outbound("probe")
	if !ok {
		return 0, errors.New("probe outbound missing")
	}
	delay, err := urltest.URLTest(ctx, address, outbound)
	return int32(delay), err
}

// A short outbound-only probe does not need a TUN device or interface monitor.
type prismProbePlatform struct{ platformInterfaceStub }

func (*prismProbePlatform) CreateDefaultInterfaceMonitor(logger.Logger) tun.DefaultInterfaceMonitor {
	return &prismProbeMonitor{}
}

type prismProbeMonitor struct{ interfaceMonitorStub }

func (*prismProbeMonitor) Start() error { return nil }
func (*prismProbeMonitor) Close() error { return nil }
