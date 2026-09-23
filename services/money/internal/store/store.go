// Package store is the money service's Postgres layer. It owns its own
// database (the web app has no credentials for it), applies embedded
// migrations, and exposes append-only operations only.
package store

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

// Store wraps a connection pool.
type Store struct{ pool *pgxpool.Pool }

// Open connects to Postgres. The URL should use sslmode=verify-full outside local development.
func Open(ctx context.Context, url string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("store: parse url: %w", err)
	}
	return OpenConfig(ctx, cfg)
}

func OpenConfig(ctx context.Context, cfg *pgxpool.Config) (*Store, error) {
	cfg.MaxConnLifetime = 30 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("store: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: ping: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close()                         { s.pool.Close() }
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// Migrate applies pending embedded migrations, one transaction each, under an
// advisory lock so concurrent instances don't race.
func (s *Store) Migrate(ctx context.Context) ([]string, error) {
	names, err := fs.Glob(migrationFS, "migrations/*.sql")
	if err != nil {
		return nil, err
	}
	sort.Strings(names)
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `select pg_advisory_lock(7240115001)`); err != nil {
		return nil, err
	}
	defer func() { _, _ = conn.Exec(context.WithoutCancel(ctx), `select pg_advisory_unlock(7240115001)`) }()
	if _, err := conn.Exec(ctx, `create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`); err != nil {
		return nil, err
	}
	var applied []string
	for _, name := range names {
		version := strings.TrimSuffix(strings.TrimPrefix(name, "migrations/"), ".sql")
		var exists bool
		if err := conn.QueryRow(ctx, `select exists(select 1 from schema_migrations where version = $1)`, version).Scan(&exists); err != nil {
			return nil, err
		}
		if exists {
			continue
		}
		sql, err := migrationFS.ReadFile(name)
		if err != nil {
			return nil, err
		}
		if err := pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, string(sql)); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `insert into schema_migrations (version) values ($1)`, version)
			return err
		}); err != nil {
			return applied, fmt.Errorf("store: migration %s: %w", version, err)
		}
		applied = append(applied, version)
	}
	return applied, nil
}

// ErrConflict signals an idempotency or business-rule conflict.
var ErrConflict = errors.New("store: conflict")
