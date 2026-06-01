// Package client is a Go client + CLI entry point for the moss-server
// agent-facing corp-auth API. It speaks the JSON contract the
// /api/v1/agent/corp-auth/* endpoints expose and knows nothing about moss
// internals: no env-var lookups, no os.Exit, no moss-specific help text (that
// lives in main.go).
package client

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// DefaultPathPrefix is where moss-server mounts the agent-facing corp-auth
// endpoints.
const DefaultPathPrefix = "/api/v1/agent/corp-auth"

// Client is an HTTP client for the corp-auth API. Fields are exported so
// callers can swap the HTTP client (tests) or override the path prefix.
type Client struct {
	BaseURL    string
	Token      string
	PathPrefix string
	HTTP       *http.Client
}

// New returns a Client that sends Authorization: Bearer <token> on every
// request, with a trailing-slash-trimmed BaseURL and a 30s timeout.
func New(baseURL, token string) *Client {
	return &Client{
		BaseURL:    strings.TrimRight(baseURL, "/"),
		Token:      token,
		PathPrefix: DefaultPathPrefix,
		HTTP:       &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *Client) setAuth(req *http.Request) {
	req.Header.Set("Accept", "application/json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
}

func (c *Client) get(path string, out any) error {
	req, err := http.NewRequest(http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return err
	}
	c.setAuth(req)
	return c.do(req, out)
}

func (c *Client) do(req *http.Request, out any) error {
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

// ============================================================
// Response types — mirror server JSON
// ============================================================

// TokenResp is the response from GET /api/v1/agent/corp-auth/token. A nil
// AccessToken means the user has no usable provider token (none stored, or
// expired); ExpiresAt is the token's absolute Unix-seconds expiry when present.
type TokenResp struct {
	AccessToken *string `json:"access_token"`
	ExpiresAt   int64   `json:"expires_at"`
}

// ============================================================
// Request methods
// ============================================================

// GetToken fetches the current user's corp provider access_token. A successful
// call with no token returns a TokenResp whose AccessToken is nil.
func (c *Client) GetToken() (*TokenResp, error) {
	var resp TokenResp
	if err := c.get(c.PathPrefix+"/token", &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}
