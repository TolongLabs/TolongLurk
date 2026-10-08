import { describe, expect, it, mock } from 'bun:test'
import { fetchTikTokReplies } from '../src/replies/tiktok.js'
import { parseSocialPostUrl } from '../src/urls.js'
import { jsonResponse, replyContext, replyFixture, requestedHeaders, requestedUrl } from './replyFetchTestContext.js'

const target = parseSocialPostUrl('https://www.tiktok.com/@pokemonlife22/video/7059698374567611694')!

function contextFor(body: unknown, status = 200) {
  return replyContext({ fetcher: mock(async () => jsonResponse(body, status)) as unknown as typeof fetch })
}

describe('fetchTikTokReplies', () => {
  it('requests a pool of 50 comments for the video with a browser user agent', async () => {
    const context = contextFor(replyFixture('tiktok-comment-list.json'))

    await fetchTikTokReplies(target, context)

    const url = requestedUrl(context.fetcher)
    expect(`${url.origin}${url.pathname}`).toBe('https://www.tiktok.com/api/comment/list/')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      aweme_id: '7059698374567611694',
      count: '50',
      cursor: '0',
      aid: '1988'
    })
    expect(requestedHeaders(context.fetcher).get('user-agent')).toContain('Mozilla/5.0')
  })

  it('ranks comments by likes and drops empty ones', async () => {
    expect(await fetchTikTokReplies(target, contextFor(replyFixture('tiktok-comment-list.json')))).toEqual({
      status: 'found',
      platform: 'tiktok',
      total: 6,
      replies: [
        { author: 'collector_b', text: 'great pull', likes: 15 },
        { author: 'collector_d', text: 'which set is this', likes: 15 },
        { author: 'collector_f', text: 'lucky', likes: 8 },
        { author: 'collector_c', text: 'nice', likes: 3 },
        { author: 'collector_a', text: 'first!', likes: 0 }
      ]
    })
  })

  // Review Focus 5: under a bot check TikTok answers 200 with an empty body or an HTML page.
  it('fails on a TikTok error status or a body that is not JSON', async () => {
    expect(await fetchTikTokReplies(target, contextFor({ status_code: 10201, comments: null }))).toEqual({
      status: 'failed',
      platform: 'tiktok',
      reason: 'status_10201'
    })
    expect(await fetchTikTokReplies(target, contextFor(''))).toEqual({
      status: 'failed',
      platform: 'tiktok',
      reason: 'invalid_json'
    })
  })
})
