// Command money runs the Sagolik Close money service.
package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/kms"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/assertion"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/config"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/httpapi"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/keys"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/mtls"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})).With("service", "money")
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Getenv, log, nil); err != nil {
		log.Error("fatal", "error", err)
		os.Exit(1)
	}
}

// listening reports bound addresses (used by tests).
type listening struct{ API, Health string }

func run(ctx context.Context, getenv func(string) string, log *slog.Logger, ready chan<- listening) error {
	cfg, err := config.Load(getenv)
	if err != nil {
		return fmt.Errorf("configuration: %w", err)
	}
	provider, err := keyProvider(ctx, cfg)
	if err != nil {
		return err
	}
	jwks, err := assertion.LoadJWKSFile(cfg.AssertionJWKSFile)
	if err != nil {
		return err
	}
	st, err := store.Open(ctx, cfg.DatabaseURL.Reveal())
	if err != nil {
		return err
	}
	defer st.Close()
	if cfg.MigrateOnStart {
		applied, err := st.Migrate(ctx)
		if err != nil {
			return err
		}
		log.Info("migrations", "applied", applied)
	}

	srv := &httpapi.Server{
		Verifier:   &assertion.Verifier{Keys: jwks, Issuer: cfg.AssertionIssuer, Audience: cfg.AssertionAudience, Replay: st.ReplayGuard()},
		Store:      st,
		Sealer:     keys.NewEnvelope(provider),
		Log:        log,
		CoolingOff: cfg.CoolingOff,
	}

	var tlsCfg *tls.Config
	if !cfg.Plaintext {
		if tlsCfg, err = mtls.ServerConfig(cfg.TLSCertFile, cfg.TLSKeyFile, cfg.TLSClientCAFile, cfg.AllowedClients); err != nil {
			return err
		}
	} else {
		log.Warn("PLAINTEXT internal API — local development only")
	}
	api := &http.Server{
		Handler: srv.APIHandler(), TLSConfig: tlsCfg,
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second,
		MaxHeaderBytes: 16 << 10, ErrorLog: slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}
	health := &http.Server{Handler: srv.HealthHandler(), ReadHeaderTimeout: 2 * time.Second, WriteTimeout: 5 * time.Second}

	apiLn, err := net.Listen("tcp", cfg.ListenAddr)
	if err != nil {
		return err
	}
	healthLn, err := net.Listen("tcp", cfg.HealthAddr)
	if err != nil {
		_ = apiLn.Close()
		return err
	}
	errc := make(chan error, 2)
	go func() {
		if tlsCfg != nil {
			errc <- api.ServeTLS(apiLn, "", "")
		} else {
			errc <- api.Serve(apiLn)
		}
	}()
	go func() { errc <- health.Serve(healthLn) }()
	go pruneLoop(ctx, st, log)

	log.Info("money service started", "env", cfg.Env, "api", apiLn.Addr().String(), "health", healthLn.Addr().String(), "key_provider", provider.Name(), "mtls", tlsCfg != nil)
	if ready != nil {
		ready <- listening{API: apiLn.Addr().String(), Health: healthLn.Addr().String()}
	}

	select {
	case <-ctx.Done():
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	_ = health.Shutdown(shutdownCtx)
	err = api.Shutdown(shutdownCtx)
	log.Info("money service stopped")
	return err
}

func keyProvider(ctx context.Context, cfg config.Config) (keys.Provider, error) {
	switch cfg.KeyProvider {
	case "awskms":
		// Credentials come from the environment's IAM role (no static keys).
		awsCfg, err := awsconfig.LoadDefaultConfig(ctx)
		if err != nil {
			return nil, fmt.Errorf("aws config: %w", err)
		}
		return keys.NewAWSKMSProvider(kms.NewFromConfig(awsCfg), cfg.KMSKeyID)
	default:
		return keys.LoadKeyringFile(cfg.KeyringFile)
	}
}

func pruneLoop(ctx context.Context, st *store.Store, log *slog.Logger) {
	t := time.NewTicker(5 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			if _, err := st.PruneReplay(ctx, now); err != nil && ctx.Err() == nil {
				log.Warn("prune replay guard", "error", err)
			}
		}
	}
}
