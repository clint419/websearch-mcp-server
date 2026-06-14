import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// parseResponse is not exported, so we test via search() with mocked fetch
import { search, getProvider, getMaxRetries } from "./websearch.js"

describe("getProvider / getMaxRetries", () => {
  it("returns expected defaults", () => {
    expect(["exa", "parallel"]).toContain(getProvider())
    expect(getMaxRetries()).toBe(2)
  })
})

describe("search", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("returns search results from Exa", async () => {
    const responseText = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "Title: Rust vs Go\nURL: https://example.com\nHighlights:\nComparison of Rust and Go." }],
      },
    })

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: () => Promise.resolve(responseText),
    } as Response)

    const result = await search({ query: "rust vs go" })
    expect(result).toContain("Rust vs Go")
    expect(result).toContain("Comparison")
  })

  it("returns results from Parallel via failover when Exa fails", async () => {
    vi.mocked(globalThis.fetch)
      .mockRejectedValueOnce(new Error("Exa timeout")) // Exa fails
      .mockResolvedValueOnce({ // Exa retry 1
        ok: false, status: 500, headers: new Headers({ "content-type": "application/json" }),
        text: () => Promise.resolve(""),
      } as Response)
      .mockResolvedValueOnce({ // Exa retry 2
        ok: false, status: 503, headers: new Headers({ "content-type": "application/json" }),
        text: () => Promise.resolve(""),
      } as Response)
      .mockResolvedValueOnce({ // Parallel (failover)
        ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
        text: () => Promise.resolve(JSON.stringify({
          jsonrpc: "2.0", id: 1, result: {
            content: [{ type: "text", text: "Title: Parallel result\nURL: https://example.com" }],
          },
        })),
      } as Response)

    // Set env to exa to ensure primary fails first
    vi.stubEnv("WEBSEARCH_PROVIDER", "exa")

    const result = await search({ query: "rust" })
    expect(result).toContain("Parallel result")
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(4)

    vi.unstubAllEnvs()
  })

  it("handles empty results", async () => {
    const responseText = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "" }],
      },
    })

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: () => Promise.resolve(responseText),
    } as Response)

    const result = await search({ query: "nothing" })
    expect(result).toBe("No results found.")
  })

  it("handles SSE response format", async () => {
    const sseBody = "data: " + JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "Title: SSE Result\nURL: https://example.com" }],
      },
    }) + "\n"

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/event-stream" }),
      text: () => Promise.resolve(sseBody),
    } as Response)

    const result = await search({ query: "sse test" })
    expect(result).toContain("SSE Result")
  })

  it("handles search failure", { timeout: 15000 }, async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("Network unreachable"))

    await expect(search({ query: "test" })).rejects.toThrow("Network unreachable")
  })
})
