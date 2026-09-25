// Package plaid is the money service's Plaid client. It uses Hosted Link, so
// the person gives consent on Plaid's own pages and Sagolik never sees bank
// credentials. It asks only for what the closing needs: account ownership
// (Identity) and balances (proof of funds). It does not request Auth, so full
// account and routing numbers never reach us.
package plaid

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/redact"
)

// Hosts per Plaid environment.
var Hosts = map[string]string{
	"sandbox":    "https://sandbox.plaid.com",
	"production": "https://production.plaid.com",
}

// Client calls Plaid's API. Credentials travel in the request body, as Plaid requires.
type Client struct {
	BaseURL  string
	ClientID string
	Secret   redact.Secret
	HTTP     *http.Client
}

// New returns a client for "sandbox" or "production".
func New(env, clientID string, secret redact.Secret) (*Client, error) {
	host, ok := Hosts[env]
	if !ok {
		return nil, fmt.Errorf("plaid: unknown environment %q", env)
	}
	if clientID == "" || secret.IsZero() {
		return nil, errors.New("plaid: client id and secret are required")
	}
	return &Client{BaseURL: host, ClientID: clientID, Secret: secret, HTTP: &http.Client{Timeout: 30 * time.Second}}, nil
}

// Error is a Plaid API error. Message is written for people; Code is Plaid's.
type Error struct {
	Status    int
	Type      string
	Code      string
	Retryable bool
	Reconnect bool // the person must reconnect through Link
}

func (e *Error) Error() string {
	return fmt.Sprintf("plaid: %s/%s (HTTP %d)", e.Type, e.Code, e.Status)
}

// Message is safe to show to the person.
func (e *Error) Message() string {
	switch e.Code {
	case "ITEM_LOGIN_REQUIRED", "INVALID_ACCESS_TOKEN", "ITEM_NOT_FOUND", "ACCESS_NOT_GRANTED", "USER_PERMISSION_REVOKED":
		return "Your bank needs you to reconnect before we can check the account."
	case "INSTITUTION_DOWN", "INSTITUTION_NOT_RESPONDING", "INSTITUTION_NOT_AVAILABLE":
		return "Your bank isn't responding right now. Please try again in a little while."
	case "RATE_LIMIT_EXCEEDED", "BALANCE_LIMIT":
		return "We're checking too often. Please try again in a minute."
	case "PRODUCTS_NOT_SUPPORTED", "NO_ACCOUNTS":
		return "This bank doesn't share the information we need. Please try another account."
	case "INVALID_LINK_TOKEN":
		return "The bank connection expired before it finished. Please start again."
	}
	return "Something went wrong talking to your bank. Please try again."
}

var reconnectCodes = map[string]bool{
	"ITEM_LOGIN_REQUIRED": true, "INVALID_ACCESS_TOKEN": true, "ITEM_NOT_FOUND": true,
	"ACCESS_NOT_GRANTED": true, "USER_PERMISSION_REVOKED": true,
}

// call POSTs a JSON body with credentials and decodes the response into out.
func (c *Client) call(ctx context.Context, path string, body map[string]any, out any) error {
	payload := map[string]any{"client_id": c.ClientID, "secret": c.Secret.Reveal()}
	for k, v := range body {
		payload[k] = v
	}
	buf, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+path, bytes.NewReader(buf))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Plaid-Version", "2020-09-14")
	res, err := c.HTTP.Do(req)
	if err != nil {
		// Transport errors can echo the URL but never the body, so no secret leaks here.
		return &Error{Status: 0, Type: "NETWORK", Code: "NETWORK", Retryable: true}
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return &Error{Status: res.StatusCode, Type: "NETWORK", Code: "NETWORK", Retryable: true}
	}
	if res.StatusCode != http.StatusOK {
		var pe struct {
			ErrorType string `json:"error_type"`
			ErrorCode string `json:"error_code"`
		}
		_ = json.Unmarshal(raw, &pe)
		if pe.ErrorCode == "" {
			pe.ErrorCode = fmt.Sprintf("HTTP_%d", res.StatusCode)
		}
		return &Error{
			Status: res.StatusCode, Type: pe.ErrorType, Code: pe.ErrorCode,
			Retryable: res.StatusCode >= 500 || pe.ErrorCode == "RATE_LIMIT_EXCEEDED",
			Reconnect: reconnectCodes[pe.ErrorCode],
		}
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("plaid: decode %s: %w", path, err)
	}
	return nil
}

