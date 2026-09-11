# RAGFlow Connector

Moss provides one **RAGFlow 企业知识库** connector with two authentication methods. A direct RAGFlow API key connects to the Extended MCP sidecar, while Moss Server authentication reuses the current Moss login and applies the user's effective knowledge-base permissions.

## Configure

1. Open the Connector Hub and install **RAGFlow 企业知识库**.
2. Choose **Moss Server 登录态** or **RAGFlow API Key**.
3. For Moss Server, enter the Moss RAG MCP host and port, such as `ragflow.company.local:9386`.
4. For API Key, enter the Extended MCP host and port, such as `ragflow.company.local:9385`, and a `ragflow-...` key.
5. Add the connector to a session, then ask Moss to list knowledge bases or retrieve a question.

The selected mode, MCP address, and optional API key are stored in Moss's encrypted connector credential store. The current Moss token is resolved at runtime and is never stored as a connector credential. Saving or changing the configuration immediately validates the selected MCP endpoint. An installed connector can be reconfigured and reauthenticated at any time from its settings action.

This connector template uses HTTP and is intended for a trusted LAN; expose it through a dedicated HTTPS connector template before using it across untrusted networks.

## Capabilities

The bundled skill teaches the agent to use read, write, chat, agent, and upload-ticket workflows. Actual operations are limited by the scopes enabled on the Extended MCP deployment. Destructive tools require explicit confirmation, and the `admin` scope is expected to remain disabled for the first deployment.

For large files, Moss creates a one-time upload ticket through MCP and sends the local file directly to the sidecar with HTTP multipart. This avoids Base64 expansion and large model context usage.

## Refresh the bundled catalog

After editing `ui/resources/connector-sources/ragflow`, rebuild the catalog archive:

```bash
bun run connectors:sync-ragflow
```

Use `bun run connectors:sync-local` to refresh every locally maintained connector source.
