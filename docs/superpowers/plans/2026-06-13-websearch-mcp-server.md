# Websearch MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone MCP server that exposes Exa/Parallel free web search endpoints as a `websearch` tool for any MCP-compatible AI client.

**Architecture:** Lightweight TypeScript MCP server using `@modelcontextprotocol/sdk`. stdio transport. Proxies requests to Exa or Parallel remote MCP endpoints via HTTP POST JSON-RPC 2.0.

**Tech Stack:** TypeScript, Node.js 18+, `@modelcontextprotocol/sdk`, `zod`

---

## File Structure

```
websearch-mcp-server/
├── src/
│   └── server.ts              # MCP server + tool registration + Exa/Parallel client
├── package.json               # Dependencies
├── tsconfig.json              # TypeScript config
├── README.md                  # Usage docs
└── docs/superpowers/plans/
    └── 2026-06-13-websearch-mcp-server.md  # This file
```

## Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "websearch-mcp-server",
  "version": "1.0.0",
  "description": "Standalone MCP server for Exa/Parallel free web search",
  "type": "module",
  "main": "dist/server.js",
  "bin": {
    "websearch-mcp": "dist/server.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors (no source files yet, so clean pass)

- [ ] **Step 5: Commit**

```bash
git init && git add package.json tsconfig.json
git commit -m "chore: init project with MCP SDK dependency"
```

---

## Task 2: Implement MCP Server

**Files:**
- Create: `src/server.ts`

- [ ] **Step 1: Write server.ts with MCP server setup and Exa/Parallel client**

```typescript
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
  "Search the web using the session's web search provider. Returns current information beyond knowledge cutoff.",
  {
    query: z.string().describe("Search query"),
    numResults: z.number().optional().describe("Number of search results to return (default: 8, max: 20)"),
    type: z.enum(["auto", "fast", "deep"]).optional().describe("Search type (default: auto)"),
    livecrawl: z.enum(["fallback", "preferred"]).optional().describe("Live crawl mode (default: fallback)"),
    contextMaxCharacters: z.number().optional().describe("Max context characters for LLM (default: 10000)"),
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
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: `dist/server.js` created with no errors

- [ ] **Step 3: Test manually with MCP Inspector**

Run: `npx @modelcontextprotocol/inspector node dist/server.js`
Expected: Inspector connects, shows `websearch` tool

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: implement websearch MCP server with Exa/Parallel support"
```

---

## Task 3: Documentation

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

(See project README.md for content - covers Quick Start, Usage for Cursor/Claude Code/Cline, Environment Variables, How It Works, Tool parameters)

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add usage guide for Cursor, Claude Code, Cline"
```

---

## Task 4: End-to-End Verification

- [ ] **Step 1: Build fresh**

Run: `rm -rf dist && npm run build`
Expected: Clean build, `dist/server.js` exists

- [ ] **Step 2: Test with stdio echo**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"capabilities":{},"clientInfo":{"name":"test"}}}' | node dist/server.js`
Expected: Server responds with initialize result (JSON on stdout)

- [ ] **Step 3: Verify tool listing**

Run: `echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node dist/server.js`
Expected: Returns `websearch` tool with parameters

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: v1.0.0 release"
```
