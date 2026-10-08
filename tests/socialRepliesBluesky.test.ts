import { describe, expect, it, mock } from 'bun:test'
import { fetchBlueskyReplies } from '../src/replies/bluesky.js'
import { parseSocialPostUrl } from '../src/urls.js'
import { jsonResponse, replyContext, replyFixture, requestedUrl } from './replyFetchTestContext.js'

const target = parseSocialPostUrl('https://bsky.app/profile/atproto.com/post/3mx7uc3l6i22k')!
const DID = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz'

function routedContext(thread: unknown, identityStatus = 200) {
  const fetcher = mock(async (input: string | URL) =>
    String(input).includes('resolveHandle') ? jsonResponse({ did: DID }, identityStatus) : jsonResponse(thread)
  )
  return replyContext({ fetcher: fetcher as unknown as typeof fetch })
}

describe('fetchBlueskyReplies', () => {
  it('resolves the handle, then requests the thread one level deep', async () => {
    const context = routedContext(replyFixture('bluesky-thread-replies.json'))

    await fetchBlueskyReplies(target, context)

    expect(requestedUrl(context.fetcher, 0).searchParams.get('handle')).toBe('atproto.com')
    const thread = requestedUrl(context.fetcher, 1)
    expect(`${thread.origin}${thread.pathname}`).toBe('https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread')
    expect(thread.searchParams.get('uri')).toBe(`at://${DID}/app.bsky.feed.post/3mx7uc3l6i22k`)
    expect(thread.searchParams.get('depth')).toBe('1')
    expect(thread.searchParams.get('parentHeight')).toBe('0')
  })

  it('returns the most-liked readable replies and skips blocked or deleted ones', async () => {
    expect(await fetchBlueskyReplies(target, routedContext(replyFixture('bluesky-thread-replies.json')))).toEqual({
      status: 'found',
      platform: 'bluesky',
      total: 9,
      replies: [
        { author: 'fan2.bsky.social', text: 'this makes the episodes so much easier to skim', likes: 40 },
        { author: 'fan5.bsky.social', text: 'accessibility win', likes: 40 },
        { author: 'fan4.bsky.social', text: 'which local model did you use?', likes: 12 },
        { author: 'fan6.bsky.social', text: 'typo in episode 3 at 12:40', likes: 7 },
        { author: 'fan1.bsky.social', text: 'transcripts are great for search', likes: 3 }
      ]
    })
  })

  it('fails when the handle cannot be resolved or the post is missing', async () => {
    expect(await fetchBlueskyReplies(target, routedContext({}, 400))).toEqual({
      status: 'failed',
      platform: 'bluesky',
      reason: 'http_400'
    })
    expect(await fetchBlueskyReplies(target, routedContext({ thread: {} }))).toEqual({
      status: 'failed',
      platform: 'bluesky',
      reason: 'missing_post'
    })
  })
})
