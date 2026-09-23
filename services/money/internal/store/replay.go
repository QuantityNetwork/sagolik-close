package store

import (
	"context"
	"time"
)

// ReplayGuard records assertion ids in Postgres so single use holds across
// every instance of the service.
type ReplayGuard struct{ s *Store }

func (s *Store) ReplayGuard() *ReplayGuard { return &ReplayGuard{s: s} }

func (g *ReplayGuard) Use(ctx context.Context, id string, expiry time.Time) (bool, error) {
	tag, err := g.s.pool.Exec(ctx, `insert into assertion_replay (jti, expires_at) values ($1, $2) on conflict (jti) do nothing`, id, expiry)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// PruneReplay deletes expired ids; run periodically.
func (s *Store) PruneReplay(ctx context.Context, now time.Time) (int64, error) {
	tag, err := s.pool.Exec(ctx, `delete from assertion_replay where expires_at < $1`, now)
	return tag.RowsAffected(), err
}
