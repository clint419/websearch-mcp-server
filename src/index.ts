#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { getProvider, getMaxRetries } from "./websearch.js";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`websearch-mcp-server running (provider: ${getProvider()}, retries: ${getMaxRetries()}, failover: enabled)`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
