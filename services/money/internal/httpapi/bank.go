package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/assertion"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/plaid"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/policy"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/redact"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/store"
)

// PlaidAPI is what the service needs from Plaid (the real client or a test fake).
type PlaidAPI interface {
	CreateHostedLink(ctx context.Context, r plaid.LinkRequest) (plaid.LinkToken, error)
	PublicToken(ctx context.Context, linkToken redact.Secret) (redact.Secret, error)
	Exchange(ctx context.Context, publicToken redact.Secret) (redact.Secret, string, error)
	Item(ctx context.Context, accessToken redact.Secret) (plaid.Item, error)
	Identity(ctx context.Context, accessToken redact.Secret) ([]plaid.Account, error)
	Balances(ctx context.Context, accessToken redact.Secret, accountIDs ...string) ([]plaid.Account, error)
	RemoveItem(ctx context.Context, accessToken redact.Secret) error
}

// BankConfig wires Plaid into the API. A nil Plaid disables bank endpoints.
type BankConfig struct {
	Plaid       PlaidAPI
	Environment string // "sandbox" | "production": webhooks from another environment are ignored
	RedirectURI string // the web app's callback; the link id is added as ?link=
	WebhookURL  string // optional public URL of /webhooks/plaid
	Webhooks    *plaid.WebhookVerifier
}

// Proof-of-funds checks call Plaid's billed real-time balance endpoint.
const maxFundsChecksPerHour = 5

func (s *Server) bankEnabled(w http.ResponseWriter, r *http.Request) bool {
	if s.Bank.Plaid == nil {
		writeError(w, r, http.StatusServiceUnavailable, "unavailable", "Bank connections aren't set up yet.")
		return false
	}
	return true
}

// plaidError answers a Plaid failure with a message for people.
func (s *Server) plaidError(w http.ResponseWriter, r *http.Request, err error) {
	var pe *plaid.Error
	if errors.As(err, &pe) {
		s.Log.Warn("plaid error", "code", pe.Code, "type", pe.Type, "status", pe.Status, "request_id", requestID(r))
		status, code := http.StatusBadGateway, "provider_error"
		if pe.Reconnect {
			status, code = http.StatusConflict, "reconnect_required"
		} else if pe.Code == "RATE_LIMIT_EXCEEDED" {
			status, code = http.StatusTooManyRequests, "rate_limited"
		}
		writeError(w, r, status, code, pe.Message())
		return
	}
	s.fail(w, r, err)
}

func (s *Server) bankStoreError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, store.ErrDisconnected):
		writeError(w, r, http.StatusConflict, "conflict", "This bank was disconnected. Connect it again to continue.")
	case errors.Is(err, store.ErrInvalidBank):
		writeError(w, r, http.StatusBadRequest, "bad_request", "Some of the details aren't valid.")
	default:
		s.storeError(w, r, err)
	}
}

func validLegalName(n string) bool {
	n = strings.TrimSpace(n)
	return len(n) >= 2 && len(n) <= 140
}

type startLinkBody struct {
	LegalName string `json:"legalName,omitempty"`
}

// startBankLink: the payer starts Plaid Hosted Link for this transaction.
func (s *Server) startBankLink(w http.ResponseWriter, r *http.Request) {
	p, txID := principalFrom(r), r.PathValue("id")
	if !s.scoped(p, txID, policy.InitiatePayment) {
		notFound(w, r)
		return
	}
	if !s.bankEnabled(w, r) {
		return
	}
	var b startLinkBody
	if !decode(w, r, &b) {
		return
	}
	linkID := store.NewID()
	redirect, err := url.Parse(s.Bank.RedirectURI)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	q := redirect.Query()
	q.Set("link", linkID)
	redirect.RawQuery = q.Encode()
	req := plaid.LinkRequest{ClientUserID: p.UserID, RedirectURI: redirect.String(), WebhookURL: s.Bank.WebhookURL}
	if validLegalName(b.LegalName) {
		req.LegalName = strings.TrimSpace(b.LegalName)
	}
	lt, err := s.Bank.Plaid.CreateHostedLink(r.Context(), req)
	if err != nil {
		s.plaidError(w, r, err)
		return
	}
	expires := lt.ExpiresAt
	if expires.IsZero() {
		expires = s.now().Add(30 * time.Minute)
	}
	link, err := s.Store.CreateLink(r.Context(), s.Sealer, store.NewLink{ID: linkID, TransactionID: txID, UserID: p.UserID, LinkToken: lt.Token, ExpiresAt: expires, RequestID: requestID(r)})
	if err != nil {
		s.bankStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"linkId": link.ID, "hostedLinkUrl": lt.HostedURL, "expiresAt": link.ExpiresAt})
}

