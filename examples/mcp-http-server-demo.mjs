#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';

const port = Number.parseInt(process.env.PORT || '3010', 10);
const host = process.env.HOST || '127.0.0.1';
const endpoint = '/mcp';

function createDemoServer() {
  const server = new McpServer({
    name: 'moss-demo-http-mcp',
    version: '1.0.0',
  });

  server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: 'Return the text passed to this MCP server.',
      inputSchema: {
        text: z.string().describe('Text to echo back'),
      },
    },
    async ({ text }) => ({
      content: [
        {
          type: 'text',
          text: `echo: ${text}`,
        },
      ],
    }),
  );

  server.registerTool(
    'add',
    {
      title: 'Add',
      description: 'Add two numbers and return the result.',
      inputSchema: {
        a: z.number().describe('First number'),
        b: z.number().describe('Second number'),
      },
    },
    async ({ a, b }) => ({
      content: [
        {
          type: 'text',
          text: `${a} + ${b} = ${a + b}`,
        },
      ],
    }),
  );

  server.registerResource(
    'demo-readme',
    'demo://moss/http-mcp/readme',
    {
      title: 'Moss HTTP MCP Demo',
      mimeType: 'text/plain',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: 'This resource is served by examples/mcp-http-server-demo.mjs.',
        },
      ],
    }),
  );

  return server;
}

const app = createMcpExpressApp();
const transports = new Map();

app.post(endpoint, async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    let transport = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;

    if (!transport) {
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: initialize first',
          },
          id: null,
        });
        return;
      }

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (newSessionId) => {
          transports.set(newSessionId, transport);
          console.log(`MCP session initialized: ${newSessionId}`);
        },
      });

      const server = createDemoServer();
      await server.connect(transport);
      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
        }
        void server.close();
      };
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request failed:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

app.get(endpoint, (_req, res) => {
  res.status(405).set('Allow', 'POST').send('Method Not Allowed');
});

app.delete(endpoint, (_req, res) => {
  res.status(405).set('Allow', 'POST').send('Method Not Allowed');
});

const httpServer = app.listen(port, host, (error) => {
  if (error) {
    console.error('Failed to start MCP demo server:', error);
    process.exit(1);
  }
  console.log(`Moss demo HTTP MCP server listening at http://${host}:${port}${endpoint}`);
});

process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0));
});
