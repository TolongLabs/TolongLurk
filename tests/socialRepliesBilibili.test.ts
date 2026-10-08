import { describe, expect, it, mock } from 'bun:test'
import { bilibiliAid, fetchBilibiliReplies } from '../src/replies/bilibili.js'
import { parseSocialPostUrl } from '../src/urls.js'
import { jsonResponse, replyContext, replyFixture, requestedHeaders, requestedUrl } from './replyFetchTestContext.js'

const target = parseSocialPostUrl('https://www.bilibili.com/video/BV1GJ411x7h7')!

function contextFor(body: unknown) {
  return replyContext({ fetcher: mock(async () => jsonResponse(body)) as unknown as typeof fetch })
}

describe('bilibiliAid', () => {
  // The view API that would look this up answers 412 to anonymous requests, so the conversion is local.
  it('converts BV ids locally and passes av ids through', () => {
    expect(bilibiliAid('BV1GJ411x7h7')).toBe('80433022')
    expect(bilibiliAid('av170001')).toBe('170001')
    expect(bilibiliAid('BV1GJ411x7h')).toBeNull()
    expect(bilibiliAid('BV1GJ411x7hI')).toBeNull()
  })
})

describe('fetchBilibiliReplies', () => {
  it('requests like-sorted replies for the computed aid with a Referer', async () => {
    const context = contextFor(replyFixture('bilibili-reply.json'))

    await fetchBilibiliReplies(target, context)

    const url = requestedUrl(context.fetcher)
    expect(`${url.origin}${url.pathname}`).toBe('https://api.bilibili.com/x/v2/reply')
    expect(Object.fromEntries(url.searchParams)).toEqual({ type: '1', oid: '80433022', sort: '1', ps: '20', pn: '1' })
    expect(requestedHeaders(context.fetcher).get('referer')).toBe('https://www.bilibili.com/')
    expect(requestedHeaders(context.fetcher).get('user-agent')).toContain('Mozilla/5.0')
  })

  it('returns the most-liked replies with the total count', async () => {
    expect(await fetchBilibiliReplies(target, contextFor(replyFixture('bilibili-reply.json')))).toEqual({
      status: 'found',
      platform: 'bilibili',
      total: 236883,
      replies: [
        { author: '观众甲', text: '坏消息：被骗了 好消息：真好听', likes: 764505 },
        { author: '观众乙', text: '第一次听到是在车载电台上', likes: 178932 },
        { author: '观众丙', text: '经典永不过时', likes: 50000 }
      ]
    })
  })

  it('fails on a Bilibili error code', async () => {
    expect(await fetchBilibiliReplies(target, contextFor({ code: -400, message: 'bad request' }))).toEqual({
      status: 'failed',
      platform: 'bilibili',
      reason: 'code_-400'
    })
  })
})