// LinkRequest starts a Hosted Link session for one person.
type LinkRequest struct {
	ClientUserID string // our user id; Plaid uses it to recognise returning users
	LegalName    string // optional
	RedirectURI  string // where Plaid sends the person when they finish
	WebhookURL   string // optional; Plaid's webhooks for this Item
}

// LinkToken is a started Hosted Link session.
type LinkToken struct {
	Token     redact.Secret
	HostedURL string
	ExpiresAt time.Time
}

// CreateHostedLink calls /link/token/create with Hosted Link.
func (c *Client) CreateHostedLink(ctx context.Context, r LinkRequest) (LinkToken, error) {
	user := map[string]any{"client_user_id": r.ClientUserID}
	if r.LegalName != "" {
		user["legal_name"] = r.LegalName
	}
	body := map[string]any{
		"user":          user,
		"client_name":   "Sagolik Close",
		"products":      []string{"identity"},
		"country_codes": []string{"US"},
		"language":      "en",
		"hosted_link":   map[string]any{"completion_redirect_uri": r.RedirectURI, "url_lifetime_seconds": 1800},
	}
	if r.WebhookURL != "" {
		body["webhook"] = r.WebhookURL
	}
	var out struct {
		LinkToken     string    `json:"link_token"`
		HostedLinkURL string    `json:"hosted_link_url"`
		Expiration    time.Time `json:"expiration"`
	}
	if err := c.call(ctx, "/link/token/create", body, &out); err != nil {
		return LinkToken{}, err
	}
	if out.LinkToken == "" || !strings.HasPrefix(out.HostedLinkURL, "https://") {
		return LinkToken{}, &Error{Status: http.StatusOK, Type: "API_ERROR", Code: "NO_HOSTED_LINK", Retryable: true}
	}
	return LinkToken{Token: redact.NewSecret(out.LinkToken), HostedURL: out.HostedLinkURL, ExpiresAt: out.Expiration}, nil
}

// ErrLinkNotFinished: the person hasn't finished (or abandoned) Link yet.
var ErrLinkNotFinished = errors.New("plaid: link session not finished")

// PublicToken reads the finished session's public token from /link/token/get.
func (c *Client) PublicToken(ctx context.Context, linkToken redact.Secret) (redact.Secret, error) {
	var out struct {
		LinkSessions []struct {
			Results *struct {
				ItemAddResults []struct {
					PublicToken string `json:"public_token"`
				} `json:"item_add_results"`
			} `json:"results"`
		} `json:"link_sessions"`
	}
	if err := c.call(ctx, "/link/token/get", map[string]any{"link_token": linkToken.Reveal()}, &out); err != nil {
		return redact.Secret{}, err
	}
	// Newest session first, per Plaid; take the first one that added an Item.
	for _, s := range out.LinkSessions {
		if s.Results != nil && len(s.Results.ItemAddResults) > 0 && s.Results.ItemAddResults[0].PublicToken != "" {
			return redact.NewSecret(s.Results.ItemAddResults[0].PublicToken), nil
		}
	}
	return redact.Secret{}, ErrLinkNotFinished
}

// Exchange swaps a public token for a long-lived access token.
func (c *Client) Exchange(ctx context.Context, publicToken redact.Secret) (accessToken redact.Secret, itemID string, err error) {
	var out struct {
		AccessToken string `json:"access_token"`
		ItemID      string `json:"item_id"`
	}
	if err := c.call(ctx, "/item/public_token/exchange", map[string]any{"public_token": publicToken.Reveal()}, &out); err != nil {
		return redact.Secret{}, "", err
	}
	return redact.NewSecret(out.AccessToken), out.ItemID, nil
}

// Item is the connection's metadata.
type Item struct {
	ItemID           string
	InstitutionID    string
	InstitutionName  string
	ConsentExpiresAt *time.Time
	ErrorCode        string
}

func (c *Client) Item(ctx context.Context, accessToken redact.Secret) (Item, error) {
	var out struct {
		Item struct {
			ItemID                string     `json:"item_id"`
			InstitutionID         *string    `json:"institution_id"`
			InstitutionName       *string    `json:"institution_name"`
			ConsentExpirationTime *time.Time `json:"consent_expiration_time"`
			Error                 *struct {
				ErrorCode string `json:"error_code"`
			} `json:"error"`
		} `json:"item"`
	}
	if err := c.call(ctx, "/item/get", map[string]any{"access_token": accessToken.Reveal()}, &out); err != nil {
		return Item{}, err
	}
	it := Item{ItemID: out.Item.ItemID, ConsentExpiresAt: out.Item.ConsentExpirationTime}
	if out.Item.InstitutionID != nil {
		it.InstitutionID = *out.Item.InstitutionID
	}
	if out.Item.InstitutionName != nil {
		it.InstitutionName = *out.Item.InstitutionName
	}
	if out.Item.Error != nil {
		it.ErrorCode = out.Item.Error.ErrorCode
	}
	return it, nil
}

