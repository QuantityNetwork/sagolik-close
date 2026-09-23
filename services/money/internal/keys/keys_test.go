package keys

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/kms"
)

var ctxA = Context{Purpose: "bank_connection.access_token", RecordID: "11111111-1111-4111-8111-111111111111"}

func localEnvelope(t *testing.T) (*Envelope, *LocalProvider) {
	t.Helper()
	doc, err := NewKeyringDocument("v1")
	if err != nil {
		t.Fatal(err)
	}
	p, err := ParseKeyring(doc)
	if err != nil {
		t.Fatal(err)
	}
	return NewEnvelope(p), p
}

func TestLocalRoundTrip(t *testing.T) {
	env, _ := localEnvelope(t)
	ctx := context.Background()
	v, err := env.Seal(ctx, []byte("access-sandbox-abc"), ctxA)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(v, "sce1.") || strings.Contains(v, "access-sandbox") {
		t.Fatalf("unexpected sealed form %q", v)
	}
	pt, err := env.Open(ctx, v, ctxA)
	if err != nil || string(pt) != "access-sandbox-abc" {
		t.Fatalf("open: %v %q", err, pt)
	}
	// Every seal uses a fresh data key and nonce.
	v2, _ := env.Seal(ctx, []byte("access-sandbox-abc"), ctxA)
	if v == v2 {
		t.Fatal("two seals of the same value must differ")
	}
}

func TestContextBinding(t *testing.T) {
	env, _ := localEnvelope(t)
	ctx := context.Background()
	v, _ := env.Seal(ctx, []byte("4111"), ctxA)
	for _, other := range []Context{
		{Purpose: ctxA.Purpose, RecordID: "22222222-2222-4222-8222-222222222222"},
		{Purpose: "bank_account.number", RecordID: ctxA.RecordID},
	} {
		if _, err := env.Open(ctx, v, other); !errors.Is(err, ErrDecrypt) {
			t.Fatalf("value opened under a different context %+v: %v", other, err)
		}
	}
	if _, err := env.Seal(ctx, []byte("x"), Context{Purpose: "p"}); err == nil {
		t.Fatal("empty record id must be rejected")
	}
}

func TestTamperingIsDetected(t *testing.T) {
	env, _ := localEnvelope(t)
	ctx := context.Background()
	v, _ := env.Seal(ctx, []byte("secret"), ctxA)
	raw, _ := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(v, prefix))
	var s sealed
	_ = json.Unmarshal(raw, &s)
	for name, mutate := range map[string]func(*sealed){
		"cipher":  func(s *sealed) { s.Cipher[0] ^= 1 },
		"nonce":   func(s *sealed) { s.Nonce[0] ^= 1 },
		"wrapped": func(s *sealed) { s.Wrapped[len(s.Wrapped)-1] ^= 1 },
	} {
		c := s
		c.Cipher, c.Nonce, c.Wrapped = append([]byte{}, s.Cipher...), append([]byte{}, s.Nonce...), append([]byte{}, s.Wrapped...)
		mutate(&c)
		b, _ := json.Marshal(c)
		if _, err := env.Open(ctx, prefix+base64.RawURLEncoding.EncodeToString(b), ctxA); !errors.Is(err, ErrDecrypt) {
			t.Fatalf("tampered %s was accepted: %v", name, err)
		}
	}
	for _, junk := range []string{"", "plain", "sce1.", "sce1.!!!", "sce1." + base64.RawURLEncoding.EncodeToString([]byte(`{"p":"local","x":1}`))} {
		if _, err := env.Open(ctx, junk, ctxA); !errors.Is(err, ErrDecrypt) {
			t.Fatalf("junk %q: %v", junk, err)
		}
	}
}

func TestRotationKeepsOldValuesReadable(t *testing.T) {
	ctx := context.Background()
	k1 := base64.StdEncoding.EncodeToString(make([]byte, 32))
	k2b := make([]byte, 32)
	_, _ = rand.Read(k2b)
	k2 := base64.StdEncoding.EncodeToString(k2b)

	old, err := ParseKeyring([]byte(`{"active":"v1","keys":{"v1":"` + k1 + `"}}`))
	if err != nil {
		t.Fatal(err)
	}
	v, _ := NewEnvelope(old).Seal(ctx, []byte("before rotation"), ctxA)

	rotated, err := ParseKeyring([]byte(`{"active":"v2","keys":{"v1":"` + k1 + `","v2":"` + k2 + `"}}`))
	if err != nil {
		t.Fatal(err)
	}
	env := NewEnvelope(rotated)
	if pt, err := env.Open(ctx, v, ctxA); err != nil || string(pt) != "before rotation" {
		t.Fatalf("old value unreadable after rotation: %v", err)
	}
	nv, _ := env.Seal(ctx, []byte("after"), ctxA)
	if ref, _ := KeyRefOf(nv); ref != "local:v2" {
		t.Fatalf("new values must use the active key, got %s", ref)
	}
	// Retiring v1 makes old values unreadable — rotation must re-wrap first.
	retired, _ := ParseKeyring([]byte(`{"active":"v2","keys":{"v2":"` + k2 + `"}}`))
	if _, err := NewEnvelope(retired).Open(ctx, v, ctxA); !errors.Is(err, ErrDecrypt) {
		t.Fatal("value sealed with a retired key must not open")
	}
}

