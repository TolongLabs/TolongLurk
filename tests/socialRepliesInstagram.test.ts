import { describe, expect, it, mock } from 'bun:test'
import { fetchInstagramReplies } from '../src/replies/instagram.js'
import { parseSocialPostUrl } from '../src/urls.js'
import { replyContext, replyFixture } from './replyFetchTestContext.js'

const target = parseSocialPostUrl('https://www.instagram.com/p/Cabc123xyz/')!

function contextFor(result: { metadata: unknown } | { reason: string }) {
  return replyContext({ runExtractor: mock(async () => result) })
}

describe('fetchInstagramReplies', () => {
  it('asks yt-dlp for the post with its comments', async () => {
    const context = contextFor({ metadata: JSON.parse(replyFixture('instagram-comments.json')) })

    await fetchInstagramReplies(target, context)

    expect(context.runExtractor).toHaveBeenCalledWith('yt-dlp', 'https://www.instagram.com/p/Cabc123xyz/', 6000, [
      '--write-comments'
    ])
  })

  it('ranks top-level comments by likes, skipping replies to comments and empty ones', async () => {
    expect(
      await fetchInstagramReplies(target, contextFor({ metadata: JSON.parse(replyFixture('instagram-comments.json')) }))
    ).toEqual({
      status: 'found',
      platform: 'instagram',
      total: 654,
      replies: [
        { author: 'fan_c', text: 'where is this?', likes: 40 },
        { author: 'fan_a', text: 'so pretty', likes: 12 },
        { author: 'fan_e', text: 'saving this for my trip', likes: 7 },
        { author: 'fan_d', text: 'wow', likes: null }
      ]
    })
  })

  it('fails with the extractor reason', async () => {
    expect(await fetchInstagramReplies(target, contextFor({ reason: 'exit_1' }))).toEqual({
      status: 'failed',
      platform: 'instagram',
      reason: 'exit_1'
    })
  })
})
