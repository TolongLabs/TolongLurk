import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clock, framePlan } from '../src/frames.js'
import { postHasVideo, postImageUrls } from '../src/media.js'
import { parseFxTwitterResponse } from '../src/parsers.js'
import { lookupPost } from '../src/post.js'
import { renderPost, renderReplies, renderVideo } from '../src/render.js'
import { parseSocialPostUrl } from '../src/urls.js'
import { watchWithGemini } from '../src/watch.js'
import { vttToText } from '../src/ytDlp.js'

const xTarget = parseSocialPostUrl('https://x.com/roka/status/123')!

describe('post images', () => {
  // Roka only ever looked at the first photo; an agent can open every one.
  it('keeps every photo of a multi-photo post, in order', () => {
    const post = parseFxTwitterResponse(
      {
        tweet: {
          text: 'two',
          media: { photos: [{ url: 'https://pbs.twimg.com/a' }, { url: 'https://pbs.twimg.com/b' }] }
        }
      },
      xTarget,
      100
    )

    expect(postImageUrls(post)).toEqual(['https://pbs.twimg.com/a', 'https://pbs.twimg.com/b'])
    expect(postHasVideo(post)).toBe(false)
  })
})

describe('frames', () => {
  it('takes 16 frames for a short clip and 32 past two minutes, at the middle of each slice', () => {
    expect(framePlan(32)).toMatchObject({ frames: 16, grids: 1 })
    expect(framePlan(32).timestamps.slice(0, 2)).toEqual([1, 3])
    expect(framePlan(600)).toMatchObject({ frames: 32, grids: 2 })
  })

  it('formats clock times', () => {
    expect(clock(5)).toBe('0:05')
    expect(clock(125)).toBe('2:05')
    expect(clock(3725)).toBe('1:02:05')
  })
})

describe('vttToText', () => {
  it('drops cue timings and the repeats of scrolling auto-captions', () => {
    const vtt =
      'WEBVTT\nKind: captions\n\n00:00:00.000 --> 00:00:02.000\nhello <c>there</c>\n\n00:00:02.000 --> 00:00:04.000\nhello there\nnext line\n'

    expect(vttToText(vtt)).toBe('hello there next line')
  })
})

describe('rendering', () => {
  it('tells the agent not to guess when a post cannot be opened', () => {
    expect(renderPost({ status: 'failed', platform: 'x', reason: 'http_404' }, xTarget)).toContain('Do not guess')
  })

  it('lists replies with likes and defangs mass mentions', () => {
    const text = renderReplies({
      status: 'found',
      platform: 'x',
      total: 9,
      replies: [{ author: 'fan', text: 'hey @everyone', likes: 1 }]
    })

    expect(text).toContain('Top 1 of 9, most likes first')
    expect(text).toContain('1. @fan (1 like): "hey @​everyone"')
  })

  it("names Reddit's own order and refuses to substitute search results on failure", () => {
    expect(
      renderReplies({
        status: 'found',
        platform: 'reddit',
        total: null,
        replies: [{ author: 'a', text: 'b', likes: null }]
      })
    ).toContain("Reddit's top-voted order")
    expect(renderReplies({ status: 'failed', platform: 'reddit', reason: 'http_429' })).toContain(
      'Do not substitute search results'
    )
  })

  it('labels each frame grid with the times it covers', () => {
    const text = renderVideo({
      kind: 'frames',
      grids: ['/tmp/frames-1.jpg'],
      timestamps: framePlan(32).timestamps,
      captions: null,
      why: 'no key',
      hint: 'Set GEMINI_API_KEY to watch with sound.'
    })

    expect(text).toContain('`/tmp/frames-1.jpg` — 4×4 grid')
    expect(text).toContain('at 0:01, 0:03')
    expect(text).toContain('Set GEMINI_API_KEY')
  })
})

describe('watchWithGemini', () => {
  it('watches a YouTube video by URL, without uploading, keeping the key out of the URL', async () => {
    const fetcher = mock(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ candidates: [{ content: { parts: [{ text: '**Summary**: a zoo.' }] } }] })
    )

    const result = await watchWithGemini({
      apiKey: 'secret-key',
      model: 'gemini-flash-lite-latest',
      source: { kind: 'url', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
      fetcher: fetcher as unknown as typeof fetch
    })

    expect(result).toEqual({ text: '**Summary**: a zoo.' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    expect(String(url)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent'
    )
    expect(String(url)).not.toContain('secret-key')
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('secret-key')
    expect(JSON.parse(String(init?.body)).contents[0].parts[0]).toEqual({
      fileData: { fileUri: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }
    })
  })

  it('uploads a local video, waits until it is active, watches it, and deletes it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lurk-test-'))
    const path = join(dir, 'video.mp4')
    await writeFile(path, Buffer.from('fake video'))
    const calls: string[] = []
    const fetcher = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url.replace('https://generativelanguage.googleapis.com', '')}`)
      if (url.endsWith('/upload/v1beta/files')) {
        return new Response(null, { headers: { 'x-goog-upload-url': 'https://upload.example/session' } })
      }
      if (url === 'https://upload.example/session') {
        return Response.json({ file: { name: 'files/abc', uri: 'https://files/abc', state: 'PROCESSING' } })
      }
      if (url.endsWith('/v1beta/files/abc') && init?.method !== 'DELETE') return Response.json({ state: 'ACTIVE' })
      if (url.includes(':generateContent')) {
        return Response.json({ candidates: [{ content: { parts: [{ text: '**Summary**: a clip.' }] } }] })
      }
      return new Response(null)
    })

    const result = await watchWithGemini({
      apiKey: 'k',
      model: 'm',
      source: { kind: 'file', path, mimeType: 'video/mp4' },
      fetcher: fetcher as unknown as typeof fetch
    })

    expect(result).toEqual({ text: '**Summary**: a clip.' })
    expect(calls).toEqual([
      'POST /upload/v1beta/files',
      'POST https://upload.example/session',
      'GET /v1beta/files/abc',
      'POST /v1beta/models/m:generateContent',
      'DELETE /v1beta/files/abc'
    ])
  })
})

describe('lookupPost on Reddit', () => {
  const target = parseSocialPostUrl('https://www.reddit.com/r/osugame/comments/1x0b7lo/sample/')!

  it('reads an image post from the comment feed without running yt-dlp', async () => {
    const feed = readFileSync(new URL('./fixtures/reddit-post.rss', import.meta.url), 'utf8')
    const runExtractor = mock(async () => ({ reason: 'exit_1' }))

    const result = await lookupPost(target, {
      fetcher: mock(async () => new Response(feed)) as unknown as typeof fetch,
      runExtractor
    })

    expect(result).toMatchObject({ status: 'found', post: { authorHandle: 'poster_one', authorName: 'r/osugame' } })
    expect(runExtractor).not.toHaveBeenCalled()
  })

  it('fails at once when Reddit refuses the feed', async () => {
    const runExtractor = mock(async () => ({ reason: 'exit_1' }))

    expect(
      await lookupPost(target, {
        fetcher: mock(async () => new Response('', { status: 429 })) as unknown as typeof fetch,
        runExtractor
      })
    ).toEqual({ status: 'failed', platform: 'reddit', reason: 'http_429' })
    expect(runExtractor).not.toHaveBeenCalled()
  })
})
