import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import logging
import mimetypes
import os
import secrets
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

import httpx
import uvicorn
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route
from starlette.types import ASGIApp, Receive, Scope, Send

from mcp import types

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)

RAGFLOW_BASE_URL = os.getenv("RAGFLOW_BASE_URL", "http://ragflow:9380").rstrip("/")
HOST = os.getenv("EXTENDED_MCP_HOST", "0.0.0.0")
PORT = int(os.getenv("EXTENDED_MCP_PORT", "9385"))
PUBLIC_URL = os.getenv("EXTENDED_MCP_PUBLIC_URL", f"http://127.0.0.1:{PORT}").rstrip("/")
MAX_BASE64_BYTES = int(os.getenv("EXTENDED_MCP_MAX_BASE64_MB", "8")) * 1024 * 1024
MAX_UPLOAD_BYTES = int(os.getenv("EXTENDED_MCP_MAX_UPLOAD_MB", "200")) * 1024 * 1024
REQUEST_TIMEOUT = float(os.getenv("EXTENDED_MCP_REQUEST_TIMEOUT", "600"))
AUTH_TOKEN_STATE_KEY = "ragflow_auth_token"
AUTH_SCOPES_STATE_KEY = "ragflow_auth_scopes"
ALLOWED_SCOPES = {"read", "write", "agent", "admin"}
SCOPES = {value.strip().lower() for value in os.getenv("EXTENDED_MCP_SCOPES", "read,write,agent").split(",") if value.strip().lower() in ALLOWED_SCOPES}
SCOPES.add("read")
AUTH_MODE = os.getenv("MCP_AUTH_MODE", "direct").strip().lower()
if AUTH_MODE not in {"direct", "moss"}:
    raise RuntimeError("MCP_AUTH_MODE must be direct or moss")
SERVICE_NAME = os.getenv(
    "MCP_SERVICE_NAME",
    "moss-rag-mcp" if AUTH_MODE == "moss" else "ragflow-mcp-extended",
).strip()
MOSS_SERVER_URL = os.getenv("MOSS_SERVER_URL", "").rstrip("/")
MOSS_RAG_GATEWAY_TOKEN = os.getenv("MOSS_RAGFLOW_GATEWAY_TOKEN", "").strip()
MOSS_RAG_RESOLVE_PATH = os.getenv(
    "MOSS_RAG_RESOLVE_PATH",
    "/api/v1/integrations/ragflow/resolve",
)


class RAGFlowAPIError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 502, code: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


