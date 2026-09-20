# Moss Server Docker Compose deployment

This deployment runs Moss Server and its HTTPS Nginx proxy in containers. Moss
Server uses the host Docker socket to launch isolated session-runtime containers.
The deployment also creates the external `moss-integrations` network so managed
dependencies can use stable container DNS names instead of host IP addresses.

## Requirements

- Linux x86_64
- Docker Engine and Docker Compose v2
- `curl`, `jq`, and `openssl`
- Port 443 available (or set `MOSS_HTTPS_PORT`)

## Package and install

Build a deployment package from the repository:

```bash
cd deps/server
./package.sh
```

Upload and install it on the target host:

```bash
scp dist/moss-server-compose-*.tar.gz* root@server:/tmp/
ssh root@server
cd /tmp
sha256sum -c moss-server-compose-*.tar.gz.sha256
tar -xzf moss-server-compose-*.tar.gz
cd moss-server
MOSS_PUBLIC_HOST=10.0.1.181 ./install.sh
```

The installer copies the deployment into `/data/moss-server`, preserves an
existing `.env`, configuration, TLS keys, and runtime data, then starts the
stack. Running `install.sh` from a newer package updates the deployment files
without deleting persistent files. When migrating a checkout that already has
`.env` or `tls/`, the installer carries them into the target if no target copy
exists.

From a repository checkout, use the same installer directly:

```bash
cd deps/server
sudo MOSS_PUBLIC_HOST=10.0.1.181 ./install.sh
```

For images in a private registry, pass a read-only package token on every pull
unless Docker is already logged in on the host. The token is not persisted in
`.env`:

```bash
sudo env \
  MOSS_PUBLIC_HOST=10.0.1.181 \
  MOSS_REGISTRY_USERNAME='<github-user>' \
  MOSS_REGISTRY_TOKEN='<read-packages-token>' \
  ./install.sh
```

After the first login, change the default password immediately. Subsequent
starts pull the configured images and run `docker compose up`; configuration
and data remain under `MOSS_SERVER_HOME`.

If migrating from the legacy host process, stop it before the first Compose
start:

```bash
sudo systemctl disable --now moss-server.service
```

The first run creates `.env`, `/data/moss-server/server.json`, and a self-signed
certificate under `tls/`. The initial login is `admin` / `password`; change it
after signing in.

Existing `/data/moss-server/settings.json` values are preserved and merged with
the published session-runtime image setting.

## Image versions and upgrades

For an installed Compose deployment, `/data/moss-server/.env` is the only manually maintained
source for Moss image versions:

```text
MOSS_SERVER_IMAGE=ghcr.io/baiguidong/moss-server:latest
MOSS_RUNTIME_IMAGE=ghcr.io/baiguidong/moss-runtime:latest
```

Both images are published with the same release tag. Use one of these commands
to update both entries in `.env`, pull them, and apply the upgrade:

```bash
sudo /data/moss-server/upgrade.sh latest
sudo /data/moss-server/upgrade.sh 1.2.3
```

Running `upgrade.sh` without an argument keeps the configured references and
pulls them again, which is useful when both already use `latest`.

The start script pulls both images, recreates the Server container when its image
changes, and copies `MOSS_RUNTIME_IMAGE` into
`/data/moss-server/settings.json` for newly created session containers. Do not
edit `serverRuntime.dockerImage` by hand; it is derived from `.env` on every
start. Existing running session containers retain the image with which they were
created.

Clients must trust `/data/moss-server/tls/server.crt` before connecting to the HTTPS
endpoint. To use another port or image, edit `.env` or pass an environment value
to `configure.sh` before starting.

## Storage and Agent runtime

`/data/moss-server` is bind-mounted into the Server container at the same
absolute path. It contains `server.json`, `settings.json`, the SQLite database,
logs, session workspaces, user profiles, transcripts, and the image-owned
`container-app` payload. The Docker socket is mounted separately at
`/var/run/docker.sock`.

The runtime image is not mounted as a volume. For each new Agent session, Server
reads `serverRuntime.dockerImage`, invokes `docker run` through the host socket,
and bind-mounts only that session's workspace, profile, transcript, manifest,
and the read-only session runner from `container-app`. Existing sessions keep
their originally recorded runtime image.

Docker image layers and Docker-managed named volumes are stored under the Docker
daemon's data root, not under `/data/moss-server`. The bundled
`deps/docker/install.sh` uses `/data/docker` by default; Docker installed by
other means commonly uses `/var/lib/docker`. Changing the Moss application
directory alone does not move Docker-managed data.

## Operations

```bash
sudo /data/moss-server/start.sh
sudo /data/moss-server/stop.sh
sudo /data/moss-server/upgrade.sh
cd /data/moss-server && docker compose --env-file .env -f compose.yaml logs -f
```
