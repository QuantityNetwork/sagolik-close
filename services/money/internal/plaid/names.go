package plaid

import (
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// normalizeName lowercases, strips accents and punctuation, and sorts tokens
// of two or more letters, so "CARTER, Olivia M." and "Olivia Carter" compare equal.
func normalizeName(s string) []string {
	var b strings.Builder
	for _, r := range norm.NFD.String(s) {
		switch {
		case unicode.Is(unicode.Mn, r):
		case unicode.IsLetter(r):
			b.WriteRune(unicode.ToLower(r))
		default:
			b.WriteRune(' ')
		}
	}
	var out []string
	for _, t := range strings.Fields(b.String()) {
		if len([]rune(t)) > 1 {
			out = append(out, t)
		}
	}
	sort.Strings(out)
	return out
}

// NamesMatch is the same loose rule as the web app's namesMatch: equal token
// sets, or at least two shared tokens (one when either name has one token).
func NamesMatch(a, b string) bool {
	ta, tb := normalizeName(a), normalizeName(b)
	if len(ta) == 0 || len(tb) == 0 {
		return false
	}
	if strings.Join(ta, " ") == strings.Join(tb, " ") {
		return true
	}
	set := map[string]bool{}
	for _, t := range ta {
		set[t] = true
	}
	shared := 0
	for _, t := range tb {
		if set[t] {
			shared++
		}
	}
	return shared >= 2 || (shared >= 1 && min(len(set), len(tb)) == 1)
}

// AnyNameMatches reports whether any owner name matches the expected name.
func AnyNameMatches(owners []string, expected string) bool {
	for _, o := range owners {
		if NamesMatch(o, expected) {
			return true
		}
	}
	return false
}
