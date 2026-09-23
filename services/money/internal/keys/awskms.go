package keys

import (
	"context"
	"errors"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/kms"
	"github.com/aws/aws-sdk-go-v2/service/kms/types"
)

// KMSAPI is the subset of the AWS KMS client this provider uses.
type KMSAPI interface {
	GenerateDataKey(ctx context.Context, in *kms.GenerateDataKeyInput, opts ...func(*kms.Options)) (*kms.GenerateDataKeyOutput, error)
	Decrypt(ctx context.Context, in *kms.DecryptInput, opts ...func(*kms.Options)) (*kms.DecryptOutput, error)
}

// AWSKMSProvider wraps data keys with an AWS KMS key. The KEK never leaves
// KMS's FIPS 140-validated HSMs; the encryption context is enforced by KMS
// and recorded in CloudTrail for every call.
//
// Cost: pay-as-you-go (per key per month, plus per-request charges) — no
// contract or commitment. One call per Seal and one per Open.
type AWSKMSProvider struct {
	client KMSAPI
	keyID  string
}

func NewAWSKMSProvider(client KMSAPI, keyID string) (*AWSKMSProvider, error) {
	if client == nil || keyID == "" {
		return nil, errors.New("keys: aws kms provider needs a client and key id")
	}
	return &AWSKMSProvider{client: client, keyID: keyID}, nil
}

func (p *AWSKMSProvider) Name() string { return "awskms" }

func (p *AWSKMSProvider) GenerateDataKey(ctx context.Context, ec Context) ([]byte, []byte, string, error) {
	out, err := p.client.GenerateDataKey(ctx, &kms.GenerateDataKeyInput{
		KeyId:             aws.String(p.keyID),
		KeySpec:           types.DataKeySpecAes256,
		EncryptionContext: ec.Map(),
	})
	if err != nil {
		return nil, nil, "", err
	}
	if len(out.Plaintext) != 32 || len(out.CiphertextBlob) == 0 || out.KeyId == nil {
		return nil, nil, "", errors.New("keys: unexpected GenerateDataKey response")
	}
	// KeyId in the response is the full key ARN: pin decryption to exactly this key.
	return out.Plaintext, out.CiphertextBlob, *out.KeyId, nil
}

func (p *AWSKMSProvider) DecryptDataKey(ctx context.Context, wrapped []byte, keyRef string, ec Context) ([]byte, error) {
	out, err := p.client.Decrypt(ctx, &kms.DecryptInput{
		CiphertextBlob:    wrapped,
		KeyId:             aws.String(keyRef),
		EncryptionContext: ec.Map(),
	})
	if err != nil {
		return nil, err
	}
	if out.KeyId == nil || *out.KeyId != keyRef {
		return nil, fmt.Errorf("keys: kms decrypted with an unexpected key")
	}
	if len(out.Plaintext) != 32 {
		return nil, errors.New("keys: unexpected data key length")
	}
	return out.Plaintext, nil
}
