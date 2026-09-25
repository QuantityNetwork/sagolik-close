// Package httpapi is the money service's internal HTTP API.
package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/assertion"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/keys"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/policy"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/store"
)

// Store is what the API needs from persistence.
type Store interface {
	Ping(ctx context.Context) error
	FundsSummary(ctx context.Context, txID string) ([]store.Summary, error)
	AppendAudit(ctx context.Context, e store.AuditEvent) (store.AuditEvent, error)
	RecordMovement(ctx context.Context, m store.Movement) (string, bool, error)
	CreateInstruction(ctx context.Context, env store.Sealer, n store.NewInstruction) (store.Instruction, error)
	GetInstruction(ctx context.Context, id string, now time.Time) (store.Instruction, error)
	ListInstructions(ctx context.Context, txID string, now time.Time) ([]store.Instruction, error)
	VerifyInstruction(ctx context.Context, id, actor, method, reference, requestID string, now time.Time) (store.Instruction, error)
	RevealInstruction(ctx context.Context, env store.Sealer, id, actor, requestID string, now time.Time) (store.Revealed, error)
}

// Sealer is the envelope-encryption dependency (used by readiness).
type Sealer interface {
	Seal(ctx context.Context, plaintext []byte, ec keys.Context) (string, error)
	Open(ctx context.Context, value string, ec keys.Context) ([]byte, error)
}

type Server struct {
	Verifier   *assertion.Verifier
	Store      Store
	Sealer     Sealer
	Log        *slog.Logger
	Now        func() time.Time
	CoolingOff time.Duration // waiting period for changed instructions (default 24h)
}

func (s *Server) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// APIHandler serves the authenticated internal API (behind mTLS).
func (s *Server) APIHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/session", s.authed(s.session))
	mux.HandleFunc("GET /v1/transactions/{id}/funds", s.authed(s.funds))
	mux.HandleFunc("GET /v1/transactions/{id}/instructions", s.authed(s.listInstructions))
	mux.HandleFunc("POST /v1/transactions/{id}/instructions", s.authed(s.createInstruction))
	mux.HandleFunc("POST /v1/instructions/{iid}/verify", s.authed(s.verifyInstruction))
	mux.HandleFunc("POST /v1/instructions/{iid}/reveal", s.authed(s.revealInstruction))
	mux.HandleFunc("POST /v1/transactions/{id}/ledger/movements", s.authed(s.recordMovement))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, r, http.StatusNotFound, "not_found", "No such endpoint.")
	})
	return s.middleware(mux)
}

// HealthHandler serves liveness and readiness (private listener, no auth).
func (s *Server) HealthHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		checks := map[string]string{"database": "ok", "keys": "ok"}
		status := http.StatusOK
		if err := s.Store.Ping(ctx); err != nil {
			checks["database"], status = "unavailable", http.StatusServiceUnavailable
			s.Log.Warn("readiness: database", "error", err)
		}
		if err := s.keySelfTest(ctx); err != nil {
			checks["keys"], status = "unavailable", http.StatusServiceUnavailable
			s.Log.Warn("readiness: keys", "error", err)
		}
		writeJSON(w, status, map[string]any{"status": map[bool]string{true: "ready", false: "not_ready"}[status == http.StatusOK], "checks": checks})
	})
	return mux
}

// keySelfTest proves the configured key provider can wrap and unwrap.
func (s *Server) keySelfTest(ctx context.Context) error {
	ec := keys.Context{Purpose: "readiness.self_test", RecordID: "readiness"}
	v, err := s.Sealer.Seal(ctx, []byte("ok"), ec)
	if err != nil {
		return err
	}
	pt, err := s.Sealer.Open(ctx, v, ec)
	if err != nil || string(pt) != "ok" {
		return errors.New("key round trip failed")
	}
	return nil
}

// ---------------------------------------------------------------- handlers

type principalKey struct{}

func principalFrom(r *http.Request) assertion.Principal {
	p, _ := r.Context().Value(principalKey{}).(assertion.Principal)
	return p
}

