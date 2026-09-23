// Package policy holds the authorization rules the money service enforces
// itself. Role lists mirror the web app's ROLE_PERMISSIONS; a test in
// packages/auth fails if they drift.
package policy

import (
	_ "embed"
	"encoding/json"
	"slices"
)

//go:embed financial_view_roles.json
var financialViewJSON []byte

var financialViewRoles = mustRoles(financialViewJSON)

func mustRoles(b []byte) []string {
	var roles []string
	if err := json.Unmarshal(b, &roles); err != nil || len(roles) == 0 {
		panic("policy: invalid embedded role list")
	}
	return roles
}

// CanViewFunds reports whether a participant role may see money for a transaction.
func CanViewFunds(role string) bool { return slices.Contains(financialViewRoles, role) }
