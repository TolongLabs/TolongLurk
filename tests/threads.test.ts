import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { lookupPost } from '../src/post.js'
import { renderReplies } from '../src/render.js'
import { readReplies } from '../src/replies/read.js'
import { parseThreadsPage } from '../src/threads.js'
import { parseSocialPostUrl } from '../src/urls.js'

const PAGE = readFileSync(new URL('./fixtures/threads-post.html', import.meta.url), 'utf8')
const target = parseSocialPostUrl('https://www.threads.net/@poster_one/post/DFixtur3abc')!

function htmlFetcher(body: string, status = 200) {
  return mock(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(body, { status, headers: { 'content-type': 'text/html' } })
  )
}

describe('Threads', () => {
  it('reads threads.com, threads.net and short /t/ links', () => {
    expect(target).toMatchObject({
      platform: 'threads',
      id: 'DFixtur3abc',
      canonicalUrl: 'https://www.threads.com/@poster_one/post/DFixtur3abc'
    })
    expect(parseSocialPostUrl('https://www.threads.com/t/DFixtur3abc')).toMatchObject({ platform: 'threads' })
    expect(parseSocialPostUrl('https://www.threads.com/@poster_one')).toBeNull()
  })

  it('keeps every photo of a carousel and its clip', () => {
    expect(parseThreadsPage(PAGE, target, 1500)?.post).toMatchObject({
      authorHandle: 'poster_one',
      photoCount: 2,
      videoCount: 1,
      replyCount: 897,
      imageUrls: [
        'https://scontent.cdninstagram.com/v/fixture-one.jpg',
        'https://scontent.cdninstagram.com/v/fixture-three.jpg'
      ],
      video: { url: 'https://instagram.fkul4-3.fna.fbcdn.net/o1/v/fixture-clip.mp4' }
    })
  })

  it('requests the page as a browser navigation', async () => {
    const fetcher = htmlFetcher(PAGE)

    expect(await lookupPost(target, { fetcher: fetcher as unknown as typeof fetch })).toMatchObject({
      status: 'found',
      post: { platform: 'threads', text: 'A day at the research lab. Three photos and a clip.' }
    })
    const headers = new Headers(fetcher.mock.calls[0][1]?.headers)
    expect(headers.get('sec-fetch-mode')).toBe('navigate')
    expect(headers.get('accept')).toContain('text/html')
  })

  it('fails without guessing when the page carries no post', async () => {
    expect(await lookupPost(target, { fetcher: htmlFetcher('<html></html>') as unknown as typeof fetch })).toEqual({
      status: 'failed',
      platform: 'threads',
      reason: 'no_post_data'
    })
  })

  it('ranks the replies on the page by likes and says where they came from', async () => {
    const replies = await readReplies(target, { fetcher: htmlFetcher(PAGE) as unknown as typeof fetch })

    expect(replies).toMatchObject({ status: 'found', total: 897 })
    expect(replies.status === 'found' && replies.replies.map((reply) => reply.author)).toEqual([
      'critic_one',
      'fan_three',
      'fan_one',
      'fan_two',
      'fan_five'
    ])
    expect(renderReplies(replies)).toContain('picked from the first batch Threads shows a logged-out visitor')
  })
})
