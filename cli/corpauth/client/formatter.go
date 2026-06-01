package client

import (
	"encoding/json"
	"fmt"
	"io"
	"time"
)

// FormatToken writes the human-readable result of a token call. A nil
// AccessToken (no usable provider token) is reported so the caller can decide
// to ask the user to re-login.
func FormatToken(w io.Writer, r *TokenResp) {
	if r == nil || r.AccessToken == nil {
		fmt.Fprintln(w, "(no corp provider token; user may need to re-login)")
		return
	}
	fmt.Fprintf(w, "access_token: %s\n", *r.AccessToken)
	if r.ExpiresAt > 0 {
		fmt.Fprintf(w, "expires_at:   %d (%s)\n",
			r.ExpiresAt, time.Unix(r.ExpiresAt, 0).Format(time.RFC3339))
	}
}

// FormatTokenJSON writes the token response as JSON (access_token is null when
// absent).
func FormatTokenJSON(w io.Writer, r *TokenResp) error {
	b, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	fmt.Fprintln(w, string(b))
	return nil
}
