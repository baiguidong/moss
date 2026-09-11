---
name: moss-rag
description: Search and manage the enterprise RAGFlow knowledge base through Moss identity and permission-aware MCP tools. Use for retrieval, datasets, documents, chunks, parsing, uploads, chats, or RAGFlow agents.
---

# Moss RAG enterprise knowledge base

Use the `ragflow_*` tools exposed by this connector. Call `ragflow_capabilities` before an unfamiliar workflow to learn whether the current Moss user has read-only or manager access.

## Retrieval

1. Use `ragflow_list_datasets` when the target knowledge base ID is unknown.
2. Use `ragflow_retrieval` with the user's question and the narrowest relevant `dataset_ids` or `document_ids`.
3. Preserve document names, chunk IDs, and source metadata as citations.
4. Do not claim information that was not returned by retrieval.

## Permissions

- Read-only users can list and retrieve datasets, documents, and chunks.
- Manager users can also create, update, upload, parse, delete, chat, and run Agent workflows.
- Never try to bypass a missing tool. The tool list is the effective permission returned by Moss Server.

## Uploads

For tiny text files, use `ragflow_upload_document_base64`. For normal files, call `ragflow_create_upload_ticket`, then upload the file to the returned URL as multipart field `file` with `Authorization: Bearer $MOSS_SERVER_AUTH_TOKEN`. Moss injects this value from the current login; never print it or enable shell tracing.

## Mutating operations

Before deleting datasets, documents, chunks, chat sessions, or Agent sessions, identify the exact target and obtain confirmation. Pass `confirm: true` only after confirmation.
