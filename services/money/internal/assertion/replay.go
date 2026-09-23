package assertion

import (
	"context"
	"sync"
	"time"
)

// MemoryReplayGuard is a single-process replay guard (tests, local development).
// Multi-instance deployments use the Postgres guard in the store package.
type MemoryReplayGuard struct {
	mu   sync.Mutex
	seen map[string]time.Time
	Now  func() time.Time
}

func NewMemoryReplayGuard() *MemoryReplayGuard {
	return &MemoryReplayGuard{seen: map[string]time.Time{}}
}

func (g *MemoryReplayGuard) Use(_ context.Context, id string, expiry time.Time) (bool, error) {
	now := time.Now()
	if g.Now != nil {
		now = g.Now()
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	for k, exp := range g.seen {
		if now.After(exp) {
			delete(g.seen, k)
		}
	}
	if _, used := g.seen[id]; used {
		return false, nil
	}
	g.seen[id] = expiry
	return true, nil
}
