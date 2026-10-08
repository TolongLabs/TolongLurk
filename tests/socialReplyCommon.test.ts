import { describe, expect, it, mock } from 'bun:test'
import { compactReplyText, failed, fetchJson, found, rankReplies, takeReplies } from '../src/replies/common.js'
import { jsonResponse, replyContext } from './replyFetchTestContext.js'

describe('compactReplyText', () => {
  it('collapses whitespace and caps the length', () => {
    expect(compactReplyText('  a\n\n b\tc  ', 280)).toBe('a b c')
    expect(compactReplyText('abcdef', 3)).toBe('abc')
  })

  // Review Focus 3: a cap landing inside an emoji must not leave half a surrogate pair behind.
  it('never splits an emoji at the cap', () => {
    const capped = compactReplyText(`${'a'.repeat(279)}😀😀`, 280)

    expect(capped).toBe(`${'a'.repeat(279)}😀`)
    expect(capped).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
  })
})

describe('rankReplies', () => {
  it('ranks by likes, breaks ties by tiebreak then source order, drops unreadable replies, and caps', () => {
    const ranked = rankReplies(
      [
        { author: 'a', text: 'low', likes: 1 },
        { author: 'b', text: '[deleted]', likes: 900 },
        { author: 'c', text: 'tie, fewer views', likes: 50, tiebreak: 10 },
        { author: 'd', text: 'tie, more views', likes: 50, tiebreak: 99 },
        { author: 'e', text: '   ', likes: 800 },
        { author: 'f', text: 'unknown likes', likes: null },
        { author: 'g', text: 'top', likes: 70 }
      ],
      4,
      280
    )

    expect(ranked).toEqual([
      { author: 'g', text: 'top', likes: 70 },
      { author: 'd', text: 'tie, more views', likes: 50 },
      { author: 'c', text: 'tie, fewer views', likes: 50 },
      { author: 'a', text: 'low', likes: 1 }
    ])
  })

  it('places replies with unknown likes after counted ones', () => {
    expect(
      rankReplies(
        [
          { author: 'x', text: 'n', likes: null },
          { author: 'y', text: 'z', likes: 0 }
        ],
        5,
        280
      )
    ).toEqual([
      { author: 'y', text: 'z', likes: 0 },
      { author: 'x', text: 'n', likes: null }
    ])
  })
})

describe('takeReplies', () => {
  it('keeps source order while dropping unreadable replies and capping', () => {
    expect(
      takeReplies(
        [
          { author: 'a', text: 'first', likes: null },
          { author: '', text: '[removed]', likes: null },
          { author: 'b', text: 'second', likes: null },
          { author: 'c', text: 'third', likes: null }
        ],
        2,
        280
      )
    ).toEqual([
      { author: 'a', text: 'first', likes: null },
      { author: 'b', text: 'second', likes: null }
    ])
  })
})

describe('fetchJson', () => {
  it('returns the parsed body and passes the context signal', async () => {
    const fetcher = mock(async () => jsonResponse({ ok: 1 }))
    const context = replyContext({ fetcher: fetcher as unknown as typeof fetch })

    expect(await fetchJson(context, new URL('https://example.test/a'))).toEqual({ ok: true, body: { ok: 1 } })
    expect((fetcher.mock.calls[0] as unknown[])[1]).toMatchObject({ signal: context.signal })
  })

  it('reports a non-OK status and an unparseable body as reasons', async () => {
    const notFound = replyContext({ fetcher: mock(async () => jsonResponse({}, 404)) as unknown as typeof fetch })
    const html = replyContext({ fetcher: mock(async () => jsonResponse('<html>')) as unknown as typeof fetch })

    expect(await fetchJson(notFound, new URL('https://example.test/a'))).toEqual({ ok: false, reason: 'http_404' })
    expect(await fetchJson(html, new URL('https://example.test/a'))).toEqual({ ok: false, reason: 'invalid_json' })
  })
})

describe('result constructors', () => {
  it('builds found and failed lookups', () => {
    expect(found('x', [], 3)).toEqual({ status: 'found', platform: 'x', replies: [], total: 3 })
    expect(failed('reddit', 'http_429')).toEqual({ status: 'failed', platform: 'reddit', reason: 'http_429' })
  })
})
