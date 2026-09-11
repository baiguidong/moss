import json
import time
import unittest

import httpx
import server


class RAGFlowClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_request_forwards_bearer_and_returns_json(self):
        async def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.headers["Authorization"], "Bearer ragflow-test")
            self.assertEqual(request.url.path, "/api/v1/datasets")
            return httpx.Response(200, json={"code": 0, "data": [{"id": "kb-1"}]})

        client = server.RAGFlowClient("http://ragflow", httpx.MockTransport(handler))
        try:
            result = await client.request("GET", "/datasets", "ragflow-test")
            self.assertEqual(result["data"][0]["id"], "kb-1")
        finally:
            await client.close()

    async def test_request_raises_api_message(self):
        async def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"code": 102, "message": "denied"})

        client = server.RAGFlowClient("http://ragflow", httpx.MockTransport(handler))
        try:
            with self.assertRaisesRegex(server.RAGFlowAPIError, "denied"):
                await client.request("GET", "/datasets", "ragflow-test")
        finally:
            await client.close()


class MossAuthClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_resolve_exchanges_moss_key_for_scoped_ragflow_key(self):
        original_gateway_token = server.MOSS_RAG_GATEWAY_TOKEN
        server.MOSS_RAG_GATEWAY_TOKEN = "gateway-secret"
        async def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.method, "POST")
            self.assertEqual(request.url.path, "/api/v1/integrations/ragflow/resolve")
            self.assertEqual(request.headers["Authorization"], "Bearer moss-user-key")
            self.assertEqual(request.headers["X-Moss-Rag-Gateway-Token"], "gateway-secret")
            return httpx.Response(
                200,
                json={
                    "ragflow_api_key": "ragflow-user-key",
                    "permission": "manager",
                    "scopes": ["read", "write", "agent", "admin", "unknown"],
                },
            )

        client = server.MossAuthClient("http://moss-server", httpx.MockTransport(handler))
        try:
            credential = await client.resolve("moss-user-key")
            self.assertEqual(credential.api_key, "ragflow-user-key")
            self.assertEqual(credential.permission, "manager")
            self.assertEqual(
                credential.scopes,
                frozenset({"read", "write", "agent", "admin"}),
            )
        finally:
            server.MOSS_RAG_GATEWAY_TOKEN = original_gateway_token
            await client.close()

    async def test_resolve_preserves_authentication_failure(self):
        original_gateway_token = server.MOSS_RAG_GATEWAY_TOKEN
        server.MOSS_RAG_GATEWAY_TOKEN = "gateway-secret"
        async def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"error": "invalid Moss API key"})

        client = server.MossAuthClient("http://moss-server", httpx.MockTransport(handler))
        try:
            with self.assertRaisesRegex(server.MossAuthError, "invalid Moss API key") as raised:
                await client.resolve("bad-key")
            self.assertEqual(raised.exception.status_code, 401)
        finally:
            server.MOSS_RAG_GATEWAY_TOKEN = original_gateway_token
            await client.close()

    async def test_resolve_rejects_missing_read_scope(self):
        original_gateway_token = server.MOSS_RAG_GATEWAY_TOKEN
        server.MOSS_RAG_GATEWAY_TOKEN = "gateway-secret"
        async def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={"ragflow_api_key": "ragflow-user-key", "scopes": ["write"]},
            )

        client = server.MossAuthClient("http://moss-server", httpx.MockTransport(handler))
        try:
            with self.assertRaisesRegex(server.MossAuthError, "invalid RAGFlow credential"):
                await client.resolve("moss-user-key")
        finally:
            server.MOSS_RAG_GATEWAY_TOKEN = original_gateway_token
            await client.close()


class UploadTicketStoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_ticket_is_bound_to_api_key_and_single_use(self):
        store = server.UploadTicketStore()
        ticket_id, _ = await store.create("ragflow-owner", "kb-1", filename="manual.pdf", auto_parse=True, ttl_seconds=60)
        self.assertIsNone(await store.claim(ticket_id, "ragflow-other"))
        ticket = await store.claim(ticket_id, "ragflow-owner")
        self.assertEqual(ticket.dataset_id, "kb-1")
        self.assertIsNone(await store.claim(ticket_id, "ragflow-owner"))

    async def test_expired_ticket_is_rejected(self):
        store = server.UploadTicketStore()
        ticket_id, ticket = await store.create("ragflow-owner", "kb-1", filename=None, auto_parse=False, ttl_seconds=60)
        store._tickets[ticket_id] = server.UploadTicket(
            dataset_id=ticket.dataset_id,
            api_key_fingerprint=ticket.api_key_fingerprint,
            filename=ticket.filename,
            auto_parse=ticket.auto_parse,
            expires_at=time.time() - 1,
        )
        self.assertIsNone(await store.claim(ticket_id, "ragflow-owner"))


class ValidationTests(unittest.TestCase):
    def test_filename_strips_paths(self):
        self.assertEqual(server._clean_filename("../../docs/manual.pdf"), "manual.pdf")
        self.assertEqual(server._clean_filename(r"C:\\docs\\manual.pdf"), "manual.pdf")

    def test_delete_requires_explicit_confirmation(self):
        with self.assertRaisesRegex(ValueError, "confirm=true"):
            server._confirmed({})
        server._confirmed({"confirm": True})

    def test_tool_scopes_are_machine_readable(self):
        tools = {tool.name: (scope, json.loads(tool.model_dump_json())) for scope, tool in server._all_tools()}
        self.assertEqual(tools["ragflow_retrieval"][0], "read")
        self.assertEqual(tools["ragflow_delete_datasets"][0], "admin")


if __name__ == "__main__":
    unittest.main()
