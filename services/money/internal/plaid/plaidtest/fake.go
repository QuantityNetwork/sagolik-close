// Package plaidtest is a stand-in Plaid API for tests. It follows the request
// and response shapes in Plaid's API reference for the endpoints the money
// service uses, checks credentials, and signs webhooks the way Plaid does.
package plaidtest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"time"
)

const (
	ClientID = "test-client-id"
	Secret   = "test-secret"
	KeyID    = "6c5516e1-92dc-479e-a8ff-5a51992e0001"
)

// Fake is a running stand-in Plaid server.
type Fake struct {
	*httptest.Server
	Key *ecdsa.PrivateKey

	mu        sync.Mutex
	links     map[string]*link  // link_token → session
	order     []string          // link tokens, oldest first
	public    map[string]string // public_token → item id
	items     map[string]*Item  // item id → item
	tokens    map[string]string // access_token → item id
	Calls     map[string]int    // path → count
	OwnerName string            // name Identity returns for every account
	Available float64           // available balance on the checking account
	FailNext  map[string]string // path → Plaid error_code to return once
}

type link struct {
	userID   string
	finished bool
	public   string
}

// Item is a fake connection.
type Item struct {
	ID      string
	Removed bool
}

// New starts a fake with one checking and one savings account.
func New() *Fake {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	f := &Fake{
		Key: key, links: map[string]*link{}, public: map[string]string{}, items: map[string]*Item{},
		tokens: map[string]string{}, Calls: map[string]int{}, OwnerName: "Olivia Carter", Available: 250000,
		FailNext: map[string]string{},
	}
	f.Server = httptest.NewServer(http.HandlerFunc(f.serve))
	return f
}

