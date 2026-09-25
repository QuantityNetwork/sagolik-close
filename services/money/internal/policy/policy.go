// Package policy holds the authorization rules the money service enforces
// itself. The role lists (roles.json) mirror the web app's ROLE_PERMISSIONS;
// a test in packages/auth fails if they drift.
package policy

import (
	_ "embed"
	"encoding/json"
	"slices"
	"time"
)

//go:embed roles.json
var rolesJSON []byte

// Permission names shared with the web app.
const (
	ViewFunds         = "financial.view"
	ModifyBeneficiary = "beneficiary.modify"
	VerifyBeneficiary = "beneficiary.verify"
	InitiatePayment   = "payment.initiate" // the payer: may see full wire details
	ManageEscrow      = "escrow.manage"    // may record what escrow reports
)

// StepUpMaxAge matches the web app's STEP_UP_MAX_AGE_MS.
const StepUpMaxAge = 5 * time.Minute

var roles = mustRoles(rolesJSON)

func mustRoles(b []byte) map[string][]string {
	var m map[string][]string
	if err := json.Unmarshal(b, &m); err != nil {
		panic("policy: invalid embedded roles.json")
	}
	for _, p := range []string{ViewFunds, ModifyBeneficiary, VerifyBeneficiary, InitiatePayment, ManageEscrow} {
		if len(m[p]) == 0 {
			panic("policy: roles.json has no roles for " + p)
		}
	}
	return m
}

// Can reports whether a participant role holds a permission.
func Can(role, permission string) bool { return slices.Contains(roles[permission], role) }

// CanViewFunds is kept for readability at call sites.
func CanViewFunds(role string) bool { return Can(role, ViewFunds) }
