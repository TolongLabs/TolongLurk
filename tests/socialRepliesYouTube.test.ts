import { describe, expect, it, mock } from 'bun:test'
import type { ReplyFetchContext } from '../src/replies/types.js'
import { fetchYouTubeReplies } from '../src/replies/youtube.js'
import { parseSocialPostUrl } from '../src/urls.js'
import { jsonResponse, replyContext, replyFixture, requestedUrl } from './replyFetchTestContext.js'

const target = parseSocialPostUrl('https://www.youtube.com/watch?v=jNQXAC9IVRw')!

function contextFor(body: unknown, status = 200, overrides: Partial<ReplyFetchContext> = {}) {
  return replyContext({
    fetcher: mock(async () => jsonResponse(body, status)) as unknown as typeof fetch,
    ...overrides
  })
}

describe('fetchYouTubeReplies', () => {
  it('requests a pool of 50 relevance-ordered top-level comments with the API key', async () => {
    const context = contextFor(replyFixture('youtube-comment-threads.json'))

    await fetchYouTubeReplies(target, context)

    const url = requestedUrl(context.fetcher)
    expect(`${url.origin}${url.pathname}`).toBe('https://www.googleapis.com/youtube/v3/commentThreads')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      part: 'snippet',
      videoId: 'jNQXAC9IVRw',
      order: 'relevance',
      maxResults: '50',
      textFormat: 'plainText',
      key: 'test-youtube-key'
    })
  })

  // Relevance is YouTube's opaque order; the fixture lists a 249k-like comment before a 294k one.
  it('re-ranks the pool by likes and strips the @ from channel names', async () => {
    expect(await fetchYouTubeReplies(target, contextFor(replyFixture('youtube-comment-threads.json')))).toEqual({
      status: 'found',
      platform: 'youtube',
      total: null,
      replies: [
        { author: 'viewerA', text: 'the first video ever, still here', likes: 4853444 },
        { author: 'viewerC', text: 'the elephants have really long trunks', likes: 294098 },
        { author: 'viewerB', text: 'to everyone reading this: have a great day', likes: 249104 },
        { author: 'viewerF', text: 'who else is here in 2026', likes: 114857 },
        { author: 'viewerG', text: 'zoo trip core memory', likes: 38597 }
      ]
    })
  })

  it('fails without calling out when no key is configured', async () => {
    const context = contextFor({}, 200, { youtubeApiKey: undefined })

    expect(await fetchYouTubeReplies(target, context)).toEqual({
      status: 'failed',
      platform: 'youtube',
      reason: 'not_configured'
    })
    expect(context.fetcher).not.toHaveBeenCalled()
  })

  it('names disabled comments and keeps the key out of every failure', async () => {
    const disabled = await fetchYouTubeReplies(
      target,
      contextFor({ error: { code: 403, errors: [{ reason: 'commentsDisabled' }] } }, 403)
    )
    const quota = await fetchYouTubeReplies(
      target,
      contextFor({ error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } }, 403)
    )

    expect(disabled).toEqual({ status: 'failed', platform: 'youtube', reason: 'comments_disabled' })
    expect(quota).toEqual({ status: 'failed', platform: 'youtube', reason: 'http_403' })
    expect(JSON.stringify([disabled, quota])).not.toContain('test-youtube-key')
  })
})
