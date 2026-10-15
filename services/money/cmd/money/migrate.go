package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/url"
	"strings"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/config"
)

type grantList []string

func (g *grantList) String() string     { return strings.Join(*g, ",") }
func (g *grantList) Set(v string) error { *g = append(*g, v); return nil }

// runMigrate is `money migrate`: it applies the embedded migrations under the
// migration identity (on Azure, the database server's Entra administrator)
// and lets each runtime login role use the runtime role. The service itself
// then runs as a role that can't change the schema.
//
//	money migrate [--grant <role>[=<entra object id>]]...
func runMigrate(ctx context.Context, getenv func(string) string, args []string, log *slog.Logger) error {
	fs := flag.NewFlagSet("migrate", flag.ContinueOnError)
	var grants grantList
	fs.Var(&grants, "grant", "login role allowed to run as the runtime role, as <role>[=<entra object id>] (repeatable)")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	cfg, err := config.LoadDatabase(getenv)
	if err != nil {
		return fmt.Errorf("configuration: %w", err)
	}
	st, err := openStore(ctx, cfg, cfg.DatabaseURL.Reveal())
	if err != nil {
		return err
	}
	defer st.Close()
	if err := st.EnsureRuntimeRole(ctx); err != nil {
		return fmt.Errorf("runtime role: %w", err)
	}
	applied, err := st.Migrate(ctx)
	if err != nil {
		return err
	}
	log.Info("migrations", "applied", applied)
	for _, spec := range grants {
		role, objectID, hasID := strings.Cut(spec, "=")
		if hasID {
			// Entra principals are created from the `postgres` database, where the pgaadauth functions live.
			u, err := url.Parse(cfg.DatabaseURL.Reveal())
			if err != nil {
				return errors.New("MONEY_DATABASE_URL isn't a URL")
			}
			u.Path = "/postgres"
			admin, err := openStore(ctx, cfg, u.String())
			if err != nil {
				return err
			}
			created, err := admin.CreateEntraPrincipal(ctx, role, objectID)
			admin.Close()
			if err != nil {
				return fmt.Errorf("principal for %s: %w", role, err)
			}
			if created {
				log.Info("created the database role for a managed identity", "role", role)
			}
		}
		if err := st.GrantRuntimeRole(ctx, role); err != nil {
			return err
		}
		log.Info("granted the runtime role", "role", role)
	}
	return nil
}