type completeLinkBody struct {
	LegalName string `json:"legalName"`
}

// completeBankLink exchanges the finished session's token and checks ownership.
// It is idempotent: completing a completed link returns its connection.
func (s *Server) completeBankLink(w http.ResponseWriter, r *http.Request) {
	p := principalFrom(r)
	if !s.bankEnabled(w, r) {
		return
	}
	link, linkToken, err := s.Store.GetLink(r.Context(), s.Sealer, r.PathValue("lid"))
	if err != nil {
		s.bankStoreError(w, r, err)
		return
	}
	// Only the person who started it, in the same transaction.
	if link.UserID != p.UserID || !s.scoped(p, link.TransactionID, policy.InitiatePayment) {
		notFound(w, r)
		return
	}
	var b completeLinkBody
	if !decode(w, r, &b) {
		return
	}
	if !validLegalName(b.LegalName) {
		writeError(w, r, http.StatusBadRequest, "bad_request", "Your legal name is needed to confirm the account is yours.")
		return
	}
	if link.ConnectionID != nil {
		conn, err := s.Store.GetConnection(r.Context(), *link.ConnectionID)
		if err != nil {
			s.bankStoreError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"connection": conn})
		return
	}
	if s.now().After(link.ExpiresAt.Add(time.Hour)) {
		writeError(w, r, http.StatusConflict, "conflict", "This bank connection took too long to finish. Please start again.")
		return
	}
	publicToken, err := s.Bank.Plaid.PublicToken(r.Context(), linkToken)
	if errors.Is(err, plaid.ErrLinkNotFinished) {
		writeError(w, r, http.StatusConflict, "link_not_finished", "The bank connection wasn't finished. Please start again.")
		return
	}
	if err != nil {
		s.plaidError(w, r, err)
		return
	}
	accessToken, itemID, err := s.Bank.Plaid.Exchange(r.Context(), publicToken)
	if err != nil {
		s.plaidError(w, r, err)
		return
	}
	// From here on, an Item exists at Plaid: remove it if we can't record it.
	cleanup := func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 10*time.Second)
		defer cancel()
		if err := s.Bank.Plaid.RemoveItem(ctx, accessToken); err != nil {
			s.Log.Error("plaid item cleanup failed", "error", err, "request_id", requestID(r))
		}
	}
	item, err := s.Bank.Plaid.Item(r.Context(), accessToken)
	if err != nil {
		cleanup()
		s.plaidError(w, r, err)
		return
	}
	idents, err := s.Bank.Plaid.Identity(r.Context(), accessToken)
	if err != nil {
		cleanup()
		s.plaidError(w, r, err)
		return
	}
	conn, err := s.Store.CreateConnection(r.Context(), s.Sealer, store.NewConnection{
		LinkID: link.ID, TransactionID: link.TransactionID, UserID: p.UserID, ItemID: itemID,
		InstitutionID: item.InstitutionID, InstitutionName: item.InstitutionName, ConsentExpiresAt: item.ConsentExpiresAt,
		AccessToken: accessToken, Accounts: accountsWithOwnership(idents, b.LegalName), RequestID: requestID(r),
	})
	if errors.Is(err, store.ErrLinkUsed) {
		cleanup() // a concurrent request won; keep only its Item
		writeError(w, r, http.StatusConflict, "conflict", "This bank connection was already completed.")
		return
	}
	if err != nil {
		cleanup()
		s.bankStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"connection": conn})
}

func accountsWithOwnership(accts []plaid.Account, legalName string) []store.NewAccount {
	out := make([]store.NewAccount, 0, len(accts))
	for _, a := range accts {
		name := a.Name
		if len(name) > 200 {
			name = name[:200]
		}
		if strings.TrimSpace(name) == "" {
			name = "Account"
		}
		out = append(out, store.NewAccount{PlaidAccountID: a.AccountID, Name: name, Mask: a.Mask, Type: a.Type, Subtype: a.Subtype,
			Currency: a.Currency, OwnerMatched: plaid.AnyNameMatches(a.Owners, legalName), OwnerCount: len(a.Owners)})
	}
	return out
}

