package redact

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"testing"
)

func TestSecretNeverLeaks(t *testing.T) {
	s := NewSecret("access-sandbox-1234567890")
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))
	logger.Info("connected", "token", s, "nested", map[string]any{"t": s})
	js, _ := json.Marshal(struct{ T Secret }{s})
	outputs := []string{buf.String(), string(js), fmt.Sprintf("%v %+v %#v %s %q %x %X %d", s, s, s, s, s, s, s, s), s.String()}
	for _, out := range outputs {
		if strings.Contains(out, "1234567890") {
			t.Fatalf("secret leaked: %s", out)
		}
	}
	if s.Reveal() != "access-sandbox-1234567890" {
		t.Fatal("Reveal must return the value")
	}
}

func TestWipe(t *testing.T) {
	b := []byte{1, 2, 3}
	Wipe(b)
	if !bytes.Equal(b, []byte{0, 0, 0}) {
		t.Fatal("not wiped")
	}
}
