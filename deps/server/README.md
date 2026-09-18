# Moss Server Docker Compose deployment

This deployment runs Moss Server and its HTTPS Nginx proxy in containers. Moss
Server uses the host Docker socket to launch isolated session-runtime containers.

## Requirements

- Linux x86_64
- Docker Engine and Docker Compose v2
- `curl`, `jq`, and `openssl`
- Port 443 available (or set `MOSS_HTTPS_PORT`)

## Start

Clone or update the private repository on the target host, then run the checked-in
deployment directly (there is no downloaded one-click installer):

```bash
cd deps/server
sudo MOSS_PUBLIC_HOST=10.0.1.181 ./start.sh
```

For images in a private registry, pass a read-only package token on every pull
unless Docker is already logged in on the host. The token is not persisted in
`.env`:

```bash
sudo env \
  MOSS_PUBLIC_HOST=10.0.1.181 \
  MOSS_REGISTRY_USERNAME='<github-user>' \
  MOSS_REGISTRY_TOKEN='<read-packages-token>' \
  ./start.sh
```

After the first login, change the default password immediately. Subsequent
starts pull the configured images and run `docker compose up`; configuration
and data remain under `MOSS_SERVER_HOME`.

If migrating from the legacy host process, stop it before the first Compose
start:

```bash
sudo systemctl disable --now moss-server.service
```

The first run creates `.env`, `/root/.moss/server/server.json`, and a self-signed
certificate under `tls/`. The initial login is `admin` / `password`; change it
after signing in.

Existing `/root/.moss/server/settings.json` values are preserved and merged with
the published session-runtime image setting.

Clients must trust `deps/server/tls/server.crt` before connecting to the HTTPS
endpoint. To use another port or image, edit `.env` or pass an environment value
to `configure.sh` before starting.

## Operations

```bash
sudo ./start.sh
sudo ./stop.sh
docker compose --env-file .env -f compose.yaml logs -f
```
