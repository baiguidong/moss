#!/usr/bin/env bash
set -Eeuo pipefail

MCP_URL="${1:-${RAGFLOW_MCP_URL:-}}"
API_KEY="${RAGFLOW_API_KEY:-}"
API_URL="${RAGFLOW_API_URL:-${MCP_URL%:9385/mcp}/api/v1}"
chat_id=""
chat_session_id=""
agent_id=""
agent_session_id=""

[[ -n "$MCP_URL" ]] || { echo "Usage: mcp-agent-smoke.sh http://server:9385/mcp" >&2; exit 2; }

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
  if [[ -n "$chat_id" && -n "$chat_session_id" ]]; then
    curl --silent --max-time 30 --request DELETE "$API_URL/chats/$chat_id/sessions" \
      --header "Authorization: Bearer $API_KEY" \
      --header 'Content-Type: application/json' \
      --data "$(jq -nc --arg id "$chat_session_id" '{ids:[$id]}')" >/dev/null || true
  fi
  if [[ -n "$agent_id" && -n "$agent_session_id" ]]; then
    curl --silent --max-time 30 --request DELETE "$API_URL/agents/$agent_id/sessions" \
      --header "Authorization: Bearer $API_KEY" \
      --header 'Content-Type: application/json' \
      --data "$(jq -nc --arg id "$agent_session_id" '{ids:[$id]}')" >/dev/null || true
  fi
  unset API_KEY
  return "$status"
}
trap cleanup EXIT

initialize='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"ragflow-extended-agent-smoke","version":"1.0"}}}'
rpc "$initialize" | jq -e '.result.serverInfo.name == "ragflow-mcp-extended"' >/dev/null

chats_payload="$(call_tool ragflow_list_chats '{"page":1,"page_size":10}')"
chat_id="$(printf '%s\n' "$chats_payload" | jq -r '.data.chats[0].id // empty')"
if [[ -n "$chat_id" ]]; then
  session_payload="$(call_tool ragflow_create_chat_session \
    "$(jq -nc --arg chat_id "$chat_id" '{chat_id:$chat_id,name:"Extended MCP smoke session"}')")"
  chat_session_id="$(printf '%s\n' "$session_payload" | jq -r '.data.id // empty')"
  [[ -n "$chat_session_id" ]] || { echo "chat session creation did not return an ID" >&2; exit 1; }
  call_tool ragflow_list_chat_sessions "$(jq -nc --arg chat_id "$chat_id" '{chat_id:$chat_id,page:1,page_size:10}')" \
    | jq -e --arg id "$chat_session_id" '.data | any(.[]; .id == $id)' >/dev/null
  call_tool ragflow_delete_chat_sessions \
    "$(jq -nc --arg chat_id "$chat_id" --arg id "$chat_session_id" '{chat_id:$chat_id,session_ids:[$id],confirm:true}')" >/dev/null
  chat_session_id=""
  printf 'chat_session_lifecycle=ok chat_id=%s\n' "$chat_id"
else
  echo 'chat_session_lifecycle=skipped reason=no-chat'
fi

agents_payload="$(call_tool ragflow_list_agents '{"page":1,"page_size":10}')"
agent_id="$(printf '%s\n' "$agents_payload" | jq -r '.data.canvas | map(select(.canvas_category == "agent_canvas" or .canvas_category == "workflow")) | .[0].id // empty')"
if [[ -n "$agent_id" ]]; then
  session_payload="$(call_tool ragflow_create_agent_session \
    "$(jq -nc --arg agent_id "$agent_id" '{agent_id:$agent_id,name:"Extended MCP smoke session",release:false}')")"
  agent_session_id="$(printf '%s\n' "$session_payload" | jq -r '.data.id // empty')"
  [[ -n "$agent_session_id" ]] || { echo "agent session creation did not return an ID" >&2; exit 1; }
  call_tool ragflow_list_agent_sessions "$(jq -nc --arg agent_id "$agent_id" '{agent_id:$agent_id,page:1,page_size:10}')" \
    | jq -e --arg id "$agent_session_id" '(if (.data | type) == "object" then .data.sessions else .data end) | any(.[]; .id == $id)' >/dev/null
  call_tool ragflow_delete_agent_sessions \
    "$(jq -nc --arg agent_id "$agent_id" --arg id "$agent_session_id" '{agent_id:$agent_id,session_ids:[$id],confirm:true}')" >/dev/null
  agent_session_id=""
  printf 'agent_session_lifecycle=ok agent_id=%s\n' "$agent_id"
else
  echo 'agent_session_lifecycle=skipped reason=no-agent'
fi

trap - EXIT
unset API_KEY
echo 'agent_scope=ok'
