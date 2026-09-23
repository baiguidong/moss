#!/bin/sh
set -eu
# Only the deployment container sees administrator credentials.
{ IFS= read -r service_user; IFS= read -r service_secret; } < /run/cloud-init/credentials
mc alias set moss http://silo:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc mb --ignore-existing "moss/$CLOUD_BUCKET" >/dev/null
mc anonymous set none "moss/$CLOUD_BUCKET" >/dev/null
# IAM initialization is retryable. Credentials are generated once in ServerCredentialStore.
mc admin user add moss "$service_user" "$service_secret" >/dev/null
cat > /tmp/moss-policy.json <<POLICY
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["s3:GetBucketLocation","s3:ListBucket","s3:ListBucketMultipartUploads"],"Resource":["arn:aws:s3:::$CLOUD_BUCKET"]},
 {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:AbortMultipartUpload","s3:ListMultipartUploadParts"],"Resource":["arn:aws:s3:::$CLOUD_BUCKET/data/*"]}
]}
POLICY
mc admin policy create moss moss-cloud-storage /tmp/moss-policy.json >/dev/null
mc admin policy attach moss moss-cloud-storage --user "$service_user" >/dev/null
printf 'Private Silo bucket and restricted service account initialized\n'
