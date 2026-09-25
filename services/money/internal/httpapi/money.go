package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/assertion"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/policy"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/redact"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/store"
)

// scoped: the assertion is for this transaction and the role holds permission.
// Refusals are 404s so callers can't probe for transactions they can't see.
func (s *Server) scoped(p assertion.Principal, txID, permission string) bool {
	return uuidRe.MatchString(txID) && p.TransactionID == txID && policy.Can(p.Role, permission)
}

// stepUp requires AAL2 and a confirmation within policy.StepUpMaxAge.
func (s *Server) stepUp(w http.ResponseWriter, r *http.Request, p assertion.Principal) bool {
	if p.AAL2 && p.StepUpFresh(s.now(), policy.StepUpMaxAge) {
		return true
	}
	writeError(w, r, http.StatusForbidden, "step_up_required", "Please confirm it's you before continuing. It takes a few seconds, then try again.")
	return false
}

func notFound(w http.ResponseWriter, r *http.Request) {
	writeError(w, r, http.StatusNotFound, "not_found", "That item couldn't be found, or you don't have access to it.")
}

// decode reads exactly one JSON object with no unknown fields.
func decode(w http.ResponseWriter, r *http.Request, into any) bool {
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		writeError(w, r, http.StatusUnsupportedMediaType, "bad_request", "Send JSON.")
		return false
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil || dec.More() {
		writeError(w, r, http.StatusBadRequest, "bad_request", "The request body isn't valid.")
		return false
	}
	return true
}

// storeError maps domain errors to responses written for people.
func (s *Server) storeError(w http.ResponseWriter, r *http.Request, err error) {
	var coe *store.CoolingOffError
	switch {
	case errors.As(err, &coe):
		writeError(w, r, http.StatusForbidden, "forbidden", fmt.Sprintf("These payment instructions changed recently and are in a security waiting period until %s.", coe.Until.UTC().Format("Jan 2, 2006 15:04 MST")))
	case errors.Is(err, store.ErrNotFound):
		notFound(w, r)
	case errors.Is(err, store.ErrInvalidInstruction):
		writeError(w, r, http.StatusBadRequest, "bad_request", "Some of the payment details aren't valid: "+strings.TrimPrefix(err.Error(), store.ErrInvalidInstruction.Error()+": ")+".")
	case errors.Is(err, store.ErrInvalidMovement):
		writeError(w, r, http.StatusBadRequest, "bad_request", "The entry isn't valid: "+strings.TrimPrefix(err.Error(), store.ErrInvalidMovement.Error()+": ")+".")
	case errors.Is(err, store.ErrSelfVerification):
		writeError(w, r, http.StatusForbidden, "forbidden", "Instructions must be verified by someone other than the person who entered them.")
	case errors.Is(err, store.ErrNotLatest):
		writeError(w, r, http.StatusConflict, "conflict", "These payment instructions have been replaced. Please review the current instructions.")
	case errors.Is(err, store.ErrAlreadyDecided):
		writeError(w, r, http.StatusConflict, "conflict", "These instructions aren't waiting for verification.")
	case errors.Is(err, store.ErrNotVerified):
		writeError(w, r, http.StatusConflict, "conflict", "These payment instructions haven't been independently verified yet.")
	case errors.Is(err, store.ErrInsufficientHeld):
		writeError(w, r, http.StatusConflict, "conflict", "That payout is larger than the funds escrow has reported holding.")
	case errors.Is(err, store.ErrConflict):
		writeError(w, r, http.StatusConflict, "idempotency_conflict", "This request was already used for a different entry.")
	default:
		s.fail(w, r, err)
	}
}

func (s *Server) listInstructions(w http.ResponseWriter, r *http.Request) {
	p, id := principalFrom(r), r.PathValue("id")
	if !s.scoped(p, id, policy.ViewFunds) {
		notFound(w, r)
		return
	}
	list, err := s.Store.ListInstructions(r.Context(), id, s.now())
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"instructions": list})
}

type createInstructionBody struct {
	Purpose         string   `json:"purpose"`
	BeneficiaryName string   `json:"beneficiaryName"`
	BankName        string   `json:"bankName"`
	RoutingNumber   string   `json:"routingNumber"`
	AccountNumber   string   `json:"accountNumber"`
	Currency        string   `json:"currency"`
	HoursToClosing  *float64 `json:"hoursToClosing,omitempty"`
}