func (s *Server) listBankConnections(w http.ResponseWriter, r *http.Request) {
	p, txID := principalFrom(r), r.PathValue("id")
	if !s.scoped(p, txID, policy.InitiatePayment) {
		notFound(w, r)
		return
	}
	conns, err := s.Store.ListConnections(r.Context(), txID, p.UserID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if conns == nil {
		conns = []store.Connection{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"connections": conns})
}

// ownConnection loads a connection that belongs to the caller in their transaction.
func (s *Server) ownConnection(w http.ResponseWriter, r *http.Request, p assertion.Principal) (store.Connection, bool) {
	conn, err := s.Store.GetConnection(r.Context(), r.PathValue("cid"))
	if err != nil {
		s.bankStoreError(w, r, err)
		return conn, false
	}
	if conn.UserID != p.UserID || !s.scoped(p, conn.TransactionID, policy.InitiatePayment) {
		notFound(w, r)
		return conn, false
	}
	return conn, true
}

// markReconnect records that Plaid needs the person to reconnect.
func (s *Server) markReconnect(r *http.Request, connID string, err error) {
	var pe *plaid.Error
	if errors.As(err, &pe) && pe.Reconnect {
		if serr := s.Store.SetStatus(r.Context(), connID, "reauthentication_required", "plaid_api", pe.Code, requestID(r)); serr != nil {
			s.Log.Error("record bank status", "error", serr, "request_id", requestID(r))
		}
	}
}

func (s *Server) refreshBankConnection(w http.ResponseWriter, r *http.Request) {
	p := principalFrom(r)
	if !s.bankEnabled(w, r) {
		return
	}
	conn, ok := s.ownConnection(w, r, p)
	if !ok {
		return
	}
	var b completeLinkBody
	if !decode(w, r, &b) {
		return
	}
	if !validLegalName(b.LegalName) {
		writeError(w, r, http.StatusBadRequest, "bad_request", "Your legal name is needed to confirm the account is yours.")
		return
	}
	at, err := s.Store.AccessToken(r.Context(), s.Sealer, conn.ID)
	if err != nil {
		s.bankStoreError(w, r, err)
		return
	}
	idents, err := s.Bank.Plaid.Identity(r.Context(), at)
	if err != nil {
		s.markReconnect(r, conn.ID, err)
		s.plaidError(w, r, err)
		return
	}
	if err := s.Store.RecordRefresh(r.Context(), conn.ID, p.UserID, accountsWithOwnership(idents, b.LegalName), requestID(r)); err != nil {
		s.bankStoreError(w, r, err)
		return
	}
	out, err := s.Store.GetConnection(r.Context(), conn.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"connection": out})
}

type proofBody struct {
	RequiredAmount int64  `json:"requiredAmount"`
	Currency       string `json:"currency"`
}

// proofOfFunds compares a real-time balance with the amount the closing needs.
// The balance goes back to the account owner only; others see the result.
func (s *Server) proofOfFunds(w http.ResponseWriter, r *http.Request) {
	p := principalFrom(r)
	if !s.bankEnabled(w, r) {
		return
	}
	conn, ok := s.ownConnection(w, r, p)
	if !ok {
		return
	}
	var b proofBody
	if !decode(w, r, &b) {
		return
	}
	accountID := r.PathValue("aid")
	plaidAccountID, err := s.Store.PlaidAccountID(r.Context(), conn.ID, accountID)
	if err != nil {
		s.bankStoreError(w, r, err)
		return
	}
	if n, err := s.Store.RecentFundsChecks(r.Context(), accountID, s.now().Add(-time.Hour)); err != nil {
		s.fail(w, r, err)
		return
	} else if n >= maxFundsChecksPerHour {
		writeError(w, r, http.StatusTooManyRequests, "rate_limited", "You've checked this account several times in the last hour. Please try again later.")
		return
	}
	at, err := s.Store.AccessToken(r.Context(), s.Sealer, conn.ID)
	if err != nil {
		s.bankStoreError(w, r, err)
		return
	}
	bals, err := s.Bank.Plaid.Balances(r.Context(), at, plaidAccountID)
	if err != nil {
		s.markReconnect(r, conn.ID, err)
		s.plaidError(w, r, err)
		return
	}
	var acct *plaid.Account
	for i := range bals {
		if bals[i].AccountID == plaidAccountID {
			acct = &bals[i]
		}
	}
	if acct == nil {
		writeError(w, r, http.StatusConflict, "conflict", "Your bank didn't return this account. Please reconnect it.")
		return
	}
	if b.Currency != acct.Currency {
		writeError(w, r, http.StatusBadRequest, "bad_request", "This account holds a different currency from the amount required.")
		return
	}
	f, err := s.Store.RecordFundsCheck(r.Context(), store.NewFundsCheck{AccountID: accountID, TransactionID: conn.TransactionID, CheckedBy: p.UserID,
		RequiredAmount: b.RequiredAmount, Currency: b.Currency, Available: acct.Available, Current: acct.Current, RequestID: requestID(r)})
	if err != nil {
		s.bankStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"fundsCheck": f})
}

