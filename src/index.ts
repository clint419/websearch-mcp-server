#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { webfetch, MAX_TIMEOUT_SECONDS } from "./webfetch.js";
import { search, getProvider, getMaxRetries } from "./websearch.js";

const server = new McpServer({
  name: "websearch",
  version: "1.1.0",
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

server.tool(
  "webfetch",
  "Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML. Markdown is the default.",
  {
    url: z.string().describe("The HTTP or HTTPS URL to fetch content from"),
    format: z.enum(["text", "markdown", "html"]).optional().describe("The format to return the content in (default: markdown)"),
    timeout: z.number().positive().max(MAX_TIMEOUT_SECONDS).optional().describe(`Optional timeout in seconds (max: ${MAX_TIMEOUT_SECONDS})`),
  },
  async (args) => {
    try {
      const result = await webfetch(args.url, args.format ?? "markdown", args.timeout);
      return { content: [{ type: "text" as const, text: result.output }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Fetch failed: ${message}` }], isError: true };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`websearch-mcp-server running (provider: ${getProvider()}, retries: ${getMaxRetries()}, failover: enabled)`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
