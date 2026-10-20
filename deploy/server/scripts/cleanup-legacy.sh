#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

project="$(env_value COMPOSE_PROJECT_NAME)"
backup_file="$(env_value MOSS_SERVER_HOME)/legacy-webui-backups.tsv"

legacy_containers() {
  docker ps -aq \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=$1"
}

# Keep the old container filesystem as a local image and its HOME volume intact.
# The new per-user cloud portal starts with separate environments.
while IFS= read -r id; do
  [[ -n "$id" ]] || continue
  backup_image="moss-legacy-webui:${id:0:12}"
  home_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/moss"}}{{.Name}}{{end}}{{end}}' "$id")"
  log "Saving legacy WebUI container $id as $backup_image"
  docker commit "$id" "$backup_image" >/dev/null
  printf '%s\t%s\t%s\n' "$id" "$backup_image" "$home_volume" >> "$backup_file"
  docker stop --time 60 "$id" >/dev/null
  docker rm "$id" >/dev/null
done < <(legacy_containers webui)

for service in webui-proxy web-cloud-proxy; do
  while IFS= read -r id; do
    [[ -n "$id" ]] || continue
    log "Removing obsolete $service container $id"
    docker stop --time 60 "$id" >/dev/null || true
    docker rm "$id" >/dev/null
  done < <(legacy_containers "$service")
done

if [[ -f "$backup_file" ]]; then
  chmod 0600 "$backup_file"
  log "Legacy WebUI images and HOME volume names are recorded in $backup_file"
fi