func (s *Server) disconnectBank(w http.ResponseWriter, r *http.Request) {
	p := principalFrom(r)
	if !s.bankEnabled(w, r) {
		return
	}
	conn, ok := s.ownConnection(w, r, p)
	if !ok || !s.stepUp(w, r, p) {
		return
	}
	if conn.Status != "revoked" {
		at, err := s.Store.AccessToken(r.Context(), s.Sealer, conn.ID)
		if err == nil {
			// Revoke at Plaid first; if Plaid is unreachable we still destroy our copy.
			if err := s.Bank.Plaid.RemoveItem(r.Context(), at); err != nil {
				s.Log.Warn("plaid item remove failed; destroying token locally", "error", err, "request_id", requestID(r))
			}
		} else if !errors.Is(err, store.ErrDisconnected) {
			s.fail(w, r, err)
			return
		}
		if err := s.Store.Disconnect(r.Context(), conn.ID, "user:"+p.UserID, "user", requestID(r)); err != nil {
			s.fail(w, r, err)
			return
		}
	}
	out, err := s.Store.GetConnection(r.Context(), conn.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"connection": out})
}

// ---------------------------------------------------------------- webhooks

// WebhookHandler serves Plaid's webhooks on their own listener: no mTLS (Plaid
// can't present a client certificate), so every request must carry a valid
// Plaid-Verification signature over the exact body.
func (s *Server) WebhookHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /webhooks/plaid", s.plaidWebhook)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, r, http.StatusNotFound, "not_found", "No such endpoint.")
	})
	return s.middleware(mux)
}

func (s *Server) plaidWebhook(w http.ResponseWriter, r *http.Request) {
	if s.Bank.Webhooks == nil {
		writeError(w, r, http.StatusServiceUnavailable, "unavailable", "Webhooks aren't set up.")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, r, http.StatusRequestEntityTooLarge, "bad_request", "Body too large.")
		return
	}
	if err := s.Bank.Webhooks.Verify(r.Context(), r.Header.Get("Plaid-Verification"), body); err != nil {
		var rej *plaid.ErrWebhookRejected
		if errors.As(err, &rej) {
			s.Log.Warn("plaid webhook rejected", "reason", rej.Reason, "request_id", requestID(r))
			writeError(w, r, http.StatusUnauthorized, "unauthenticated", "Signature check failed.")
			return
		}
		s.Log.Error("plaid webhook key fetch failed", "error", err, "request_id", requestID(r))
		writeError(w, r, http.StatusServiceUnavailable, "unavailable", "Try again.")
		return
	}
	var wh plaid.Webhook
	if err := json.Unmarshal(body, &wh); err != nil || wh.Type == "" || wh.Code == "" {
		writeError(w, r, http.StatusBadRequest, "bad_request", "Unrecognised webhook.")
		return
	}
	if wh.Environment != "" && s.Bank.Environment != "" && wh.Environment != s.Bank.Environment {
		s.Log.Warn("plaid webhook for another environment ignored", "environment", wh.Environment, "request_id", requestID(r))
		writeJSON(w, http.StatusOK, map[string]any{"status": "ignored"})
		return
	}
	sum := sha256.Sum256(body)
	seen, err := s.Store.WebhookSeen(r.Context(), sum[:])
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if seen {
		writeJSON(w, http.StatusOK, map[string]any{"status": "duplicate"})
		return
	}
	connID, err := s.Store.ConnectionForItem(r.Context(), wh.ItemID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if connID != "" && wh.Type == "ITEM" {
		errCode := ""
		if wh.Error != nil {
			errCode = wh.Error.ErrorCode
		}
		switch wh.Code {
		case "ERROR":
			status := "error"
			if errCode == "ITEM_LOGIN_REQUIRED" {
				status = "reauthentication_required"
			}
			err = s.Store.SetStatus(r.Context(), connID, status, "plaid_webhook", errCode, requestID(r))
		case "PENDING_EXPIRATION", "PENDING_DISCONNECT":
			err = s.Store.SetStatus(r.Context(), connID, "reauthentication_required", "plaid_webhook", wh.Code, requestID(r))
		case "LOGIN_REPAIRED":
			err = s.Store.SetStatus(r.Context(), connID, "connected", "plaid_webhook", wh.Code, requestID(r))
		case "USER_PERMISSION_REVOKED":
			// The person withdrew consent at Plaid: destroy our token too.
			err = s.Store.Disconnect(r.Context(), connID, "provider:plaid", "plaid_webhook", requestID(r))
		}
		if err != nil {
			s.fail(w, r, err) // not recorded, so Plaid's retry runs it again
			return
		}
	}
	if err := s.Store.RecordWebhook(r.Context(), sum[:], wh.Type, wh.Code, wh.ItemID); err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "processed"})
}
