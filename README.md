# websearch-mcp-server

Standalone MCP server for Exa/Parallel free web search. Works with Cursor, Claude Code, Cline, Continue, opencode, and any MCP-compatible AI client.

## Install

### From npm (recommended)

```bash
npm install -g websearch-mcp-server
```

### From source

```bash
git clone https://github.com/your-user/websearch-mcp-server.git
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
      "args": ["-y", "websearch-mcp-server"],
      "env": {
        "WEBSEARCH_PROVIDER": "exa"
      }
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
      "args": ["-y", "websearch-mcp-server"],
      "env": {
        "WEBSEARCH_PROVIDER": "exa"
      }
    }
  }
}
```

### Cline / Continue

Same pattern. Add to their MCP config with the command above.

### Local development

If running from source instead of npm:

```json
{
  "command": "npx",
  "args": ["tsx", "/path/to/websearch-mcp-server/src/server.ts"]
}
```

## Environment Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `WEBSEARCH_PROVIDER` | `exa`, `parallel` | `exa` | Which upstream to use |
| `EXA_API_KEY` | string | (none) | Optional Exa API key |
| `PARALLEL_API_KEY` | string | (none) | Optional Parallel API key |

## Tool

**`websearch`** - Search the web

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | - | Search query |
| `numResults` | number | no | 8 | Number of results (max: 20) |
| `type` | string | no | `auto` | `auto`, `fast`, `deep` |
| `livecrawl` | string | no | `fallback` | `fallback`, `preferred` |
| `contextMaxCharacters` | number | no | 10000 | Max context chars for LLM |

## How It Works

```
AI Client (Cursor/Claude Code/etc.)
    ↓ stdio JSON-RPC
[websearch-mcp-server]
    ↓ HTTP POST JSON-RPC 2.0
Exa / Parallel remote MCP endpoint
    ↓ results
[websearch-mcp-server] → AI Client
```

- No API key required by default (uses free tier)
- 25s timeout per request
- Supports both JSON and SSE response formats

## License

MIT
