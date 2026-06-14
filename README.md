# websearch-mcp-server

Standalone MCP server for Exa/Parallel free web search + URL content fetching. Works with Cursor, Claude Code, Cline, Continue, opencode, and any MCP-compatible AI client.

## Tools

| Tool | Description |
|------|-------------|
| `websearch` | Search the web via Exa or Parallel free MCP endpoints |
| `webfetch` | Fetch content from an HTTP/HTTPS URL as text/markdown/html |

## Install

### From npm (recommended)

```bash
npm install -g @clint419/websearch-mcp-server
```

### From source

```bash
git clone https://github.com/clint419/websearch-mcp-server.git
cd websearch-mcp-server
npm install
npm run build
```

## Configure

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "websearch": {
      "command": "npx",
      "args": ["-y", "@clint419/websearch-mcp-server"]
    }
  }
}
```

### Claude Code

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "websearch": {
      "command": "npx",
      "args": ["-y", "@clint419/websearch-mcp-server"]
    }
  }
}
```

### Cline / Continue

Same pattern. Add to their MCP config with the command above.

### Local development

```json
{
  "command": "npx",
  "args": ["tsx", "/path/to/websearch-mcp-server/src/index.ts"]
}
```

## Environment Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `WEBSEARCH_PROVIDER` | `exa`, `parallel` | `exa` | Which upstream to use |
| `EXA_API_KEY` | string | (none) | Optional Exa API key |
| `PARALLEL_API_KEY` | string | (none) | Optional Parallel API key |

## Source Structure

```
src/
  index.ts      – MCP server entry: tool registration, main loop
  websearch.ts  – Exa/Parallel MCP client with retry + failover
  webfetch.ts   – URL content fetcher (HTML→text/markdown conversion)
```

## Reliability

- **Retry**: Up to 2 retries with exponential backoff (1s, 2s) on network errors
- **Failover**: If primary provider fails, automatically tries the other provider
- **Timeout**: 25s per request
- **Free tier**: No API key required by default

## License

MIT
