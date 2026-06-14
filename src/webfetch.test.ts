import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { webfetch, extractTextFromHTML, convertHTMLToMarkdown, MAX_RESPONSE_BYTES } from "./webfetch.js"

describe("extractTextFromHTML", () => {
  it("extracts text from simple HTML", () => {
    const html = "<html><body><p>Hello world</p></body></html>"
    expect(extractTextFromHTML(html)).toBe("Hello world")
  })

  it("skips script and style content", () => {
    const html = "<html><script>var x=1</script><body><p>Hello</p><style>.c{color:red}</style></body></html>"
    expect(extractTextFromHTML(html)).toBe("Hello")
  })

  it("handles text between skip tags", () => {
    const html = "<body>a<script>x</script>b<style>c</style>d</body>"
    // "a" and "b" and "d" are outside skip tags; "x" and "c" are skipped
    expect(extractTextFromHTML(html)).toBe("abd")
  })

  it("returns empty string for empty HTML", () => {
    expect(extractTextFromHTML("")).toBe("")
  })

  it("handles HTML with no text", () => {
    const html = "<html><head><title></title></head><body><div></div></body></html>"
    expect(extractTextFromHTML(html)).toBe("")
  })
})

describe("convertHTMLToMarkdown", () => {
  it("converts headings", () => {
    const html = "<h1>Title</h1><h2>Subtitle</h2>"
    expect(convertHTMLToMarkdown(html)).toBe("# Title\n\n## Subtitle")
  })

  it("converts links", () => {
    const html = '<a href="https://example.com">click here</a>'
    expect(convertHTMLToMarkdown(html)).toBe("[click here](https://example.com)")
  })

  it("converts bold and italic", () => {
    const html = "<strong>bold</strong> and <em>italic</em>"
    const result = convertHTMLToMarkdown(html)
    expect(result).toContain("**bold**")
    expect(result).toContain("*italic*")
  })

  it("removes script and style tags", () => {
    const html = "<div>text</div><script>alert(1)</script><style>.c{}</style>"
    expect(convertHTMLToMarkdown(html)).toBe("text")
  })

  it("returns empty for empty input", () => {
    expect(convertHTMLToMarkdown("")).toBe("")
  })
})

describe("webfetch", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("rejects non-http/https URLs", async () => {
    await expect(webfetch("ftp://example.com")).rejects.toThrow("URL must use http:// or https://")
    await expect(webfetch("file:///tmp/test")).rejects.toThrow("URL must use http:// or https://")
  })

  it("rejects invalid URLs", async () => {
    await expect(webfetch("not-a-url")).rejects.toThrow()
  })

  it("fetches and returns text format", async () => {
    const body = new TextEncoder().encode("<html><body><p>Hello</p></body></html>")
    const reader = new ReadableStream({
      start(controller) {
        controller.enqueue(body)
        controller.close()
      },
    }).getReader()

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      body: { getReader: () => reader },
    } as Response)

    const result = await webfetch("https://example.com", "text")
    expect(result.url).toBe("https://example.com")
    expect(result.format).toBe("text")
    expect(result.output).toBe("Hello")
  })

  it("fetches and returns markdown (default)", async () => {
    const body = new TextEncoder().encode("<h1>Title</h1>")
    const reader = new ReadableStream({
      start(controller) {
        controller.enqueue(body)
        controller.close()
      },
    }).getReader()

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      body: { getReader: () => reader },
    } as Response)

    const result = await webfetch("https://example.com")
    expect(result.format).toBe("markdown")
    expect(result.output).toBe("# Title")
  })

  it("rejects image MIME types", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "image/png" }),
      body: { getReader: () => new ReadableStream().getReader() },
    } as Response)

    await expect(webfetch("https://example.com/image.png")).rejects.toThrow("Unsupported fetched image content type")
  })

  it("throws on HTTP error", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
    } as Response)

    await expect(webfetch("https://example.com/404")).rejects.toThrow("HTTP 404 Not Found")
  })

  it("retries on network failure", async () => {
    vi.mocked(globalThis.fetch)
      .mockRejectedValueOnce(new Error("network error"))
      .mockRejectedValueOnce(new Error("network error again"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/plain" }),
        body: { getReader: () => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("ok")); c.close() } }).getReader() },
      } as Response)

    const result = await webfetch("https://example.com")
    expect(result.output).toBe("ok")
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(3)
  })

  it("fails after exhausting retries", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("persistent failure"))

    await expect(webfetch("https://example.com")).rejects.toThrow("persistent failure")
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(3)
  })

  it("rejects oversized responses", async () => {
    const oversized = new TextEncoder().encode("x".repeat(MAX_RESPONSE_BYTES + 1))
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/plain" }),
      body: { getReader: () => new ReadableStream({ start(c) { c.enqueue(oversized); c.close() } }).getReader() },
    } as Response)

    await expect(webfetch("https://example.com")).rejects.toThrow(`exceeds ${MAX_RESPONSE_BYTES} byte limit`)
  })
})