// Account is one account on an Item. Amounts are integer cents.
type Account struct {
	AccountID string
	Name      string
	Mask      string
	Type      string
	Subtype   string
	Currency  string
	Available *int64
	Current   *int64
	Owners    []string // from Identity only
}

type plaidAccount struct {
	AccountID string  `json:"account_id"`
	Name      string  `json:"name"`
	Mask      *string `json:"mask"`
	Type      string  `json:"type"`
	Subtype   *string `json:"subtype"`
	Balances  struct {
		Available       *float64 `json:"available"`
		Current         *float64 `json:"current"`
		ISOCurrencyCode *string  `json:"iso_currency_code"`
	} `json:"balances"`
	Owners []struct {
		Names []string `json:"names"`
	} `json:"owners"`
}

func cents(v *float64) *int64 {
	if v == nil || math.IsNaN(*v) || math.IsInf(*v, 0) {
		return nil
	}
	c := int64(math.Round(*v * 100))
	return &c
}

func (a plaidAccount) toAccount() Account {
	out := Account{AccountID: a.AccountID, Name: a.Name, Type: a.Type, Currency: "USD",
		Available: cents(a.Balances.Available), Current: cents(a.Balances.Current)}
	if a.Mask != nil {
		m := *a.Mask
		if len(m) > 4 {
			m = m[len(m)-4:]
		}
		out.Mask = m
	}
	if a.Subtype != nil {
		out.Subtype = *a.Subtype
	}
	if a.Balances.ISOCurrencyCode != nil && len(*a.Balances.ISOCurrencyCode) == 3 {
		out.Currency = *a.Balances.ISOCurrencyCode
	}
	for _, o := range a.Owners {
		out.Owners = append(out.Owners, o.Names...)
	}
	return out
}

// Identity returns accounts with their owners' names (/identity/get).
func (c *Client) Identity(ctx context.Context, accessToken redact.Secret) ([]Account, error) {
	var out struct {
		Accounts []plaidAccount `json:"accounts"`
	}
	if err := c.call(ctx, "/identity/get", map[string]any{"access_token": accessToken.Reveal()}, &out); err != nil {
		return nil, err
	}
	accts := make([]Account, 0, len(out.Accounts))
	for _, a := range out.Accounts {
		accts = append(accts, a.toAccount())
	}
	return accts, nil
}

// Balances returns real-time balances (/accounts/balance/get).
func (c *Client) Balances(ctx context.Context, accessToken redact.Secret, accountIDs ...string) ([]Account, error) {
	body := map[string]any{"access_token": accessToken.Reveal()}
	if len(accountIDs) > 0 {
		body["options"] = map[string]any{"account_ids": accountIDs}
	}
	var out struct {
		Accounts []plaidAccount `json:"accounts"`
	}
	if err := c.call(ctx, "/accounts/balance/get", body, &out); err != nil {
		return nil, err
	}
	accts := make([]Account, 0, len(out.Accounts))
	for _, a := range out.Accounts {
		accts = append(accts, a.toAccount())
	}
	return accts, nil
}

// RemoveItem revokes the access token at Plaid.
func (c *Client) RemoveItem(ctx context.Context, accessToken redact.Secret) error {
	var out struct{}
	return c.call(ctx, "/item/remove", map[string]any{"access_token": accessToken.Reveal()}, &out)
}

// SandboxPublicToken creates an Item without the Link UI. Sandbox only; used by tests.
func (c *Client) SandboxPublicToken(ctx context.Context, institutionID string, products []string) (redact.Secret, error) {
	if c.BaseURL == Hosts["production"] {
		return redact.Secret{}, errors.New("plaid: sandbox endpoint called in production")
	}
	var out struct {
		PublicToken string `json:"public_token"`
	}
	if err := c.call(ctx, "/sandbox/public_token/create", map[string]any{"institution_id": institutionID, "initial_products": products}, &out); err != nil {
		return redact.Secret{}, err
	}
	return redact.NewSecret(out.PublicToken), nil
}