func id(prefix string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

func writeErr(w http.ResponseWriter, status int, typ, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error_type": typ, "error_code": code, "error_message": code, "request_id": "req"})
}

// ControlPath lets a test in another process finish the latest link (the fake only).
const ControlPath = "/__plaidtest/finish-latest-link"

func (f *Fake) serve(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == ControlPath {
		if tok := f.LastLinkToken(); tok != "" && f.FinishLink(tok) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeErr(w, 404, "INVALID_REQUEST", "NO_OPEN_LINK")
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "INVALID_REQUEST", "INVALID_BODY")
		return
	}
	if body["client_id"] != ClientID || body["secret"] != Secret {
		writeErr(w, 400, "INVALID_INPUT", "INVALID_API_KEYS")
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Calls[r.URL.Path]++
	if code, ok := f.FailNext[r.URL.Path]; ok {
		delete(f.FailNext, r.URL.Path)
		writeErr(w, 400, "ITEM_ERROR", code)
		return
	}
	str := func(k string) string { s, _ := body[k].(string); return s }
	item := func() (*Item, bool) {
		iid, ok := f.tokens[str("access_token")]
		if !ok || f.items[iid].Removed {
			writeErr(w, 400, "INVALID_INPUT", "INVALID_ACCESS_TOKEN")
			return nil, false
		}
		return f.items[iid], true
	}
	out := map[string]any{"request_id": "req"}
	switch r.URL.Path {
	case "/link/token/create":
		user, _ := body["user"].(map[string]any)
		hosted, _ := body["hosted_link"].(map[string]any)
		if user["client_user_id"] == nil || hosted["completion_redirect_uri"] == nil {
			writeErr(w, 400, "INVALID_REQUEST", "MISSING_FIELDS")
			return
		}
		tok := id("link-sandbox-")
		f.links[tok] = &link{userID: fmt.Sprint(user["client_user_id"])}
		f.order = append(f.order, tok)
		out["link_token"], out["hosted_link_url"] = tok, "https://hosted.plaid.com/link/"+tok
		out["expiration"] = time.Now().Add(30 * time.Minute).UTC().Format(time.RFC3339)
	case "/link/token/get":
		l, ok := f.links[str("link_token")]
		if !ok {
			writeErr(w, 400, "INVALID_INPUT", "INVALID_LINK_TOKEN")
			return
		}
		sessions := []any{}
		if l.finished {
			sessions = append(sessions, map[string]any{"link_session_id": "s1", "results": map[string]any{
				"item_add_results": []any{map[string]any{"public_token": l.public}},
			}})
		}
		out["link_token"], out["link_sessions"] = str("link_token"), sessions
	case "/sandbox/public_token/create":
		out["public_token"] = f.newPublicToken()
	case "/item/public_token/exchange":
		iid, ok := f.public[str("public_token")]
		if !ok {
			writeErr(w, 400, "INVALID_INPUT", "INVALID_PUBLIC_TOKEN")
			return
		}
		delete(f.public, str("public_token"))
		at := id("access-sandbox-")
		f.tokens[at] = iid
		out["access_token"], out["item_id"] = at, iid
	case "/item/get":
		it, ok := item()
		if !ok {
			return
		}
		out["item"] = map[string]any{"item_id": it.ID, "institution_id": "ins_109508", "institution_name": "First Platypus Bank",
			"consent_expiration_time": nil, "error": nil}
	case "/identity/get", "/accounts/balance/get":
		if _, ok := item(); !ok {
			return
		}
		owners := []any{map[string]any{"names": []string{f.OwnerName}}}
		out["accounts"] = []any{
			map[string]any{"account_id": "acc_checking", "name": "Plaid Checking", "mask": "0000", "type": "depository", "subtype": "checking",
				"balances": map[string]any{"available": f.Available, "current": f.Available + 100, "iso_currency_code": "USD"}, "owners": owners},
			map[string]any{"account_id": "acc_savings", "name": "Plaid Saving", "mask": "1111", "type": "depository", "subtype": "savings",
				"balances": map[string]any{"available": 200, "current": 210, "iso_currency_code": "USD"}, "owners": owners},
		}
	case "/item/remove":
		it, ok := item()
		if !ok {
			return
		}
		it.Removed = true
	case "/webhook_verification_key/get":
		if str("key_id") != KeyID {
			writeErr(w, 400, "INVALID_INPUT", "INVALID_WEBHOOK_VERIFICATION_KEY_ID")
			return
		}
		x, y := f.Key.X.FillBytes(make([]byte, 32)), f.Key.Y.FillBytes(make([]byte, 32))
		out["key"] = map[string]any{"alg": "ES256", "crv": "P-256", "kid": KeyID, "kty": "EC", "use": "sig",
			"x": base64.RawURLEncoding.EncodeToString(x), "y": base64.RawURLEncoding.EncodeToString(y),
			"created_at": time.Now().Add(-time.Hour).Unix(), "expired_at": nil}
	default:
		writeErr(w, 404, "INVALID_REQUEST", "UNKNOWN_ENDPOINT")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (f *Fake) newPublicToken() string {
	iid := id("item-")
	f.items[iid] = &Item{ID: iid}
	pt := id("public-sandbox-")
	f.public[pt] = iid
	return pt
}

// FinishLink simulates the person completing Hosted Link for linkToken.
func (f *Fake) FinishLink(linkToken string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	l, ok := f.links[linkToken]
	if !ok {
		return false
	}
	l.finished, l.public = true, f.newPublicToken()
	return true
}

// LastLinkToken returns the most recently started link that hasn't finished.
func (f *Fake) LastLinkToken() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := len(f.order) - 1; i >= 0; i-- {
		if !f.links[f.order[i]].finished {
			return f.order[i]
		}
	}
	return ""
}

// ItemRemoved reports whether /item/remove was called for an item.
func (f *Fake) ItemRemoved(itemID string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	it, ok := f.items[itemID]
	return ok && it.Removed
}

// Sign produces a Plaid-Verification JWT for body, issued at iat.
func (f *Fake) Sign(body []byte, iat time.Time) string {
	return SignWith(f.Key, KeyID, body, iat)
}

// SignWith signs like Plaid: ES256 over header.payload, payload has iat and request_body_sha256.
func SignWith(key *ecdsa.PrivateKey, kid string, body []byte, iat time.Time) string {
	enc := func(v any) string { b, _ := json.Marshal(v); return base64.RawURLEncoding.EncodeToString(b) }
	sum := sha256.Sum256(body)
	signing := enc(map[string]string{"alg": "ES256", "kid": kid, "typ": "JWT"}) + "." +
		enc(map[string]any{"iat": iat.Unix(), "request_body_sha256": hex.EncodeToString(sum[:])})
	digest := sha256.Sum256([]byte(signing))
	r, s, _ := ecdsa.Sign(rand.Reader, key, digest[:])
	sig := append(r.FillBytes(make([]byte, 32)), s.FillBytes(make([]byte, 32))...)
	return signing + "." + base64.RawURLEncoding.EncodeToString(sig)
}
