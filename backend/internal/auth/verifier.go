package auth

import (
	"context"
	"errors"

	firebase "firebase.google.com/go/v4"
	fbauth "firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"
)

// Verifier checks a Firebase ID token and returns the Firebase UID.
type Verifier interface {
	Verify(ctx context.Context, idToken string) (uid string, err error)
}

var ErrInvalidToken = errors.New("invalid firebase token")

type firebaseVerifier struct{ client *fbauth.Client }

func NewFirebaseVerifier(ctx context.Context, projectID, credsFile string) (Verifier, error) {
	app, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: projectID},
		option.WithCredentialsFile(credsFile))
	if err != nil {
		return nil, err
	}
	client, err := app.Auth(ctx)
	if err != nil {
		return nil, err
	}
	return &firebaseVerifier{client: client}, nil
}

func (v *firebaseVerifier) Verify(ctx context.Context, idToken string) (string, error) {
	tok, err := v.client.VerifyIDToken(ctx, idToken)
	if err != nil {
		return "", ErrInvalidToken
	}
	return tok.UID, nil
}
