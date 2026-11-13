#!/bin/sh

set -eu

mysql_host="${MYSQL_HOST:-mysql}"
mysql_root_password="${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}"
moss_database="${MOSS_DB_NAME:-moss}"
new_api_database="${NEW_API_DB_NAME:-new-api}"

query="
-- Moss owns credit grants. Keep all New API sign-up/invite bonuses disabled.
INSERT INTO \`${new_api_database}\`.options (\`key\`, \`value\`) VALUES
  ('QuotaForNewUser', '0'), ('QuotaForInvitee', '0'), ('QuotaForInviter', '0')
ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`);

-- Remove stale duplicate OIDC bindings when the canonical Moss account exists.
UPDATE \`${new_api_database}\`.users AS duplicate_user
JOIN \`${new_api_database}\`.users AS canonical_user
  ON canonical_user.oidc_id <> ''
 AND duplicate_user.oidc_id = canonical_user.oidc_id
 AND duplicate_user.id <> canonical_user.id
 AND canonical_user.username LIKE 'moss_%'
SET duplicate_user.oidc_id = '';

-- Moss owns identity. The deterministic New API username is the join key.
UPDATE \`${new_api_database}\`.users AS new_api_user
JOIN \`${moss_database}\`.users AS moss_user
  ON new_api_user.username = CONCAT(
    'moss_', LEFT(SHA2(CONCAT(moss_user.org_id, ':', moss_user.id), 256), 14)
  )
SET new_api_user.oidc_id = CONCAT(moss_user.org_id, ':', moss_user.id)
WHERE new_api_user.oidc_id <> CONCAT(moss_user.org_id, ':', moss_user.id)
   OR new_api_user.oidc_id IS NULL;

-- Moss also owns availability. Mirror active/disabled state for canonical
-- accounts while leaving the New API root administrator untouched.
UPDATE \`${new_api_database}\`.users AS new_api_user
JOIN \`${moss_database}\`.users AS moss_user
  ON new_api_user.username = CONCAT(
    'moss_', LEFT(SHA2(CONCAT(moss_user.org_id, ':', moss_user.id), 256), 14)
  )
SET new_api_user.status = CASE WHEN moss_user.status = 'active' THEN 1 ELSE 2 END;

-- An OIDC account without a Moss identity is an orphan from an interrupted
-- login. Disable it so it cannot receive a sign-up balance or bypass Moss.
UPDATE \`${new_api_database}\`.users
SET status = 2, quota = 0
WHERE username LIKE 'oidc_%' AND (oidc_id = '' OR oidc_id IS NULL);
"

while :; do
  mysql --protocol=TCP \
    --host="$mysql_host" \
    --user=root \
    --password="$mysql_root_password" \
    --database="$new_api_database" \
    --batch --skip-column-names \
    --execute="$query" >/dev/null 2>&1 || true
  sleep "${SYNC_INTERVAL_SECONDS:-30}"
done
