# websearch-mcp-server

Standalone MCP server exposing Exa/Parallel free web search endpoints. Works with any MCP-compatible AI client (Cursor, Claude Code, Cline, Continue, opencode, etc.).

## Quick Start

```bash
npm install
npm run build
```

## Usage

### Cursor
Add to `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "websearch": {
      "command": "npx",
      "args": ["tsx", "/Users/suyanlong/github/websearch-mcp-server/src/server.ts"],
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
      "args": ["tsx", "/Users/suyanlong/github/websearch-mcp-server/src/server.ts"],
      "env": {
        "WEBSEARCH_PROVIDER": "exa"
      }
    }
  }
}
```

### Cline / Continue
Same pattern - add to their MCP config with the command above.

### Pre-built (faster startup)
If you prefer running the compiled JS directly:
```json
{
  "command": "node",
  "args": ["/Users/suyanlong/github/websearch-mcp-server/dist/server.js"]
}
```

### Cline / Continue
Same pattern - add to their MCP config with the command above.

## Environment Variables

| Variable | Options | Default | Description |
|----------|---------|---------|-------------|
| `WEBSEARCH_PROVIDER` | `exa`, `parallel` | `exa` | Which upstream to use |
| `EXA_API_KEY` | string | (none) | Optional Exa API key |
| `PARALLEL_API_KEY` | string | (none) | Optional Parallel API key |

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

## Tool

**`websearch`** - Search the web

Parameters:
- `query` (string, required) - Search query
- `numResults` (number, optional) - Number of results (default: 8, max: 20)
- `type` (string, optional) - Search type: `auto`, `fast`, `deep` (default: `auto`)
- `livecrawl` (string, optional) - Live crawl: `fallback`, `preferred` (default: `fallback`)
- `contextMaxCharacters` (number, optional) - Max context chars (default: 10000)

## License

MIT
