import { describe, expect, it, mock } from 'bun:test'
import { fetchRedditReplies, parseRedditComments } from '../src/replies/reddit.js'
import { parseSocialPostUrl } from '../src/urls.js'
import { replyContext, replyFixture, requestedHeaders, requestedUrl } from './replyFetchTestContext.js'

const target = parseSocialPostUrl('https://www.reddit.com/r/videos/comments/6rrwyj/that_small_heart_attack/')!
const FEED = replyFixture('reddit-comments.rss')

function contextFor(body: string, status = 200, maxReplies = 5) {
  return replyContext({
    fetcher: mock(async () => new Response(body, { status })) as unknown as typeof fetch,
    maxReplies
  })
}

describe('parseRedditComments', () => {
  it('reads comment entries only, decoding both entity layers and stripping markup', () => {
    expect(parseRedditComments(FEED)).toEqual([
      { author: 'commenter_one', text: "Tom & Jerry's energy right here", likes: null },
      { author: '', text: '[deleted]', likes: null },
      { author: 'commenter_two', text: 'Now do it with more babies. Second paragraph.', likes: null },
      { author: 'commenter_three', text: '/r/nocontext', likes: null },
      { author: 'commenter_four', text: "Here's one where the baby doesn't get scared <3", likes: null }
    ])
  })
})

describe('fetchRedditReplies', () => {
  it("asks for the post's top-voted comments as RSS with a browser user agent", async () => {
    const context = contextFor(FEED)

    await fetchRedditReplies(target, context)

    const url = requestedUrl(context.fetcher)
    expect(`${url.origin}${url.pathname}`).toBe('https://www.reddit.com/comments/6rrwyj/.rss')
    expect(url.searchParams.get('sort')).toBe('top')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(requestedHeaders(context.fetcher).get('user-agent')).toContain('Mozilla/5.0')
  })

  it("keeps Reddit's top order, drops deleted comments, and caps", async () => {
    expect(await fetchRedditReplies(target, contextFor(FEED, 200, 2))).toEqual({
      status: 'found',
      platform: 'reddit',
      total: null,
      replies: [
        { author: 'commenter_one', text: "Tom & Jerry's energy right here", likes: null },
        { author: 'commenter_two', text: 'Now do it with more babies. Second paragraph.', likes: null }
      ]
    })
  })

  it('fails when Reddit rate-limits the feed', async () => {
    expect(await fetchRedditReplies(target, contextFor('Too Many Requests', 429))).toEqual({
      status: 'failed',
      platform: 'reddit',
      reason: 'http_429'
    })
  })
})
