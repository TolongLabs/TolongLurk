import { describe, expect, it, mock } from 'bun:test'
import { fetchXReplies } from '../src/replies/x.js'
import { parseSocialPostUrl } from '../src/urls.js'
import { jsonResponse, replyContext, replyFixture, requestedHeaders, requestedUrl } from './replyFetchTestContext.js'

const target = parseSocialPostUrl('https://x.com/ClaudeDevs/status/2107895957933408429')!

function contextFor(body: unknown, status = 200) {
  return replyContext({ fetcher: mock(async () => jsonResponse(body, status)) as unknown as typeof fetch })
}

describe('fetchXReplies', () => {
  it('asks FxTwitter for the like-ranked conversation with a browser user agent', async () => {
    const context = contextFor(replyFixture('x-conversation.json'))

    await fetchXReplies(target, context)

    const url = requestedUrl(context.fetcher)
    expect(`${url.origin}${url.pathname}`).toBe('https://api.fxtwitter.com/2/conversation/2107895957933408429')
    expect(url.searchParams.get('ranking_mode')).toBe('likes')
    expect(requestedHeaders(context.fetcher).get('user-agent')).toContain('Mozilla/5.0')
  })

  it('returns the five most-liked readable replies, ties broken by views, without leading mentions', async () => {
    expect(await fetchXReplies(target, contextFor(replyFixture('x-conversation.json')))).toEqual({
      status: 'found',
      platform: 'x',
      total: 205,
      replies: [
        { author: 'fan_one', text: 'credits every month is a nice touch', likes: 485 },
        { author: 'fan_three', text: 'finally, my side project is saved', likes: 120 },
        { author: 'fan_two', text: 'does this cover the Agent SDK too?', likes: 120 },
        { author: 'fan_four', text: 'how do pooled Team credits work?', likes: 60 },
        { author: 'fan_six', text: 'nice', likes: 12 }
      ]
    })
  })

  // Review Focus 4: a brand-new post has no replies yet; that is an answer, not a failure.
  it('treats an empty conversation as found with no replies', async () => {
    expect(await fetchXReplies(target, contextFor({ code: 200, status: { replies: 0 }, replies: [] }))).toEqual({
      status: 'found',
      platform: 'x',
      total: 0,
      replies: []
    })
  })

  // Seen live: an image-only reply's text is just the auto-prefixed handle, with nothing after it.
  it('drops a reply that is only the handles it answers', async () => {
    const body = {
      code: 200,
      status: { replies: 2 },
      replies: [
        { author: { screen_name: 'pic_only' }, text: '@ClaudeDevs', likes: 121 },
        { author: { screen_name: 'talker' }, text: '@ClaudeDevs @other nice', likes: 3 }
      ]
    }

    expect(await fetchXReplies(target, contextFor(body))).toEqual({
      status: 'found',
      platform: 'x',
      total: 2,
      replies: [{ author: 'talker', text: 'nice', likes: 3 }]
    })
  })

  it('fails on a non-OK status or an error code in the body', async () => {
    expect(await fetchXReplies(target, contextFor({}, 404))).toEqual({
      status: 'failed',
      platform: 'x',
      reason: 'http_404'
    })
    expect(await fetchXReplies(target, contextFor({ code: 404, message: 'NOT_FOUND' }))).toEqual({
      status: 'failed',
      platform: 'x',
      reason: 'api_404'
    })
  })
})
