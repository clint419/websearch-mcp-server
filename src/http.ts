#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { getProvider, getMaxRetries } from "./websearch.js";

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";

const port = Number(process.env.MCP_PORT ?? DEFAULT_PORT);
const host = process.env.MCP_HOST ?? DEFAULT_HOST;

type McpRequest = IncomingMessage & { body?: unknown };
type McpResponse = ServerResponse;

const app = createMcpExpressApp({ host });
const transports = new Map<string, StreamableHTTPServerTransport>();

function getSessionId(header: string | string[] | undefined): string | undefined {
  return typeof header === "string" ? header : undefined;
}

function badRequest(res: McpResponse, message: string): void {
  res.statusCode = 400;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  }));
}

async function handlePost(req: McpRequest, res: McpResponse): Promise<void> {
  const sessionId = getSessionId(req.headers["mcp-session-id"]);

  try {
    const existing = sessionId ? transports.get(sessionId) : undefined;
    if (existing) {
      await existing.handleRequest(req, res, req.body);
      return;
    }

    if (sessionId) {
      badRequest(res, "Bad Request: Unknown session ID");
      return;
    }

    if (!isInitializeRequest(req.body)) {
      badRequest(res, "Bad Request: No valid session ID provided");
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport);
      },
    });

    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) transports.delete(id);
    };

    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling MCP POST:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      }));
    }
  }
}

async function handleSessionRequest(req: McpRequest, res: McpResponse, action: string): Promise<void> {
  const sessionId = getSessionId(req.headers["mcp-session-id"]);
  const transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    res.statusCode = 400;
    res.end(`Invalid or missing session ID for ${action}`);
    return;
  }

  try {
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error(`Error handling MCP ${action}:`, err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end(`Error processing ${action}`);
    }
  }
}

app.post("/mcp", (req: McpRequest, res: McpResponse) => { void handlePost(req, res); });
app.get("/mcp", (req: McpRequest, res: McpResponse) => { void handleSessionRequest(req, res, "GET"); });
app.delete("/mcp", (req: McpRequest, res: McpResponse) => { void handleSessionRequest(req, res, "DELETE"); });

app.listen(port, host, () => {
  console.error(
    `websearch-mcp-server HTTP running at http://${host}:${port}/mcp ` +
    `(provider: ${getProvider()}, retries: ${getMaxRetries()}, failover: enabled)`,
  );
});

async function shutdown(): Promise<void> {
  for (const [id, transport] of transports) {
    try {
      await transport.close();
      transports.delete(id);
    } catch (err) {
      console.error(`Error closing transport for session ${id}:`, err);
    }
  }
  process.exit(0);
}

process.on("SIGINT", () => {
  console.error("Shutting down HTTP server...");
  void shutdown();
});

process.on("SIGTERM", () => {
  console.error("Shutting down HTTP server...");
  void shutdown();
});
