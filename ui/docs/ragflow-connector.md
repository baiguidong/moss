# RAGFlow Connector

Moss includes a native connector for the RAGFlow Extended MCP sidecar. It keeps the RAGFlow service unchanged and injects the configured API key as an authenticated Bearer header.

Moss also includes **Moss RAG 企业知识库** for the permission-aware MCP gateway. The Agent automatically sends its current Moss Server login identity to port 9386; Moss Server owns the RAGFlow account binding and returns only the tools allowed by the user's `readonly` or `manager` permission.

## Configure

1. Open the Connector Hub and install **RAGFlow 企业知识库**.
2. Enter the Extended MCP host and port, for example `ragflow.company.local:9385`.
3. Enter a RAGFlow API key such as `ragflow-...`.
4. Add the connector to a session, then ask Moss to list knowledge bases or retrieve a question.

The MCP address and API key are stored in Moss's encrypted connector credential store. This connector template uses HTTP and is intended for a trusted LAN; expose it through a dedicated HTTPS connector template before using it across untrusted networks.

For Moss-managed identity, first log in to Moss Server, then install **Moss RAG 企业知识库** and enter only the gateway host and port, such as `ragflow.company.local:9386`. The connector reuses the current Moss login automatically; it does not ask for a Moss or RAGFlow API key.

## Capabilities

The bundled skill teaches the agent to use read, write, chat, agent, and upload-ticket workflows. Actual operations are limited by the scopes enabled on the Extended MCP deployment. Destructive tools require explicit confirmation, and the `admin` scope is expected to remain disabled for the first deployment.

For large files, Moss creates a one-time upload ticket through MCP and sends the local file directly to the sidecar with HTTP multipart. This avoids Base64 expansion and large model context usage.

## Refresh the bundled catalog

After editing `ui/resources/connector-sources/ragflow`, rebuild the catalog archive:

```bash
bun run connectors:sync-ragflow
```

For the Moss identity connector:

```bash
bun run connectors:sync-moss-rag
```

Use `bun run connectors:sync-local` to refresh every locally maintained connector source.
