#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

const server = new McpServer({
  name: 'moss-demo-stdio-mcp',
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
  'demo://moss/stdio-mcp/readme',
  {
    title: 'Moss STDIO MCP Demo',
    mimeType: 'text/plain',
  },
  async uri => ({
    contents: [
      {
        uri: uri.href,
        text: 'This resource is served by examples/mcp-stdio-server-demo.mjs.',
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
