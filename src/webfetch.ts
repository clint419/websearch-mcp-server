import { Parser } from "htmlparser2"
import TurndownService from "turndown"

export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
export const DEFAULT_TIMEOUT_SECONDS = 30
export const MAX_TIMEOUT_SECONDS = 120

type Format = "text" | "markdown" | "html"

const browserUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"

function acceptHeader(format: Format) {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
  }
}

function headers(format: Format) {
  return {
    "User-Agent": browserUserAgent,
    Accept: acceptHeader(format),
    "Accept-Language": "en-US,en;q=0.9",
  }
}

function mimeFrom(contentType: string) {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? ""
}

function isImageAttachment(mime: string) {
  return mime.startsWith("image/") && mime !== "image/svg+xml"
}

function isTextualMime(mime: string) {
  return (
    !mime ||
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime.endsWith("+json") ||
    mime === "application/xml" ||
    mime.endsWith("+xml") ||
    mime === "application/javascript" ||
    mime === "application/x-javascript"
  )
}

function convert(content: string, contentType: string, format: Format) {
  if (!contentType.includes("text/html")) return content
  if (format === "markdown") return convertHTMLToMarkdown(content)
  if (format === "text") return extractTextFromHTML(content)
  return content
}

export function extractTextFromHTML(html: string) {
  let text = ""
  let skipDepth = 0
  const parser = new Parser({
    onopentag(name) {
      if (skipDepth > 0 || ["script", "style", "noscript", "iframe", "object", "embed"].includes(name)) skipDepth++
    },
    ontext(input) {
      if (skipDepth === 0) text += input
    },
    onclosetag() {
      if (skipDepth > 0) skipDepth--
    },
  })
  parser.write(html)
  parser.end()
  return text.trim()
}

export function convertHTMLToMarkdown(html: string) {
  const turndown = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndown.remove(["script", "style", "meta", "link"])
  return turndown.turndown(html)
}

export async function webfetch(urlStr: string, format: Format = "markdown", timeoutSec = DEFAULT_TIMEOUT_SECONDS) {
  const url = new URL(urlStr)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use http:// or https://")
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutSec * 1000)

  try {
    let res = await fetch(urlStr, {
      headers: headers(format),
      signal: controller.signal,
      redirect: "follow",
    })

    if (res.status === 403 && res.headers.get("cf-mitigated") === "challenge") {
      console.error("[webfetch] Cloudflare challenge detected, retrying without browser UA")
      res = await fetch(urlStr, {
        headers: {
          ...headers(format),
          "User-Agent": "opencode",
        },
        signal: controller.signal,
        redirect: "follow",
      })
    }

    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)

    const contentType = res.headers.get("content-type") || ""
    const mime = mimeFrom(contentType)

    if (isImageAttachment(mime)) throw new Error(`Unsupported fetched image content type: ${mime}`)
    if (!isTextualMime(mime)) throw new Error(`Unsupported fetched file content type: ${mime}`)

    const contentLength = res.headers.get("content-length")
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      throw new Error(`Response too large (exceeds ${MAX_RESPONSE_BYTES} byte limit)`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error("Response body is not readable")

    const chunks: Uint8Array[] = []
    let size = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) throw new Error(`Response too large (exceeds ${MAX_RESPONSE_BYTES} byte limit)`)
      chunks.push(value)
    }

    const body = Buffer.concat(chunks)
    const content = convert(new TextDecoder().decode(body), contentType, format)

    return {
      url: urlStr,
      contentType,
      format,
      output: content,
    }
  } finally {
    clearTimeout(timeout)
  }
}
