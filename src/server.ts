#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const EXA_URL = "https://mcp.exa.ai/mcp";
const PARALLEL_URL = "https://search.parallel.ai/mcp";

const PROVIDER = (process.env.WEBSEARCH_PROVIDER || "exa") as "exa" | "parallel";

interface McpRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

function mcpRequest(tool: string, args: Record<string, unknown>): McpRpcRequest {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: tool, arguments: args },
  };
}

function parseResponse(body: string): string | undefined {
  const trimmed = body.trim();

  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      const text = data?.result?.content?.find((c: { type: string; text: string }) => c.type === "text")?.text;
      if (text) return text;
    } catch {}
  }

  for (const line of trimmed.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const data = JSON.parse(line.slice(6));
      const text = data?.result?.content?.find((c: { type: string; text: string }) => c.type === "text")?.text;
      if (text) return text;
    } catch {}
  }

  return undefined;
}

async function callExa(args: {
  query: string;
  numResults?: number;
  type?: string;
  livecrawl?: string;
  contextMaxCharacters?: number;
}): Promise<string> {
  const url = process.env.EXA_API_KEY
    ? `${EXA_URL}?exaApiKey=${encodeURIComponent(process.env.EXA_API_KEY)}`
    : EXA_URL;

  const body = mcpRequest("web_search_exa", {
    query: args.query,
    type: args.type || "auto",
    numResults: args.numResults || 8,
    livecrawl: args.livecrawl || "fallback",
    ...(args.contextMaxCharacters && { contextMaxCharacters: args.contextMaxCharacters }),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Exa returned ${res.status}`);
    const text = await res.text();
    return parseResponse(text) || "No results found.";
  } finally {
    clearTimeout(timeout);
  }
}

async function callParallel(args: {
  query: string;
  numResults?: number;
  sessionId?: string;
  modelName?: string;
}): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "User-Agent": "websearch-mcp-server/1.0.0",
  };

  if (process.env.PARALLEL_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.PARALLEL_API_KEY}`;
  }

  const body = mcpRequest("web_search", {
    objective: args.query,
    search_queries: [args.query],
    ...(args.sessionId && { session_id: args.sessionId }),
    ...(args.modelName && { model_name: args.modelName }),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const res = await fetch(PARALLEL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Parallel returned ${res.status}`);
    const text = await res.text();
    return parseResponse(text) || "No results found.";
  } finally {
    clearTimeout(timeout);
  }
}

async function search(args: {
  query: string;
  numResults?: number;
  type?: string;
  livecrawl?: string;
  contextMaxCharacters?: number;
}): Promise<string> {
  if (PROVIDER === "parallel") {
    return callParallel({
      query: args.query,
      numResults: args.numResults,
    });
  }
  return callExa(args);
}

const server = new McpServer({
  name: "websearch",
  version: "1.0.0",
});

server.tool(
  "websearch",
  "Search the web for current information. Returns LLM-optimized summaries with titles, URLs, dates, and key highlights. Use for current events, documentation, library usage examples, or any topic beyond your knowledge cutoff.",
  {
    query: z.string().describe("Natural language search query. Be specific for better results — describe what you want to find, not just keywords."),
    numResults: z.number().optional().describe("Number of results to return. More results = more context but higher token cost. Default: 8, Max: 20."),
    type: z.enum(["auto", "fast", "deep"]).optional().describe("Search depth. 'fast' = quick lookup (1-3s), 'deep' = comprehensive analysis (5-10s), 'auto' = balance. Default: auto."),
    livecrawl: z.enum(["fallback", "preferred"]).optional().describe("Live crawl strategy. 'preferred' = always crawl latest content (slower), 'fallback' = use cached results when available (faster). Default: fallback."),
    contextMaxCharacters: z.number().optional().describe("Max characters in response. Lower = less context, higher = more detail. Default: 10000."),
  },
  async (args) => {
    try {
      const result = await search(args);
      return { content: [{ type: "text" as const, text: result }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Search failed: ${message}` }], isError: true };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`websearch-mcp-server running (provider: ${PROVIDER})`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
