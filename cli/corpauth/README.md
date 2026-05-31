# corpauth — Corp Auth (企业鉴权) CLI

A small, zero-dependency Go binary that scode runs inside the moss runtime
container to obtain the **current user's corp OAuth2 provider access_token**,
so an assistant can authenticate calls to internal corp services.

It is the corp-auth analogue of the `corpapp` / `wiki` CLIs: it authenticates
with the `SESSION_TOKEN` JWT that moss-server issues for the scode session and
calls the agent-facing API at `/api/v1/agent/corp-auth/*`. moss resolves "the
current user" server-side from the token (its `user_id` claim) and returns that
user's stored provider access_token.

## Usage

```
corpauth token [--json]   # the current user's corp provider access_token
```

`token` prints the `access_token` and its `expires_at` when the user has a
usable token. When they don't — they logged in with username/password (no
provider token), or the token has expired — it prints
`(no corp provider token; user may need to re-login)` and, in `--json` mode,
returns `{"access_token": null}`. The skill / scode decides what to do then
(e.g. ask the user to re-login).

```
# typical skill flow
corpauth token --json
# -> {"access_token":"<token>","expires_at":1735689600}
#    or {"access_token":null}
```

## Authorization

Access is gated per-assistant. The assistant must have `enableCorpAuth: true`
in its `_moss_meta.json`; otherwise the server returns HTTP 403 (surfaced as a
CLI error). Reading a user's live corp credential is more sensitive than
listing corp-apps, so it is opt-in per assistant.

## Environment (set by moss-server when it spawns scode)

- `MOSS_SERVER_URL` — base URL of moss-server
- `SESSION_TOKEN` — bearer JWT carrying `assistant_id` / `user_id` / `org_id`

## Build

```
cd cli/corpauth
go build -o corpauth .
```

The runtime image builds and installs it to `/usr/local/bin/corpauth`
(see `deploy/runtime/Dockerfile`).
