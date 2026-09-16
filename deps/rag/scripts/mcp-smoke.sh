#!/usr/bin/env bash
set -Eeuo pipefail

MCP_URL="${1:-${RAGFLOW_MCP_URL:-}}"
QUESTION="${2:-}"
API_KEY="${MCP_API_KEY:-${RAGFLOW_API_KEY:-}}"
EXPECTED_SERVER_NAME="${EXPECTED_MCP_SERVER_NAME:-ragflow-mcp-extended}"

[[ -n "$MCP_URL" ]] || { echo "Usage: mcp-smoke.sh http://server:9385/mcp [question]" >&2; exit 2; }

command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

if [[ -z "$API_KEY" ]]; then
  read -r -s -p "MCP Bearer key: " API_KEY
  printf '\n'
fi
[[ -n "$API_KEY" && "$API_KEY" != *$'\n'* && "$API_KEY" != *$'\r'* ]] \
  || { echo "invalid MCP Bearer key" >&2; exit 2; }

rpc() {
  curl --fail-with-body --silent --show-error --max-time 60 \
    --request POST "$MCP_URL" \
    --header "Authorization: Bearer $API_KEY" \
    --header 'Content-Type: application/json' \
    --header 'Accept: application/json, text/event-stream' \
    --data "$1"
}

unauthenticated_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$MCP_URL" || true)"
[[ "$unauthenticated_code" == "401" ]] || { echo "expected unauthenticated HTTP 401, got $unauthenticated_code" >&2; exit 1; }

initialize='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"ragflow-standalone-smoke","version":"1.0"}}}'
initialize_result="$(rpc "$initialize")"
printf '%s\n' "$initialize_result" | jq -e --arg expected "$EXPECTED_SERVER_NAME" \
  '.result.serverInfo.name == $expected' >/dev/null
printf 'initialize=ok server=%s protocol=%s\n' \
  "$(printf '%s\n' "$initialize_result" | jq -r '.result.serverInfo.name')" \
  "$(printf '%s\n' "$initialize_result" | jq -r '.result.protocolVersion')"

tools_result="$(rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')"
printf '%s\n' "$tools_result" | jq -e '[.result.tools[].name] | index("ragflow_retrieval") != null and index("ragflow_list_datasets") != null' >/dev/null
printf 'tools=%s\n' "$(printf '%s\n' "$tools_result" | jq -r '[.result.tools[].name] | join(",")')"

datasets_result="$(rpc '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ragflow_list_datasets","arguments":{"page":1,"page_size":100}}}')"
printf '%s\n' "$datasets_result" | jq -e '.result.isError != true' >/dev/null
datasets_payload="$(printf '%s\n' "$datasets_result" | jq -r '.result.content[0].text // ""')"
printf 'datasets_count=%s names=%s\n' \
  "$(printf '%s\n' "$datasets_payload" | jq -sr 'if length == 1 and (.[0].data | type) == "array" then .[0].data else . end | length')" \
  "$(printf '%s\n' "$datasets_payload" | jq -sr 'if length == 1 and (.[0].data | type) == "array" then .[0].data else . end | map(.name) | join(",")')"

if printf '%s\n' "$tools_result" | jq -e '[.result.tools[].name] | index("ragflow_list_agents") != null' >/dev/null; then
  chats_result="$(rpc '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"ragflow_list_chats","arguments":{"page":1,"page_size":10}}}')"
  agents_result="$(rpc '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"ragflow_list_agents","arguments":{"page":1,"page_size":10}}}')"
  chats_payload="$(printf '%s\n' "$chats_result" | jq -r '.result.content[0].text // empty')"
  agents_payload="$(printf '%s\n' "$agents_result" | jq -r '.result.content[0].text // empty')"
  printf 'chats=%s agents=%s\n' \
    "$(printf '%s\n' "$chats_payload" | jq -r '(.data.chats // .data // []) | length')" \
    "$(printf '%s\n' "$agents_payload" | jq -r '(.data.canvas // .data // []) | length')"
fi

if [[ -n "$QUESTION" ]]; then
  request="$(jq -nc --arg question "$QUESTION" '{jsonrpc:"2.0",id:4,method:"tools/call",params:{name:"ragflow_retrieval",arguments:{question:$question,page:1,page_size:5,similarity_threshold:0.1,keyword:true}}}')"
  retrieval_result="$(rpc "$request")"
  printf '%s\n' "$retrieval_result" | jq -e '.result.isError != true' >/dev/null
  retrieval_payload="$(printf '%s\n' "$retrieval_result" | jq -r '.result.content[0].text // empty')"
  printf 'retrieval_chunks=%s total_chunks=%s documents=%s\n' \
    "$(printf '%s\n' "$retrieval_payload" | jq -r '(.data.chunks // .chunks // []) | length')" \
    "$(printf '%s\n' "$retrieval_payload" | jq -r '.data.total // .pagination.total_chunks // 0')" \
    "$(printf '%s\n' "$retrieval_payload" | jq -r '(.data.chunks // .chunks // []) | map(.document_name // .document_keyword // .document // "") | map(select(length > 0)) | unique | join(",")')"
fi

unset API_KEY
