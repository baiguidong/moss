# Moss Server deployment

Moss Server is released with the desktop application under the same `v*`
GitHub Release. The server release currently supports Linux x86_64 and includes
Node.js 22, the server and session runner bundles, the admin frontend, and a
versioned Docker session runtime image. The target host must provide systemd and
Docker 20.10 or newer.

Server sessions run through the embedded runtime in
`moss-session-runner.mjs`; the Server package does not require `cli-node.js`.

## One-command install

```bash
curl -fsSL https://github.com/baiguidong/moss/releases/latest/download/install-server.sh | sudo bash
```

The default installation uses the invoking user's `~/.moss/server`, the
`moss-server.service` systemd unit, and port `43127`. The installer prompts for
the public address and initial administrator credentials.

For unattended installation:

```bash
curl -fsSL https://github.com/baiguidong/moss/releases/latest/download/install-server.sh \
  | sudo env MOSS_NON_INTERACTIVE=1 \
      MOSS_PORT=43127 \
      MOSS_ADMIN_USERNAME=admin \
      MOSS_ADMIN_PASSWORD='replace-me' \
      bash
```

## Isolated installation

Use separate values for all three settings when running another instance on the
same host:

```bash
sudo env \
  MOSS_INSTALL_DIR=/opt/moss-server-test \
  MOSS_SERVICE_NAME=moss-server-test \
  MOSS_PORT=43227 \
  MOSS_ADMIN_PASSWORD='replace-me' \
  MOSS_NON_INTERACTIVE=1 \
  ./install-server.sh --offline
```

## Upgrade and uninstall

```bash
sudo ~/.moss/server/install-server.sh --upgrade
sudo ~/.moss/server/uninstall-server.sh
sudo ~/.moss/server/uninstall-server.sh --purge
VERSION=2.1.88
docker image rm "moss-runtime:$VERSION-amd64"
```

An upgrade installs into `releases/<tag>`, switches the `current` symlink, and
keeps `server.json`, `settings.json`, the database, workspaces, and logs in the
installation root. A failed startup or health check switches `current` back to
the previous release. Uninstall does not remove the Docker image because another
Moss Server instance on the same host may still reference it.

## Offline install

Place these four assets from one GitHub Release in the same directory:

- `install-server.sh`
- `moss-server-<version>-linux-amd64.tar.gz`
- `moss-runtime-<version>-linux-amd64.tar.gz`
- `SHA256SUMS-server`

Then run:

```bash
sudo ./install-server.sh --offline
```

## Service operations

```bash
sudo systemctl status moss-server
sudo systemctl restart moss-server
sudo journalctl -u moss-server -f
curl http://127.0.0.1:43127/healthz
```

## Build a server release locally

The build host needs Bun, Node/npm, curl, and tar:

```bash
deploy/package-server.sh 0.0.4 amd64 dist/server
```

The packaging script verifies the official Node.js checksum and emits the
server archive. The release job also builds `moss-runtime:<version>-amd64`, saves
it as a compressed Docker image, and puts both archives in
`SHA256SUMS-server`. CI stamps the release tag and repository into
`install-server.sh` before uploading all server assets to the same release used
by the desktop application.
