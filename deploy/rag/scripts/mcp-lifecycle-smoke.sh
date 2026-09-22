#!/usr/bin/env bash
set -Eeuo pipefail

MCP_URL="${1:-${RAGFLOW_MCP_URL:-}}"
API_KEY="${RAGFLOW_API_KEY:-}"
API_URL="${RAGFLOW_API_URL:-${MCP_URL%:9385/mcp}/api/v1}"
dataset_id=""

[[ -n "$MCP_URL" ]] || { echo "Usage: mcp-lifecycle-smoke.sh http://server:9385/mcp" >&2; exit 2; }

command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
if [[ -z "$API_KEY" ]]; then
  read -r -s -p "RAGFlow API key: " API_KEY
  printf '\n'
fi
[[ "$API_KEY" =~ ^ragflow-[A-Za-z0-9_-]+$ ]] || { echo "invalid RAGFlow API key" >&2; exit 2; }

rpc() {
  curl --fail-with-body --silent --show-error --max-time 120 \
    --request POST "$MCP_URL" \
    --header "Authorization: Bearer $API_KEY" \
    --header 'Content-Type: application/json' \
    --header 'Accept: application/json, text/event-stream' \
    --data "$1"
}

call_tool() {
  local name="$1" arguments="$2" request response
  request="$(jq -nc --arg name "$name" --argjson arguments "$arguments" \
    '{jsonrpc:"2.0",id:2,method:"tools/call",params:{name:$name,arguments:$arguments}}')"
  response="$(rpc "$request")"
  if [[ "$(printf '%s\n' "$response" | jq -r '.result.isError // false')" == "true" ]]; then
    printf '%s\n' "$response" | jq -r '.result.content[].text' >&2
    return 1
  fi
  printf '%s\n' "$response" | jq -r '.result.content[0].text'
}

cleanup() {
  status=$?
  if [[ -n "$dataset_id" ]]; then
    curl --silent --max-time 60 --request DELETE "$API_URL/datasets" \
      --header "Authorization: Bearer $API_KEY" \
      --header 'Content-Type: application/json' \
      --data "$(jq -nc --arg id "$dataset_id" '{ids:[$id]}')" >/dev/null || true
  fi
  unset API_KEY
  return "$status"
}
trap cleanup EXIT

initialize='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"ragflow-extended-lifecycle-smoke","version":"1.0"}}}'
rpc "$initialize" | jq -e '.result.serverInfo.name == "ragflow-mcp-extended"' >/dev/null

suffix="$(date +%Y%m%d%H%M%S)-$$"
dataset_name="extended-mcp-smoke-$suffix"
create_payload="$(call_tool ragflow_create_dataset "$(jq -nc --arg name "$dataset_name" '{name:$name,description:"Temporary Extended MCP integration test"}')")"
dataset_id="$(printf '%s\n' "$create_payload" | jq -r '.data.id // empty')"
[[ -n "$dataset_id" ]] || { echo "dataset creation did not return an ID" >&2; exit 1; }
printf 'dataset_create=ok id=%s\n' "$dataset_id"

marker="RAGFLOW-EXTENDED-$suffix"
document_text="扩展 MCP 生命周期测试。验证码是 ${marker}。这个文档用于验证上传、解析和检索。"
encoded="$(printf '%s' "$document_text" | base64 | tr -d '\n')"
upload_args="$(jq -nc --arg dataset_id "$dataset_id" --arg content "$encoded" \
  '{dataset_id:$dataset_id,filename:"extended-base64.txt",content_base64:$content,content_type:"text/plain",auto_parse:true}')"
upload_payload="$(call_tool ragflow_upload_document_base64 "$upload_args")"
document_id="$(printf '%s\n' "$upload_payload" | jq -r '.upload.data[0].id // .upload.data.id // empty')"
[[ -n "$document_id" ]] || { echo "Base64 upload did not return a document ID" >&2; exit 1; }
printf 'base64_upload=ok document_id=%s\n' "$document_id"

ticket_args="$(jq -nc --arg dataset_id "$dataset_id" \
  '{dataset_id:$dataset_id,filename:"extended-multipart.txt",auto_parse:false,ttl_seconds:600}')"
ticket_payload="$(call_tool ragflow_create_upload_ticket "$ticket_args")"
upload_url="$(printf '%s\n' "$ticket_payload" | jq -r '.upload_url // empty')"
[[ -n "$upload_url" ]] || { echo "upload ticket did not return a URL" >&2; exit 1; }
multipart_result="$(curl --fail-with-body --silent --show-error --max-time 120 \
  --request POST "$upload_url" \
  --header "Authorization: Bearer $API_KEY" \
  --form 'file=@-;filename=extended-multipart.txt;type=text/plain' <<< 'multipart upload verification')"
multipart_id="$(printf '%s\n' "$multipart_result" | jq -r '.upload.data[0].id // .upload.data.id // empty')"
[[ -n "$multipart_id" ]] || { echo "multipart upload did not return a document ID" >&2; exit 1; }
printf 'multipart_upload=ok document_id=%s\n' "$multipart_id"

parsed=0
for attempt in $(seq 1 120); do
  document_args="$(jq -nc --arg dataset_id "$dataset_id" --arg document_id "$document_id" \
    '{dataset_id:$dataset_id,document_id:$document_id}')"
  document_payload="$(call_tool ragflow_get_document "$document_args")"
  progress="$(printf '%s\n' "$document_payload" | jq -r '.data.progress // 0')"
  chunks="$(printf '%s\n' "$document_payload" | jq -r '.data.chunk_count // 0')"
  run="$(printf '%s\n' "$document_payload" | jq -r '.data.run // "UNKNOWN"')"
  if [[ "$run" == "FAIL" ]]; then
    printf 'parse failed: %s\n' "$(printf '%s\n' "$document_payload" | jq -c '.data')" >&2
    exit 1
  fi
  if awk "BEGIN {exit !($progress >= 1 && $chunks > 0)}"; then
    parsed=1
    break
  fi
  ((attempt % 6 != 0)) || printf 'parse_wait run=%s progress=%s chunks=%s\n' "$run" "$progress" "$chunks"
  sleep 5
done
[[ "$parsed" == "1" ]] || { echo "document parsing timed out" >&2; exit 1; }
printf 'parse=ok chunks=%s\n' "$chunks"

retrieval_args="$(jq -nc --arg dataset_id "$dataset_id" --arg question "扩展 MCP 验证码是什么？" \
  '{dataset_ids:[$dataset_id],question:$question,page:1,page_size:5,similarity_threshold:0,keyword:true}')"
retrieval_payload="$(call_tool ragflow_retrieval "$retrieval_args")"
retrieval_count="$(printf '%s\n' "$retrieval_payload" | jq -r '.data.chunks | length')"
printf '%s\n' "$retrieval_payload" | jq -e --arg marker "$marker" \
  '.data.chunks | length > 0 and any(.[]; (.content // .content_with_weight // "") | contains($marker))' >/dev/null
printf 'retrieval=ok chunks=%s marker=%s\n' "$retrieval_count" "$marker"

delete_args="$(jq -nc --arg dataset_id "$dataset_id" --arg first "$document_id" --arg second "$multipart_id" \
  '{dataset_id:$dataset_id,document_ids:[$first,$second],confirm:true}')"
call_tool ragflow_delete_documents "$delete_args" >/dev/null
printf 'document_delete=ok count=2\n'

cleanup
dataset_id=""
trap - EXIT
echo 'lifecycle=ok'
