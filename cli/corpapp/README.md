# corpapp — Corp App (企业应用) CLI

A small, zero-dependency Go binary that scode runs inside the moss
runtime container to talk to enterprise apps (e.g. 企微自建应用 / WeCom
self-built apps) registered under **企业应用管理 (Corp App Management)**.

It is the corp-app analogue of the `wiki` CLI: it authenticates with the
`SESSION_TOKEN` JWT that moss-server issues for the scode session and
calls the agent-facing API at `/api/v1/agent/corp-apps/*`. The assistant
can only use the corp-app instances granted to it via `enabledCorpApps`
in its `_moss_meta.json` (enforced server-side on every call).

## Usage

```
corpapp list [--json]                                       # apps this assistant can use
corpapp get --name <name> [--json]                          # resolve an app by name
corpapp get --key <corpId:agentId> [--type wecomapp] [--json]
corpapp send --app <name> --to <userid> --text <msg>        # send a text message
corpapp send-file --app <name> --to <userid> --file <path>  # upload + send a file
corpapp receive --app <name> [--since <cursor>] [--limit <n>] [--json]   # poll inbound
corpapp download --app <name> --media-id <id> [--out <path>]             # fetch media bytes
```

`receive` returns a `nextCursor`; pass it back as `--since` on the next
poll to read only newer messages. Inbound file/image messages carry a
`mediaId` and `fileName` (not the bytes); fetch the bytes with
`download`:

```
# typical receive → download flow
corpapp receive  --app SeanClaw --since 0 --json
corpapp download --app SeanClaw --media-id <mediaId from above> --out /tmp/
```

For `download`, `--out` may be a file path, or a directory (the
server-provided filename is used inside it); if omitted, the file is
written to the current directory under that filename.

Capabilities are per-type and reported by the server (`list`/`get` show
them). Calling a capability a type does not support returns a clear
error (HTTP 501 surfaced as a CLI error).

## Environment (set by moss-server when it spawns scode)

- `MOSS_SERVER_URL` — base URL of moss-server
- `SESSION_TOKEN` — bearer JWT carrying `assistant_id` / `user_id` / `org_id`

## Build

```
cd cli/corpapp
go build -o corpapp .
```

The runtime image builds and installs it to `/usr/local/bin/corpapp`
(see `deploy/runtime/Dockerfile`).