class RAGFlowClient:
    def __init__(self, base_url: str, transport: httpx.AsyncBaseTransport | None = None):
        self.api_url = f"{base_url.rstrip('/')}/api/v1"
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(REQUEST_TIMEOUT),
            follow_redirects=False,
            transport=transport,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def request(
        self,
        method: str,
        path: str,
        api_key: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        files: Any = None,
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            response = await self._client.request(
                method,
                f"{self.api_url}{path}",
                params=params,
                json=json_body,
                files=files,
                data=data,
                headers={"Authorization": f"Bearer {api_key}"},
            )
        except httpx.HTTPError as exc:
            raise RAGFlowAPIError(f"RAGFlow request failed: {exc}") from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise RAGFlowAPIError(
                f"RAGFlow returned HTTP {response.status_code} with a non-JSON response",
                status_code=response.status_code,
            ) from exc

        if response.status_code >= 400 or payload.get("code") != 0:
            message = payload.get("message") or f"RAGFlow returned HTTP {response.status_code}"
            raise RAGFlowAPIError(
                str(message),
                status_code=response.status_code,
                code=payload.get("code"),
            )
        return payload

    async def upload(
        self,
        dataset_id: str,
        api_key: str,
        filename: str,
        content: Any,
        content_type: str,
    ) -> dict[str, Any]:
        return await self.request(
            "POST",
            f"/datasets/{dataset_id}/documents",
            api_key,
            files={"file": (filename, content, content_type)},
        )


class MossAuthError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class ResolvedCredential:
    api_key: str
    scopes: frozenset[str]
    permission: str


class MossAuthClient:
    def __init__(self, server_url: str, transport: httpx.AsyncBaseTransport | None = None):
        self.server_url = server_url.rstrip("/")
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(REQUEST_TIMEOUT),
            follow_redirects=False,
            transport=transport,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def resolve(self, moss_api_key: str) -> ResolvedCredential:
        if not self.server_url:
            raise MossAuthError("MOSS_SERVER_URL is required in moss auth mode", status_code=503)
        if not MOSS_RAG_GATEWAY_TOKEN:
            raise MossAuthError("MOSS_RAGFLOW_GATEWAY_TOKEN is required in moss auth mode", status_code=503)
        try:
            response = await self._client.post(
                f"{self.server_url}{MOSS_RAG_RESOLVE_PATH}",
                headers={
                    "Authorization": f"Bearer {moss_api_key}",
                    "X-Moss-Rag-Gateway-Token": MOSS_RAG_GATEWAY_TOKEN,
                },
            )
        except httpx.HTTPError as exc:
            raise MossAuthError(f"Moss Server request failed: {exc}") from exc
        try:
            payload = response.json()
        except ValueError as exc:
            raise MossAuthError(
                f"Moss Server returned HTTP {response.status_code} with a non-JSON response"
            ) from exc
        if response.status_code >= 400:
            message = payload.get("error") or payload.get("message") or "Moss Server rejected the credential"
            status = response.status_code if response.status_code in {401, 403, 429, 503} else 502
            raise MossAuthError(str(message), status_code=status)
        api_key = str(payload.get("ragflow_api_key") or "").strip()
        scopes = {
            str(value).strip().lower()
            for value in payload.get("scopes", [])
            if str(value).strip().lower() in ALLOWED_SCOPES
        }
        if not api_key or "read" not in scopes:
            raise MossAuthError("Moss Server returned an invalid RAGFlow credential")
        return ResolvedCredential(
            api_key=api_key,
            scopes=frozenset(scopes),
            permission=str(payload.get("permission") or "readonly"),
        )


@dataclass(frozen=True)
class UploadTicket:
    dataset_id: str
    api_key_fingerprint: str
    filename: str | None
    auto_parse: bool
    expires_at: float


class UploadTicketStore:
    def __init__(self) -> None:
        self._tickets: dict[str, UploadTicket] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _fingerprint(api_key: str) -> str:
        return hashlib.sha256(api_key.encode()).hexdigest()

    async def create(
        self,
        api_key: str,
        dataset_id: str,
        *,
        filename: str | None,
        auto_parse: bool,
        ttl_seconds: int,
    ) -> tuple[str, UploadTicket]:
        ticket_id = secrets.token_urlsafe(32)
        ticket = UploadTicket(
            dataset_id=dataset_id,
            api_key_fingerprint=self._fingerprint(api_key),
            filename=filename,
            auto_parse=auto_parse,
            expires_at=time.time() + ttl_seconds,
        )
        async with self._lock:
            now = time.time()
            self._tickets = {key: value for key, value in self._tickets.items() if value.expires_at > now}
            self._tickets[ticket_id] = ticket
        return ticket_id, ticket

    async def claim(self, ticket_id: str, api_key: str) -> UploadTicket | None:
        async with self._lock:
            ticket = self._tickets.get(ticket_id)
            if ticket is None:
                return None
            if ticket.expires_at <= time.time():
                self._tickets.pop(ticket_id, None)
                return None
            if not hmac.compare_digest(ticket.api_key_fingerprint, self._fingerprint(api_key)):
                return None
            return self._tickets.pop(ticket_id)


backend = RAGFlowClient(RAGFLOW_BASE_URL)
moss_auth = MossAuthClient(MOSS_SERVER_URL)
tickets = UploadTicketStore()


def _extract_token(headers: Any) -> str:
    if not headers or not hasattr(headers, "get"):
        return ""
    authorization = headers.get("authorization") or headers.get(b"authorization")
    if isinstance(authorization, bytes):
        authorization = authorization.decode(errors="ignore")
    if authorization and str(authorization).lower().startswith("bearer "):
        return str(authorization)[7:].strip()
    api_key = headers.get("x-api-key") or headers.get(b"x-api-key")
    if isinstance(api_key, bytes):
        api_key = api_key.decode(errors="ignore")
    return str(api_key or "").strip()


def _request_api_key() -> str:
    request = getattr(mcp_app.request_context, "request", None)
    if request is None:
        raise ValueError("RAGFlow API key is required")
    token = getattr(getattr(request, "state", None), AUTH_TOKEN_STATE_KEY, "")
    token = token or _extract_token(getattr(request, "headers", None))
    if not token:
        raise ValueError("RAGFlow API key is required")
    return token


def _request_scopes() -> set[str]:
    request = getattr(mcp_app.request_context, "request", None)
    if request is None:
        raise ValueError("Request authorization is required")
    values = getattr(getattr(request, "state", None), AUTH_SCOPES_STATE_KEY, None)
    if values is None:
        return set(SCOPES)
    return {str(value) for value in values if str(value) in ALLOWED_SCOPES}


def _clean_id(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise ValueError(f"{field} must be a non-empty string")
    return value.strip()


def _clean_ids(value: Any, field: str) -> list[str]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{field} must be a non-empty array")
    return [_clean_id(item, field) for item in value]


def _clean_filename(value: Any, *, required: bool = True) -> str | None:
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise TypeError("filename must be a string")
    filename = PurePosixPath(value.replace("\\", "/")).name.strip()
    if not filename or filename in {".", ".."}:
        raise ValueError("filename must not be empty")
    if len(filename.encode("utf-8")) > 255:
        raise ValueError("filename must be at most 255 bytes")
    return filename


def _bounded_int(value: Any, default: int, minimum: int, maximum: int, field: str) -> int:
    try:
        result = int(default if value is None else value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be an integer") from exc
    if result < minimum or result > maximum:
        raise ValueError(f"{field} must be between {minimum} and {maximum}")
    return result


def _confirmed(arguments: dict[str, Any]) -> None:
    if arguments.get("confirm") is not True:
        raise ValueError("confirm=true is required for this destructive operation")


def _text(payload: Any) -> list[types.TextContent]:
    return [types.TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))]


def _tool(name: str, description: str, _scope: str, properties: dict[str, Any], required: list[str] | None = None) -> types.Tool:
    schema: dict[str, Any] = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        schema["required"] = required
    return types.Tool(name=name, description=description, inputSchema=schema)


ID = {"type": "string", "minLength": 1, "maxLength": 128}
IDS = {"type": "array", "items": ID, "minItems": 1, "maxItems": 100}
CONFIRM = {"type": "boolean", "description": "Must be true to confirm deletion."}


def _all_tools() -> list[tuple[str, types.Tool]]:
    return [
        ("read", _tool("ragflow_capabilities", "Show enabled scopes, upload limits, and endpoint information.", "read", {})),
        (
            "read",
            _tool(
                "ragflow_list_datasets",
                "List knowledge bases accessible to the current RAGFlow API key.",
                "read",
                {
                    "page": {"type": "integer", "minimum": 1, "default": 1},
                    "page_size": {"type": "integer", "minimum": 1, "maximum": 100, "default": 30},
                    "name": {"type": "string"},
                },
            ),
        ),
        ("read", _tool("ragflow_get_dataset", "Get one knowledge base and its configuration.", "read", {"dataset_id": ID}, ["dataset_id"])),
        (
            "read",
            _tool(
                "ragflow_list_documents",
                "List documents and parsing status in a knowledge base.",
                "read",
                {
                    "dataset_id": ID,
                    "page": {"type": "integer", "minimum": 1, "default": 1},
                    "page_size": {"type": "integer", "minimum": 1, "maximum": 100, "default": 30},
                    "keywords": {"type": "string"},
                },
                ["dataset_id"],
            ),
        ),
        (
            "read",
            _tool(
                "ragflow_get_document",
                "Get one document, including parsing progress and chunk counts.",
                "read",
                {
                    "dataset_id": ID,
                    "document_id": ID,
                },
                ["dataset_id", "document_id"],
            ),
        ),
        (
            "read",
            _tool(
                "ragflow_list_chunks",
                "List or search chunks belonging to a document.",
                "read",
                {
                    "dataset_id": ID,
                    "document_id": ID,
                    "page": {"type": "integer", "minimum": 1, "default": 1},
                    "page_size": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
                    "keywords": {"type": "string"},
                    "available": {"type": "boolean"},
                },
                ["dataset_id", "document_id"],
            ),
        ),
        (
            "read",
            _tool(
                "ragflow_retrieval",
                "Retrieve relevant chunks from one or more knowledge bases.",
                "read",
                {
                    "question": {"type": "string", "minLength": 1},
                    "dataset_ids": IDS,
                    "document_ids": {"type": "array", "items": ID, "maxItems": 100},
                    "page": {"type": "integer", "minimum": 1, "default": 1},
                    "page_size": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
                    "similarity_threshold": {"type": "number", "minimum": 0, "maximum": 1, "default": 0.2},
                    "vector_similarity_weight": {"type": "number", "minimum": 0, "maximum": 1, "default": 0.3},
                    "keyword": {"type": "boolean", "default": False},
                },
                ["question"],
            ),
        ),
        (
            "write",
            _tool(
                "ragflow_create_dataset",
                "Create a knowledge base.",
                "write",
                {
                    "name": {"type": "string", "minLength": 1, "maxLength": 128},
                    "description": {"type": "string", "maxLength": 65535},
                    "embedding_model": {"type": "string"},
                    "permission": {"type": "string", "enum": ["me", "team"], "default": "me"},
                    "chunk_method": {"type": "string", "default": "naive"},
                },
                ["name"],
            ),
        ),
        (
            "write",
            _tool(
                "ragflow_update_dataset",
                "Update a knowledge base's basic configuration.",
                "write",
                {
                    "dataset_id": ID,
                    "name": {"type": "string", "minLength": 1, "maxLength": 128},
                    "description": {"type": "string", "maxLength": 65535},
                    "permission": {"type": "string", "enum": ["me", "team"]},
                    "chunk_method": {"type": "string"},
                },
                ["dataset_id"],
            ),
        ),
        (
            "write",
            _tool(
                "ragflow_upload_document_base64",
                "Upload a small document through MCP. Use an upload ticket for larger files.",
                "write",
                {
                    "dataset_id": ID,
                    "filename": {"type": "string", "minLength": 1, "maxLength": 255},
                    "content_base64": {"type": "string", "minLength": 1},
                    "content_type": {"type": "string"},
                    "auto_parse": {"type": "boolean", "default": True},
                },
                ["dataset_id", "filename", "content_base64"],
            ),
        ),
        (
            "write",
            _tool(
                "ragflow_create_upload_ticket",
                "Create a short-lived, one-time HTTP multipart upload URL for a large local file.",
                "write",
                {
                    "dataset_id": ID,
                    "filename": {"type": "string", "minLength": 1, "maxLength": 255},
                    "auto_parse": {"type": "boolean", "default": True},
                    "ttl_seconds": {"type": "integer", "minimum": 60, "maximum": 3600, "default": 600},
                },
                ["dataset_id"],
            ),
        ),
        (
            "write",
            _tool(
                "ragflow_start_parsing",
                "Start or restart parsing for documents.",
                "write",
                {
                    "dataset_id": ID,
                    "document_ids": IDS,
                },
                ["dataset_id", "document_ids"],
            ),
        ),
        (
            "write",
            _tool(
                "ragflow_stop_parsing",
                "Stop parsing documents that are currently running.",
                "write",
                {
                    "dataset_id": ID,
                    "document_ids": IDS,
                },
                ["dataset_id", "document_ids"],
            ),
        ),
        (
            "write",
            _tool(
                "ragflow_delete_documents",
                "Delete documents and their chunks.",
                "write",
                {
                    "dataset_id": ID,
                    "document_ids": IDS,
                    "confirm": CONFIRM,
                },
                ["dataset_id", "document_ids", "confirm"],
            ),
        ),
        (
            "write",
            _tool(
                "ragflow_create_chunk",
                "Create and embed a manual chunk in a document.",
                "write",
                {
                    "dataset_id": ID,
                    "document_id": ID,
                    "content": {"type": "string", "minLength": 1},
                    "important_keywords": {"type": "array", "items": {"type": "string"}},
                    "questions": {"type": "array", "items": {"type": "string"}},
                },
                ["dataset_id", "document_id", "content"],
            ),
        ),
        (
            "write",
            _tool(
                "ragflow_update_chunk",
                "Edit chunk content, keywords, questions, or availability.",
                "write",
                {
                    "dataset_id": ID,
                    "document_id": ID,
                    "chunk_id": ID,
                    "content": {"type": "string", "minLength": 1},
                    "important_keywords": {"type": "array", "items": {"type": "string"}},
                    "questions": {"type": "array", "items": {"type": "string"}},
                    "available": {"type": "boolean"},
                },
                ["dataset_id", "document_id", "chunk_id"],
            ),
        ),
        (
            "write",
            _tool(
                "ragflow_delete_chunks",
                "Delete selected chunks from a document.",
                "write",
                {
                    "dataset_id": ID,
                    "document_id": ID,
                    "chunk_ids": IDS,
                    "confirm": CONFIRM,
                },
                ["dataset_id", "document_id", "chunk_ids", "confirm"],
            ),
        ),
        (
            "agent",
            _tool(
                "ragflow_list_chats",
                "List chat assistants accessible to the current API key.",
                "agent",
                {
                    "page": {"type": "integer", "minimum": 1, "default": 1},
                    "page_size": {"type": "integer", "minimum": 1, "maximum": 100, "default": 30},
                    "keywords": {"type": "string"},
                },
            ),
        ),
        (
            "agent",
            _tool(
                "ragflow_list_chat_sessions",
                "List sessions for a chat assistant.",
                "agent",
                {
                    "chat_id": ID,
                    "page": {"type": "integer", "minimum": 1, "default": 1},
                    "page_size": {"type": "integer", "minimum": 1, "maximum": 100, "default": 30},
                },
                ["chat_id"],
            ),
        ),
        (
            "agent",
            _tool(
                "ragflow_create_chat_session",
                "Create a session for a chat assistant.",
                "agent",
                {
                    "chat_id": ID,
                    "name": {"type": "string", "minLength": 1, "maxLength": 255},
                },
                ["chat_id"],
            ),
        ),
        (
            "agent",
            _tool(
                "ragflow_chat",
                "Ask a chat assistant a question and return the complete non-streaming response.",
                "agent",
                {
                    "chat_id": ID,
                    "session_id": ID,
                    "question": {"type": "string", "minLength": 1},
                },
                ["chat_id", "question"],
            ),
        ),
        (
            "agent",
            _tool(
                "ragflow_delete_chat_sessions",
                "Delete selected chat sessions.",
                "agent",
                {
                    "chat_id": ID,
                    "session_ids": IDS,
                    "confirm": CONFIRM,
                },
                ["chat_id", "session_ids", "confirm"],
            ),
        ),
        (
            "agent",
            _tool(
                "ragflow_list_agents",
                "List RAGFlow agents and workflows accessible to the current API key.",
                "agent",
                {
                    "page": {"type": "integer", "minimum": 1, "default": 1},
                    "page_size": {"type": "integer", "minimum": 1, "maximum": 100, "default": 30},
                    "keywords": {"type": "string"},
                },
            ),
        ),
        (
            "agent",
            _tool(
                "ragflow_list_agent_sessions",
                "List sessions for an agent or workflow.",
                "agent",
                {
                    "agent_id": ID,
                    "page": {"type": "integer", "minimum": 1, "default": 1},
                    "page_size": {"type": "integer", "minimum": 1, "maximum": 100, "default": 30},
                },
                ["agent_id"],
            ),
        ),
        (
            "agent",
            _tool(
                "ragflow_create_agent_session",
                "Create a session for an agent or workflow.",
                "agent",
                {
                    "agent_id": ID,
                    "name": {"type": "string", "maxLength": 255},
                    "release": {"type": "boolean", "default": False},
                },
                ["agent_id"],
            ),
        ),
        (
            "agent",
            _tool(
                "ragflow_run_agent",
                "Run an agent or workflow and return its complete non-streaming response.",
                "agent",
                {
                    "agent_id": ID,
                    "session_id": ID,
                    "question": {"type": "string"},
                    "inputs": {"type": "object"},
                    "release": {"type": "boolean", "default": False},
                    "return_trace": {"type": "boolean", "default": False},
                },
                ["agent_id"],
            ),
        ),
        (
            "agent",
            _tool(
                "ragflow_delete_agent_sessions",
                "Delete selected agent or workflow sessions.",
                "agent",
                {
                    "agent_id": ID,
                    "session_ids": IDS,
                    "confirm": CONFIRM,
                },
                ["agent_id", "session_ids", "confirm"],
            ),
        ),
        (
            "admin",
            _tool(
                "ragflow_delete_datasets",
                "Permanently delete knowledge bases. Requires the admin scope.",
                "admin",
                {
                    "dataset_ids": IDS,
                    "confirm": CONFIRM,
                },
                ["dataset_ids", "confirm"],
            ),
        ),
    ]


@asynccontextmanager
async def mcp_lifespan(_: Server) -> AsyncIterator[dict[str, Any]]:
    yield {}


mcp_app = Server(SERVICE_NAME, lifespan=mcp_lifespan)


@mcp_app.list_tools()
async def list_tools() -> list[types.Tool]:
    api_key = _request_api_key()
    await backend.request("GET", "/datasets", api_key, params={"page": 1, "page_size": 1})
    scopes = _request_scopes()
    return [tool for scope, tool in _all_tools() if scope in scopes]


async def _resolve_dataset_ids(api_key: str) -> list[str]:
    result: list[str] = []
    page = 1
    while True:
        payload = await backend.request("GET", "/datasets", api_key, params={"page": page, "page_size": 100})
        values = payload.get("data") or []
        result.extend(item["id"] for item in values if item.get("id"))
        total = payload.get("total", len(result))
        if not values or len(result) >= total:
            return list(dict.fromkeys(result))
        page += 1


async def _find_document(api_key: str, dataset_id: str, document_id: str) -> dict[str, Any]:
    page = 1
    while True:
        payload = await backend.request(
            "GET",
            f"/datasets/{dataset_id}/documents",
            api_key,
            params={"page": page, "page_size": 100},
        )
        data = payload.get("data") or {}
        documents = data.get("docs") or []
        for document in documents:
            if document.get("id") == document_id:
                return {"code": 0, "data": document}
        total = data.get("total", len(documents))
        if not documents or page * 100 >= total:
            raise RAGFlowAPIError("Document not found", status_code=404, code=102)
        page += 1


async def _start_parsing(api_key: str, dataset_id: str, document_ids: list[str]) -> dict[str, Any]:
    return await backend.request("POST", f"/datasets/{dataset_id}/chunks", api_key, json_body={"document_ids": document_ids})


def _uploaded_document_ids(payload: dict[str, Any]) -> list[str]:
    data = payload.get("data") or []
    if isinstance(data, dict):
        data = [data]
    return [item["id"] for item in data if isinstance(item, dict) and item.get("id")]


@mcp_app.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[types.TextContent]:
    api_key = _request_api_key()
    scopes = _request_scopes()
    tools_by_name = {tool.name: scope for scope, tool in _all_tools()}
    scope = tools_by_name.get(name)
    if scope is None:
        raise ValueError(f"Unknown tool: {name}")
    if scope not in scopes:
        raise ValueError(f"Tool {name} requires the disabled '{scope}' scope")

    if name == "ragflow_capabilities":
        return _text(
            {
                "service": SERVICE_NAME,
                "auth_mode": AUTH_MODE,
                "scopes": sorted(scopes),
                "max_base64_mb": MAX_BASE64_BYTES // 1024 // 1024,
                "max_multipart_upload_mb": MAX_UPLOAD_BYTES // 1024 // 1024,
                "multipart_upload": f"{PUBLIC_URL}/upload/<ticket>",
            }
        )

    if name == "ragflow_list_datasets":
        params = {
            "page": _bounded_int(arguments.get("page"), 1, 1, 100000, "page"),
            "page_size": _bounded_int(arguments.get("page_size"), 30, 1, 100, "page_size"),
        }
        if arguments.get("name"):
            params["name"] = str(arguments["name"])
        return _text(await backend.request("GET", "/datasets", api_key, params=params))

    if name == "ragflow_get_dataset":
        dataset_id = _clean_id(arguments.get("dataset_id"), "dataset_id")
        return _text(await backend.request("GET", f"/datasets/{dataset_id}", api_key))

    if name == "ragflow_list_documents":
        dataset_id = _clean_id(arguments.get("dataset_id"), "dataset_id")
        params = {
            "page": _bounded_int(arguments.get("page"), 1, 1, 100000, "page"),
            "page_size": _bounded_int(arguments.get("page_size"), 30, 1, 100, "page_size"),
        }
        if arguments.get("keywords"):
            params["keywords"] = str(arguments["keywords"])
        return _text(await backend.request("GET", f"/datasets/{dataset_id}/documents", api_key, params=params))

    if name == "ragflow_get_document":
        dataset_id = _clean_id(arguments.get("dataset_id"), "dataset_id")
        document_id = _clean_id(arguments.get("document_id"), "document_id")
        return _text(await _find_document(api_key, dataset_id, document_id))

    if name == "ragflow_list_chunks":
        dataset_id = _clean_id(arguments.get("dataset_id"), "dataset_id")
        document_id = _clean_id(arguments.get("document_id"), "document_id")
        params: dict[str, Any] = {
            "page": _bounded_int(arguments.get("page"), 1, 1, 100000, "page"),
            "page_size": _bounded_int(arguments.get("page_size"), 20, 1, 100, "page_size"),
        }
        if arguments.get("keywords"):
            params["keywords"] = str(arguments["keywords"])
        if "available" in arguments:
            params["available"] = "true" if arguments["available"] else "false"
        path = f"/datasets/{dataset_id}/documents/{document_id}/chunks"
        return _text(await backend.request("GET", path, api_key, params=params))

    if name == "ragflow_retrieval":
        question = str(arguments.get("question") or "").strip()
        if not question:
            raise ValueError("question must not be empty")
        dataset_ids = arguments.get("dataset_ids") or await _resolve_dataset_ids(api_key)
        dataset_ids = _clean_ids(dataset_ids, "dataset_ids")
        page = _bounded_int(arguments.get("page"), 1, 1, 100000, "page")
        page_size = _bounded_int(arguments.get("page_size"), 10, 1, 50, "page_size")
        body = {
            "question": question,
            "dataset_ids": dataset_ids,
            "document_ids": arguments.get("document_ids") or [],
            "page": page,
            "page_size": page_size,
            "similarity_threshold": float(arguments.get("similarity_threshold", 0.2)),
            "vector_similarity_weight": float(arguments.get("vector_similarity_weight", 0.3)),
            "keyword": bool(arguments.get("keyword", False)),
            "rerank_candidates_count": max(64, page * page_size),
        }
        return _text(await backend.request("POST", "/retrieval", api_key, json_body=body))

    if name == "ragflow_create_dataset":
        body = {key: arguments[key] for key in ("name", "description", "embedding_model", "permission", "chunk_method") if key in arguments}
        body["name"] = str(body.get("name") or "").strip()
        if not body["name"]:
            raise ValueError("name must not be empty")
        return _text(await backend.request("POST", "/datasets", api_key, json_body=body))

    if name == "ragflow_update_dataset":
        dataset_id = _clean_id(arguments.get("dataset_id"), "dataset_id")
        body = {key: arguments[key] for key in ("name", "description", "permission", "chunk_method") if key in arguments}
        if not body:
            raise ValueError("at least one update field is required")
        return _text(await backend.request("PUT", f"/datasets/{dataset_id}", api_key, json_body=body))

    if name == "ragflow_upload_document_base64":
        dataset_id = _clean_id(arguments.get("dataset_id"), "dataset_id")
        filename = _clean_filename(arguments.get("filename"))
        try:
            content = base64.b64decode(arguments.get("content_base64", ""), validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("content_base64 is invalid") from exc
        if not content:
            raise ValueError("uploaded content is empty")
        if len(content) > MAX_BASE64_BYTES:
            raise ValueError(f"Base64 upload exceeds {MAX_BASE64_BYTES // 1024 // 1024} MiB; use ragflow_create_upload_ticket")
        content_type = str(arguments.get("content_type") or mimetypes.guess_type(filename)[0] or "application/octet-stream")
        uploaded = await backend.upload(dataset_id, api_key, filename, content, content_type)
        document_ids = _uploaded_document_ids(uploaded)
        parsed = None
        if arguments.get("auto_parse", True) and document_ids:
            parsed = await _start_parsing(api_key, dataset_id, document_ids)
        return _text({"upload": uploaded, "parse": parsed})

    if name == "ragflow_create_upload_ticket":
        dataset_id = _clean_id(arguments.get("dataset_id"), "dataset_id")
        await backend.request("GET", f"/datasets/{dataset_id}", api_key)
        filename = _clean_filename(arguments.get("filename"), required=False)
        ttl = _bounded_int(arguments.get("ttl_seconds"), 600, 60, 3600, "ttl_seconds")
        ticket_id, ticket = await tickets.create(
            api_key,
            dataset_id,
            filename=filename,
            auto_parse=bool(arguments.get("auto_parse", True)),
            ttl_seconds=ttl,
        )
        return _text(
            {
                "upload_url": f"{PUBLIC_URL}/upload/{ticket_id}",
                "method": "POST",
                "authorization": "Use the same Authorization: Bearer credential that created this ticket",
                "multipart_field": "file",
                "expires_at": int(ticket.expires_at),
                "max_bytes": MAX_UPLOAD_BYTES,
            }
        )

    if name in {"ragflow_start_parsing", "ragflow_stop_parsing"}:
        dataset_id = _clean_id(arguments.get("dataset_id"), "dataset_id")
        document_ids = _clean_ids(arguments.get("document_ids"), "document_ids")
        if name == "ragflow_start_parsing":
            return _text(await _start_parsing(api_key, dataset_id, document_ids))
        return _text(await backend.request("DELETE", f"/datasets/{dataset_id}/chunks", api_key, json_body={"document_ids": document_ids}))

    if name == "ragflow_delete_documents":
        _confirmed(arguments)
        dataset_id = _clean_id(arguments.get("dataset_id"), "dataset_id")
        document_ids = _clean_ids(arguments.get("document_ids"), "document_ids")
        return _text(await backend.request("DELETE", f"/datasets/{dataset_id}/documents", api_key, json_body={"ids": document_ids}))

    if name == "ragflow_create_chunk":
        dataset_id = _clean_id(arguments.get("dataset_id"), "dataset_id")
        document_id = _clean_id(arguments.get("document_id"), "document_id")
        body = {key: arguments[key] for key in ("content", "important_keywords", "questions") if key in arguments}
        path = f"/datasets/{dataset_id}/documents/{document_id}/chunks"
        return _text(await backend.request("POST", path, api_key, json_body=body))

    if name == "ragflow_update_chunk":
        dataset_id = _clean_id(arguments.get("dataset_id"), "dataset_id")
        document_id = _clean_id(arguments.get("document_id"), "document_id")
        chunk_id = _clean_id(arguments.get("chunk_id"), "chunk_id")
        body = {key: arguments[key] for key in ("content", "important_keywords", "questions", "available") if key in arguments}
        if not body:
            raise ValueError("at least one update field is required")
        path = f"/datasets/{dataset_id}/documents/{document_id}/chunks/{chunk_id}"
        return _text(await backend.request("PATCH", path, api_key, json_body=body))

    if name == "ragflow_delete_chunks":
        _confirmed(arguments)
        dataset_id = _clean_id(arguments.get("dataset_id"), "dataset_id")
        document_id = _clean_id(arguments.get("document_id"), "document_id")
        chunk_ids = _clean_ids(arguments.get("chunk_ids"), "chunk_ids")
        path = f"/datasets/{dataset_id}/documents/{document_id}/chunks"
        return _text(await backend.request("DELETE", path, api_key, json_body={"chunk_ids": chunk_ids}))

    if name == "ragflow_list_chats":
        params = {
            "page": _bounded_int(arguments.get("page"), 1, 1, 100000, "page"),
            "page_size": _bounded_int(arguments.get("page_size"), 30, 1, 100, "page_size"),
        }
        if arguments.get("keywords"):
            params["keywords"] = str(arguments["keywords"])
        return _text(await backend.request("GET", "/chats", api_key, params=params))

    if name == "ragflow_list_chat_sessions":
        chat_id = _clean_id(arguments.get("chat_id"), "chat_id")
        params = {
            "page": _bounded_int(arguments.get("page"), 1, 1, 100000, "page"),
            "page_size": _bounded_int(arguments.get("page_size"), 30, 1, 100, "page_size"),
        }
        return _text(await backend.request("GET", f"/chats/{chat_id}/sessions", api_key, params=params))

    if name == "ragflow_create_chat_session":
        chat_id = _clean_id(arguments.get("chat_id"), "chat_id")
        name_value = str(arguments.get("name") or "New session").strip()
        if not name_value:
            raise ValueError("name must not be empty")
        return _text(await backend.request("POST", f"/chats/{chat_id}/sessions", api_key, json_body={"name": name_value}))

    if name == "ragflow_chat":
        chat_id = _clean_id(arguments.get("chat_id"), "chat_id")
        question = str(arguments.get("question") or "").strip()
        if not question:
            raise ValueError("question must not be empty")
        body: dict[str, Any] = {
            "chat_id": chat_id,
            "messages": [{"role": "user", "content": question}],
            "stream": False,
        }
        if arguments.get("session_id"):
            body["session_id"] = _clean_id(arguments["session_id"], "session_id")
        return _text(await backend.request("POST", "/chat/completions", api_key, json_body=body))

    if name == "ragflow_delete_chat_sessions":
        _confirmed(arguments)
        chat_id = _clean_id(arguments.get("chat_id"), "chat_id")
        session_ids = _clean_ids(arguments.get("session_ids"), "session_ids")
        return _text(await backend.request("DELETE", f"/chats/{chat_id}/sessions", api_key, json_body={"ids": session_ids}))

    if name == "ragflow_list_agents":
        params = {
            "page": _bounded_int(arguments.get("page"), 1, 1, 100000, "page"),
            "page_size": _bounded_int(arguments.get("page_size"), 30, 1, 100, "page_size"),
        }
        if arguments.get("keywords"):
            params["keywords"] = str(arguments["keywords"])
        return _text(await backend.request("GET", "/agents", api_key, params=params))

    if name == "ragflow_list_agent_sessions":
        agent_id = _clean_id(arguments.get("agent_id"), "agent_id")
        params = {
            "page": _bounded_int(arguments.get("page"), 1, 1, 100000, "page"),
            "page_size": _bounded_int(arguments.get("page_size"), 30, 1, 100, "page_size"),
        }
        return _text(await backend.request("GET", f"/agents/{agent_id}/sessions", api_key, params=params))

    if name == "ragflow_create_agent_session":
        agent_id = _clean_id(arguments.get("agent_id"), "agent_id")
        body = {
            "name": str(arguments.get("name") or ""),
            "release": bool(arguments.get("release", False)),
        }
        return _text(await backend.request("POST", f"/agents/{agent_id}/sessions", api_key, json_body=body))

    if name == "ragflow_run_agent":
        agent_id = _clean_id(arguments.get("agent_id"), "agent_id")
        body = {
            "agent_id": agent_id,
            "query": str(arguments.get("question") or ""),
            "inputs": arguments.get("inputs") or {},
            "release": bool(arguments.get("release", False)),
            "return_trace": bool(arguments.get("return_trace", False)),
            "stream": False,
        }
        if arguments.get("session_id"):
            body["session_id"] = _clean_id(arguments["session_id"], "session_id")
        return _text(await backend.request("POST", "/agents/chat/completions", api_key, json_body=body))

    if name == "ragflow_delete_agent_sessions":
        _confirmed(arguments)
        agent_id = _clean_id(arguments.get("agent_id"), "agent_id")
        session_ids = _clean_ids(arguments.get("session_ids"), "session_ids")
        return _text(await backend.request("DELETE", f"/agents/{agent_id}/sessions", api_key, json_body={"ids": session_ids}))

    if name == "ragflow_delete_datasets":
        _confirmed(arguments)
        dataset_ids = _clean_ids(arguments.get("dataset_ids"), "dataset_ids")
        return _text(await backend.request("DELETE", "/datasets", api_key, json_body={"ids": dataset_ids}))

    raise ValueError(f"Unknown tool: {name}")


class AuthMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and (scope["path"].startswith("/mcp") or scope["path"].startswith("/upload/")):
            token = _extract_token(dict(scope.get("headers", [])))
            if not token:
                response = JSONResponse({"error": "Missing Bearer token"}, status_code=401)
                await response(scope, receive, send)
                return
            try:
                credential = (
                    await moss_auth.resolve(token)
                    if AUTH_MODE == "moss"
                    else ResolvedCredential(
                        api_key=token,
                        scopes=frozenset(SCOPES),
                        permission="direct",
                    )
                )
            except MossAuthError as exc:
                response = JSONResponse({"error": str(exc)}, status_code=exc.status_code)
                await response(scope, receive, send)
                return
            state = scope.setdefault("state", {})
            state[AUTH_TOKEN_STATE_KEY] = credential.api_key
            state[AUTH_SCOPES_STATE_KEY] = credential.scopes
        await self.app(scope, receive, send)


async def health(_: Request) -> JSONResponse:
    return JSONResponse(
        {
            "status": "ok",
            "service": SERVICE_NAME,
            "auth_mode": AUTH_MODE,
            "scopes": sorted(SCOPES) if AUTH_MODE == "direct" else "resolved-per-user",
        }
    )


async def upload_file(request: Request) -> JSONResponse:
    api_key = getattr(request.state, AUTH_TOKEN_STATE_KEY, "")
    scopes = set(getattr(request.state, AUTH_SCOPES_STATE_KEY, ()))
    if "write" not in scopes:
        return JSONResponse({"error": "File upload requires write permission"}, status_code=403)
    ticket = await tickets.claim(request.path_params["ticket_id"], api_key)
    if ticket is None:
        return JSONResponse({"error": "Upload ticket is invalid, expired, already used, or belongs to another API key"}, status_code=403)

    try:
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > MAX_UPLOAD_BYTES + 1024 * 1024:
            return JSONResponse({"error": f"Upload exceeds {MAX_UPLOAD_BYTES} bytes"}, status_code=413)
        form = await request.form(max_files=1, max_fields=8, max_part_size=MAX_UPLOAD_BYTES)
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            return JSONResponse({"error": "multipart field 'file' is required"}, status_code=400)
        await upload.seek(0)
        upload.file.seek(0, 2)
        upload_size = upload.file.tell()
        upload.file.seek(0)
        if upload_size == 0:
            return JSONResponse({"error": "uploaded file is empty"}, status_code=400)
        if upload_size > MAX_UPLOAD_BYTES:
            return JSONResponse({"error": f"Upload exceeds {MAX_UPLOAD_BYTES} bytes"}, status_code=413)
        filename = ticket.filename or _clean_filename(getattr(upload, "filename", None))
        content_type = getattr(upload, "content_type", None) or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        uploaded = await backend.upload(ticket.dataset_id, api_key, filename, upload.file, content_type)
        document_ids = _uploaded_document_ids(uploaded)
        parsed = None
        if ticket.auto_parse and document_ids:
            parsed = await _start_parsing(api_key, ticket.dataset_id, document_ids)
        return JSONResponse({"ok": True, "upload": uploaded, "parse": parsed})
    except RAGFlowAPIError as exc:
        return JSONResponse({"error": str(exc), "ragflow_code": exc.code}, status_code=max(400, exc.status_code))
    except (ValueError, TypeError) as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


session_manager = StreamableHTTPSessionManager(
    app=mcp_app,
    event_store=None,
    json_response=True,
    stateless=True,
)


class StreamableHTTPEntry:
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        await session_manager.handle_request(scope, receive, send)


@asynccontextmanager
async def app_lifespan(_: Starlette) -> AsyncIterator[None]:
    try:
        async with session_manager.run():
            yield
    finally:
        await backend.close()
        await moss_auth.close()


streamable_http = StreamableHTTPEntry()
asgi_app = Starlette(
    routes=[
        Route("/healthz", health, methods=["GET"]),
        Route("/upload/{ticket_id}", upload_file, methods=["POST"]),
        Route("/mcp", streamable_http, methods=["GET", "POST", "DELETE"]),
        Mount("/mcp", app=streamable_http),
    ],
    middleware=[Middleware(AuthMiddleware)],
    lifespan=app_lifespan,
)


if __name__ == "__main__":
    uvicorn.run(asgi_app, host=HOST, port=PORT, log_level=os.getenv("LOG_LEVEL", "info").lower())
