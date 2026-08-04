#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import * as z from 'zod/v4';

const port = Number.parseInt(process.env.PORT || '3020', 10);
const host = process.env.HOST || '127.0.0.1';
const sseEndpoint = '/sse';
const messagesEndpoint = '/messages';

function createDemoServer() {
  const server = new McpServer({
    name: 'moss-demo-sse-mcp',
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
    'demo://moss/sse-mcp/readme',
    {
      title: 'Moss SSE MCP Demo',
      mimeType: 'text/plain',
    },
    async uri => ({
      contents: [
        {
          uri: uri.href,
          text: 'This resource is served by examples/mcp-sse-server-demo.mjs.',
        },
      ],
    }),
  );

  return server;
}

const app = createMcpExpressApp();
const transports = new Map();

app.get(sseEndpoint, async (_req, res) => {
  const transport = new SSEServerTransport(messagesEndpoint, res);
  const server = createDemoServer();

  transports.set(transport.sessionId, { transport, server });
  res.on('close', () => {
    transports.delete(transport.sessionId);
    void server.close();
  });

  try {
    await server.connect(transport);
  } catch (error) {
    console.error('MCP SSE connection failed:', error);
    transports.delete(transport.sessionId);
    if (!res.headersSent) {
      res.status(500).send('MCP SSE connection failed');
    }
  }
});

app.post(messagesEndpoint, async (req, res) => {
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
  const entry = sessionId ? transports.get(sessionId) : undefined;

  if (!entry) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'No SSE transport found for sessionId',
      },
      id: null,
    });
    return;
  }

  try {
    await entry.transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error('MCP SSE message failed:', error);
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

app.all(sseEndpoint, (_req, res) => {
  res.status(405).set('Allow', 'GET').send('Method Not Allowed');
});

app.all(messagesEndpoint, (_req, res) => {
  res.status(405).set('Allow', 'POST').send('Method Not Allowed');
});

const httpServer = app.listen(port, host, error => {
  if (error) {
    console.error('Failed to start MCP SSE demo server:', error);
    process.exit(1);
  }
  console.log(`Moss demo SSE MCP server listening at http://${host}:${port}${sseEndpoint}`);
});

process.on('SIGINT', async () => {
  for (const { transport, server } of transports.values()) {
    try {
      await transport.close();
    } catch {}
    try {
      await server.close();
    } catch {}
  }
  httpServer.close(() => process.exit(0));
});