// authed verifies the user assertion before calling next.
func (s *Server) authed(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok {
			writeError(w, r, http.StatusUnauthorized, "unauthenticated", "A signed user assertion is required.")
			return
		}
		p, err := s.Verifier.Verify(r.Context(), token)
		if err != nil {
			var ae *assertion.Error
			if errors.As(err, &ae) {
				s.Log.Warn("assertion rejected", "reason", ae.Reason, "request_id", requestID(r))
				writeError(w, r, http.StatusUnauthorized, "unauthenticated", "The user assertion is not valid.")
				return
			}
			s.Log.Error("assertion verification failed", "error", err, "request_id", requestID(r))
			writeError(w, r, http.StatusServiceUnavailable, "unavailable", "Please try again shortly.")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, p)))
	}
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	p := principalFrom(r)
	body := map[string]any{"userId": p.UserID, "aal": map[bool]string{true: "aal2", false: "aal1"}[p.AAL2]}
	if p.TransactionID != "" {
		body["transactionId"], body["role"] = p.TransactionID, p.Role
	}
	if !p.StepUpAt.IsZero() {
		body["stepUpAgeSeconds"] = int(s.now().Sub(p.StepUpAt).Seconds())
	}
	writeJSON(w, http.StatusOK, body)
}

var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func (s *Server) funds(w http.ResponseWriter, r *http.Request) {
	p := principalFrom(r)
	id := r.PathValue("id")
	// The assertion is scoped to one transaction; the path must match it and the
	// role must be allowed to see money. Both refusals look the same (no oracle).
	if !s.scoped(p, id, policy.ViewFunds) {
		writeError(w, r, http.StatusNotFound, "not_found", "That transaction couldn't be found, or you don't have access to its funds.")
		return
	}
	summary, err := s.Store.FundsSummary(r.Context(), id)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if _, err := s.Store.AppendAudit(r.Context(), store.AuditEvent{
		Actor: "user:" + p.UserID, Action: "funds.viewed", Subject: "transaction:" + id, RequestID: requestID(r),
		Details: map[string]any{"role": p.Role},
	}); err != nil {
		s.fail(w, r, err) // no audit, no data
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transactionId": id, "balances": summary})
}

func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	s.Log.Error("request failed", "error", err, "request_id", requestID(r))
	writeError(w, r, http.StatusInternalServerError, "internal", "Something went wrong on our side. Nothing was changed.")
}

// ---------------------------------------------------------------- middleware

type ridKey struct{}

var ridRe = regexp.MustCompile(`^[A-Za-z0-9._-]{8,64}$`)

func requestID(r *http.Request) string { id, _ := r.Context().Value(ridKey{}).(string); return id }

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) { w.status = code; w.ResponseWriter.WriteHeader(code) }

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := s.now()
		rid := r.Header.Get("X-Request-Id")
		if !ridRe.MatchString(rid) {
			b := make([]byte, 12)
			_, _ = rand.Read(b)
			rid = hex.EncodeToString(b)
		}
		r = r.WithContext(context.WithValue(r.Context(), ridKey{}, rid))
		h := w.Header()
		h.Set("X-Request-Id", rid)
		h.Set("Cache-Control", "no-store")
		h.Set("X-Content-Type-Options", "nosniff")
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		defer func() {
			if rec := recover(); rec != nil {
				s.Log.Error("panic", "panic", rec, "request_id", rid)
				writeError(sw, r, http.StatusInternalServerError, "internal", "Something went wrong on our side. Nothing was changed.")
			}
			// Path pattern only: ids and query strings stay out of access logs.
			s.Log.Info("request", "method", r.Method, "route", r.Pattern, "status", sw.status,
				"duration_ms", s.now().Sub(start).Milliseconds(), "request_id", rid)
		}()
		next.ServeHTTP(sw, r)
	})
}

// ---------------------------------------------------------------- responses

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError uses the same envelope as the web app's ApiError.
func writeError(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message, "requestId": requestID(r)}})
}
