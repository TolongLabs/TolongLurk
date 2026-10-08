import { mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { ReplyFetchContext } from '../src/replies/types.js'

export function replyFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/replies/${name}`, import.meta.url), 'utf8')
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

export function replyContext(overrides: Partial<ReplyFetchContext> = {}): ReplyFetchContext {
  return {
    fetcher: mock(async () => jsonResponse({})) as unknown as typeof fetch,
    runExtractor: mock(async () => ({ reason: 'unused' })),
    ytDlpPath: 'yt-dlp',
    signal: new AbortController().signal,
    maxReplies: 5,
    maxReplyChars: 280,
    youtubeApiKey: 'test-youtube-key',
    timeoutMs: 6000,
    ...overrides
  }
}

function call(fetcher: unknown, index: number): unknown[] {
  return (fetcher as { mock: { calls: unknown[][] } }).mock.calls[index]
}

export function requestedUrl(fetcher: unknown, index = 0): URL {
  return new URL(String(call(fetcher, index)[0]))
}

export function requestedHeaders(fetcher: unknown, index = 0): Headers {
  return new Headers((call(fetcher, index)[1] as RequestInit | undefined)?.headers)
}
