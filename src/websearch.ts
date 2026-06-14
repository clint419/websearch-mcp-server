const EXA_URL = "https://mcp.exa.ai/mcp";
const PARALLEL_URL = "https://search.parallel.ai/mcp";

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;
const TIMEOUT_MS = 25_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

const PROVIDER = (process.env.WEBSEARCH_PROVIDER || "exa") as "exa" | "parallel";

export function getProvider() {
  return PROVIDER;
}

export function getMaxRetries() {
  return MAX_RETRIES;
}

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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.error(`[${label}] attempt ${attempt + 1} failed: ${lastError.message}, retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  throw lastError!;
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
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES)
      throw new Error(`Exa response exceeded ${MAX_RESPONSE_BYTES} bytes`);
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
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(PARALLEL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Parallel returned ${res.status}`);
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES)
      throw new Error(`Parallel response exceeded ${MAX_RESPONSE_BYTES} bytes`);
    return parseResponse(text) || "No results found.";
  } finally {
    clearTimeout(timeout);
  }
}

type ExaArgs = {
  query: string;
  numResults?: number;
  type?: string;
  livecrawl?: string;
  contextMaxCharacters?: number;
};

type ParallelArgs = {
  query: string;
  numResults?: number;
};

async function searchWithFailover(
  primary: "exa" | "parallel",
  exaArgs: ExaArgs,
  parallelArgs: ParallelArgs,
): Promise<string> {
  const tryExa = () => retry(() => callExa(exaArgs), "exa");
  const tryParallel = () => retry(() => callParallel(parallelArgs), "parallel");

  if (primary === "exa") {
    try {
      return await tryExa();
    } catch (firstError) {
      console.error(`[failover] exa failed, trying parallel: ${firstError instanceof Error ? firstError.message : firstError}`);
      return await tryParallel();
    }
  }

  try {
    return await tryParallel();
  } catch (firstError) {
    console.error(`[failover] parallel failed, trying exa: ${firstError instanceof Error ? firstError.message : firstError}`);
    return await tryExa();
  }
}

export async function search(args: {
  query: string;
  numResults?: number;
  type?: string;
  livecrawl?: string;
  contextMaxCharacters?: number;
}): Promise<string> {
  const exaArgs: ExaArgs = {
    query: args.query,
    numResults: args.numResults,
    type: args.type,
    livecrawl: args.livecrawl,
    contextMaxCharacters: args.contextMaxCharacters,
  };

  const parallelArgs: ParallelArgs = {
    query: args.query,
    numResults: args.numResults,
  };

  return searchWithFailover(PROVIDER, exaArgs, parallelArgs);
}
