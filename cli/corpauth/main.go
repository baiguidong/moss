// Command corpauth — Corp Auth (企业鉴权) CLI used by scode inside the moss
// runtime container. It fetches the current user's corp OAuth2 provider
// access_token from moss-server so an assistant can authenticate calls to
// internal corp services. Every call is authorised with SESSION_TOKEN (a
// short-lived JWT issued by moss-server when it spawned this scode session);
// moss resolves "the current user" from that token.
//
// Subcommands:
//
//	corpauth token [--json]   # the current user's corp provider access_token
//
// `token` prints the access_token (and its expiry) when one exists. When the
// user has no provider token — e.g. they logged in with username/password, or
// the token expired — it reports "no corp provider token" (and emits a null
// access_token in --json mode). The skill / scode decides what to do then
// (e.g. ask the user to re-login). Access is gated per-assistant: the
// assistant must have `enableCorpAuth: true` in its `_moss_meta.json`, else
// the server returns 403 (surfaced as a CLI error).
//
// Environment variables (set by moss-server when it spawns scode):
//
//	MOSS_SERVER_URL — base URL, e.g. http://moss-internal:43127
//	SESSION_TOKEN   — bearer token; embeds assistant_id + user_id + org_id
package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/sudoprivacy/moss/cli/corpauth/client"
)

const (
	envServerURL = "MOSS_SERVER_URL"
	envToken     = "SESSION_TOKEN"
)

const mossHelpText = `corpauth — Corp Auth (企业鉴权) CLI for use inside the scode runtime.

Usage:
  corpauth token [--json]

token returns the current user's corp OAuth2 provider access_token. If the
user has no token (e.g. password-login users, or an expired token) it reports
"no corp provider token" (null in --json mode) — the skill should decide what
to do, e.g. ask the user to re-login.

Environment:
  MOSS_SERVER_URL  base URL of moss-server (set by moss-server when it
                   spawns scode)
  SESSION_TOKEN    bearer JWT with assistant_id/user_id/org_id claims
                   (set by moss-server when it spawns scode)`

func main() {
	base := os.Getenv(envServerURL)
	if strings.TrimRight(base, "/") == "" {
		fmt.Fprintln(os.Stderr, "corpauth: "+envServerURL+" is not set; corpauth CLI must be launched by moss-server")
		os.Exit(1)
	}
	token := os.Getenv(envToken)
	if token == "" {
		fmt.Fprintln(os.Stderr, "corpauth: "+envToken+" is not set; corpauth CLI cannot authenticate")
		os.Exit(1)
	}
	c := client.New(base, token)
	os.Exit(client.Run(os.Args[1:], c, client.RunOptions{
		ProgName: "corpauth",
		HelpText: mossHelpText,
	}))
}