func TestKeyringValidation(t *testing.T) {
	good := base64.StdEncoding.EncodeToString(make([]byte, 32))
	for name, doc := range map[string]string{
		"empty":          `{"active":"v1","keys":{}}`,
		"short key":      `{"active":"v1","keys":{"v1":"` + base64.StdEncoding.EncodeToString(make([]byte, 16)) + `"}}`,
		"missing active": `{"active":"v9","keys":{"v1":"` + good + `"}}`,
		"bad version":    `{"active":"V 1","keys":{"V 1":"` + good + `"}}`,
		"unknown field":  `{"active":"v1","keys":{"v1":"` + good + `"},"x":1}`,
	} {
		if _, err := ParseKeyring([]byte(doc)); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestKeyringFilePermissions(t *testing.T) {
	doc, _ := NewKeyringDocument("v1")
	dir := t.TempDir()
	path := filepath.Join(dir, "keyring.json")
	if err := os.WriteFile(path, doc, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadKeyringFile(path); err == nil {
		t.Fatal("world-readable keyring must be refused")
	}
	_ = os.Chmod(path, 0o600)
	if _, err := LoadKeyringFile(path); err != nil {
		t.Fatalf("0600 keyring refused: %v", err)
	}
}

// ---------------------------------------------------------------------------
// AWS KMS provider, exercised through the real SDK against a local fake that
// speaks the KMS JSON protocol and enforces encryption contexts like KMS does.

type fakeKMS struct {
	mu     sync.Mutex
	keyARN string
	kek    []byte
	calls  []string
}

func (f *fakeKMS) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	target := r.Header.Get("X-Amz-Target")
	if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") {
		kmsError(w, "UnrecognizedClientException", "missing SigV4 signature")
		return
	}
	var in struct {
		KeyID             string            `json:"KeyId"`
		KeySpec           string            `json:"KeySpec"`
		CiphertextBlob    []byte            `json:"CiphertextBlob"`
		EncryptionContext map[string]string `json:"EncryptionContext"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		kmsError(w, "SerializationException", err.Error())
		return
	}
	f.mu.Lock()
	f.calls = append(f.calls, target)
	f.mu.Unlock()
	aad, _ := json.Marshal(in.EncryptionContext) // Go marshals map keys sorted: canonical
	block, _ := aes.NewCipher(f.kek)
	aead, _ := cipher.NewGCM(block)
	w.Header().Set("Content-Type", "application/x-amz-json-1.1")
	switch target {
	case "TrentService.GenerateDataKey":
		if in.KeyID != f.keyARN && in.KeyID != "alias/sagolik-money" {
			kmsError(w, "NotFoundException", "key not found")
			return
		}
		if in.KeySpec != "AES_256" {
			kmsError(w, "ValidationException", "bad key spec")
			return
		}
		dek := make([]byte, 32)
		_, _ = rand.Read(dek)
		nonce := make([]byte, 12)
		_, _ = rand.Read(nonce)
		blob := append(nonce, aead.Seal(nil, nonce, dek, aad)...)
		_ = json.NewEncoder(w).Encode(map[string]any{"KeyId": f.keyARN, "Plaintext": dek, "CiphertextBlob": blob})
	case "TrentService.Decrypt":
		if in.KeyID != f.keyARN || len(in.CiphertextBlob) < 28 {
			kmsError(w, "IncorrectKeyException", "wrong key")
			return
		}
		dek, err := aead.Open(nil, in.CiphertextBlob[:12], in.CiphertextBlob[12:], aad)
		if err != nil {
			kmsError(w, "InvalidCiphertextException", "")
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"KeyId": f.keyARN, "Plaintext": dek})
	default:
		kmsError(w, "UnknownOperationException", target)
	}
}

func kmsError(w http.ResponseWriter, typ, msg string) {
	w.Header().Set("Content-Type", "application/x-amz-json-1.1")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]string{"__type": typ, "message": msg})
}

func TestAWSKMSProvider(t *testing.T) {
	kek := make([]byte, 32)
	_, _ = rand.Read(kek)
	fake := &fakeKMS{keyARN: "arn:aws:kms:us-east-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab", kek: kek}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	client := kms.New(kms.Options{
		Region:           "us-east-1",
		BaseEndpoint:     aws.String(srv.URL),
		Credentials:      credentials.NewStaticCredentialsProvider("AKIDEXAMPLE", "test-secret", ""),
		RetryMaxAttempts: 1,
	})
	p, err := NewAWSKMSProvider(client, "alias/sagolik-money")
	if err != nil {
		t.Fatal(err)
	}
	env := NewEnvelope(p)
	ctx := context.Background()
	v, err := env.Seal(ctx, []byte("021000021-000123456789"), ctxA)
	if err != nil {
		t.Fatal(err)
	}
	if ref, _ := KeyRefOf(v); ref != fake.keyARN {
		t.Fatalf("key ref should pin the key ARN, got %s", ref)
	}
	pt, err := env.Open(ctx, v, ctxA)
	if err != nil || string(pt) != "021000021-000123456789" {
		t.Fatalf("open: %v", err)
	}
	if _, err := env.Open(ctx, v, Context{Purpose: ctxA.Purpose, RecordID: "other"}); !errors.Is(err, ErrDecrypt) {
		t.Fatal("KMS must refuse a different encryption context")
	}
	want := []string{"TrentService.GenerateDataKey", "TrentService.Decrypt", "TrentService.Decrypt"}
	if !reflect.DeepEqual(fake.calls, want) {
		t.Fatalf("calls = %v", fake.calls)
	}
	// A value sealed locally can't be opened by the KMS provider (and vice versa).
	local, _ := localEnvelope(t)
	lv, _ := local.Seal(ctx, []byte("x"), ctxA)
	if _, err := env.Open(ctx, lv, ctxA); err == nil {
		t.Fatal("provider mismatch must fail")
	}
}