func (s *Server) createInstruction(w http.ResponseWriter, r *http.Request) {
	p, id := principalFrom(r), r.PathValue("id")
	if !s.scoped(p, id, policy.ModifyBeneficiary) {
		notFound(w, r)
		return
	}
	if !s.stepUp(w, r, p) {
		return
	}
	var b createInstructionBody
	if !decode(w, r, &b) {
		return
	}
	coolingOff := s.CoolingOff
	if coolingOff == 0 {
		coolingOff = 24 * time.Hour
	}
	in, err := s.Store.CreateInstruction(r.Context(), s.Sealer, store.NewInstruction{
		TransactionID: id, Purpose: b.Purpose, BeneficiaryName: b.BeneficiaryName, BankName: b.BankName,
		RoutingNumber: b.RoutingNumber, AccountNumber: redact.NewSecret(strings.ReplaceAll(b.AccountNumber, " ", "")),
		Currency: b.Currency, CreatedBy: p.UserID, CoolingOff: coolingOff, HoursToClosing: b.HoursToClosing,
		RequestID: requestID(r), Now: s.now(),
	})
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"instruction": in})
}

// instructionInScope loads an instruction and checks it belongs to the assertion's transaction.
func (s *Server) instructionInScope(w http.ResponseWriter, r *http.Request, p assertion.Principal, permission string) (store.Instruction, bool) {
	in, err := s.Store.GetInstruction(r.Context(), r.PathValue("iid"), s.now())
	if err != nil {
		s.storeError(w, r, err)
		return in, false
	}
	if !s.scoped(p, in.TransactionID, permission) {
		notFound(w, r)
		return in, false
	}
	return in, true
}

type verifyBody struct {
	Method    string `json:"method"`
	Reference string `json:"reference"`
}

func (s *Server) verifyInstruction(w http.ResponseWriter, r *http.Request) {
	p := principalFrom(r)
	in, ok := s.instructionInScope(w, r, p, policy.VerifyBeneficiary)
	if !ok || !s.stepUp(w, r, p) {
		return
	}
	var b verifyBody
	if !decode(w, r, &b) {
		return
	}
	out, err := s.Store.VerifyInstruction(r.Context(), in.ID, p.UserID, b.Method, strings.TrimSpace(b.Reference), requestID(r), s.now())
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"instruction": out})
}

func (s *Server) revealInstruction(w http.ResponseWriter, r *http.Request) {
	p := principalFrom(r)
	in, ok := s.instructionInScope(w, r, p, policy.InitiatePayment)
	if !ok || !s.stepUp(w, r, p) {
		return
	}
	rev, err := s.Store.RevealInstruction(r.Context(), s.Sealer, in.ID, p.UserID, requestID(r), s.now())
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	// The one place a full account number leaves the service: to the payer, over mTLS.
	writeJSON(w, http.StatusOK, map[string]any{"instruction": rev.Instruction, "accountNumber": rev.AccountNumber.Reveal()})
}

type movementBody struct {
	Kind           string `json:"kind"`
	Amount         int64  `json:"amount"`
	Currency       string `json:"currency"`
	Reference      string `json:"reference"`
	IdempotencyKey string `json:"idempotencyKey"`
}

var referenceRe = regexp.MustCompile(`^[\p{L}\p{N} .,:#/_-]{3,120}$`)

// recordMovement: the escrow officer records what their escrow system shows
// (funds expected, received, disbursed). Sagolik never moves these funds.
func (s *Server) recordMovement(w http.ResponseWriter, r *http.Request) {
	p, id := principalFrom(r), r.PathValue("id")
	if !s.scoped(p, id, policy.ManageEscrow) {
		notFound(w, r)
		return
	}
	if !s.stepUp(w, r, p) {
		return
	}
	var b movementBody
	if !decode(w, r, &b) {
		return
	}
	if !referenceRe.MatchString(b.Reference) {
		writeError(w, r, http.StatusBadRequest, "bad_request", "Add the reference from your escrow system (3–120 characters).")
		return
	}
	groupID, created, err := s.Store.RecordMovement(r.Context(), store.Movement{
		TransactionID: id, Kind: b.Kind, Amount: b.Amount, Currency: b.Currency,
		Source: "escrow_officer:" + b.Reference, IdempotencyKey: b.IdempotencyKey, RecordedBy: "user:" + p.UserID,
	})
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	status := http.StatusCreated
	if !created {
		status = http.StatusOK
	}
	summary, err := s.Store.FundsSummary(r.Context(), id)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, status, map[string]any{"groupId": groupID, "created": created, "balances": summary})
}
