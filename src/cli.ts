import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { frameGrids, probeDuration } from './frames.js'
import { downloadImages, downloadVideo, postHasVideo } from './media.js'
import { lookupPost } from './post.js'
import { runProcess } from './process.js'
import { type VideoReport, renderImages, renderPost, renderReplies, renderVideo } from './render.js'
import { readReplies } from './replies/read.js'
import { PLATFORM_NAMES } from './text.js'
import type { SocialPost } from './types.js'
import { findSocialPostTarget } from './urls.js'
import { watchWithGemini } from './watch.js'
import { captionsWithYtDlp } from './ytDlp.js'

const USAGE = `Usage: lurk <post-url> [options]
       lurk --check

Reads a public social media post without logging in: its text, images, video and (with --replies) its most-liked replies.
Supported: ${Object.values(PLATFORM_NAMES).join(', ')}.

Options:
  --replies          Also read the most-liked replies or comments
  --max-replies <n>  How many replies to read (default 5, at most 20)
  --no-media         Skip downloading images and watching video
  --frames           Use ffmpeg frame grids even when GEMINI_API_KEY is set
  --focus <text>     What you want to know about the video, passed to Gemini as context
  --out <dir>        Where to save images and frames (default: a new folder under the system temp directory)
  --check            Report which optional tools and keys are available, and what each one enables
  --help             Show this help

Environment:
  GEMINI_API_KEY     Watch videos with sound through Gemini; without it, videos are shown as ffmpeg frame grids
  LURK_GEMINI_MODEL  Gemini model for watching (default gemini-flash-lite-latest)
  YOUTUBE_API_KEY    Read YouTube comments (YouTube Data API v3)
  LURK_YTDLP         Path to yt-dlp if it is not on PATH`

const VIDEO_TIMEOUT_MS = 180_000

interface Options {
  url: string
  replies: boolean
  maxReplies: number
  media: boolean
  frames: boolean
  focus: string
  out: string | null
}

function parseArgs(argv: string[]): Options | 'help' | 'check' | { error: string } {
  const options: Options = { url: '', replies: false, maxReplies: 5, media: true, frames: false, focus: '', out: null }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') return 'help'
    if (arg === '--check') return 'check'
    if (arg === '--replies') options.replies = true
    else if (arg === '--no-media') options.media = false
    else if (arg === '--frames') options.frames = true
    else if (arg === '--max-replies' || arg === '--focus' || arg === '--out') {
      const value = argv[++index]
      if (value === undefined) return { error: `${arg} needs a value` }
      if (arg === '--max-replies') {
        const parsed = Number(value)
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) return { error: '--max-replies must be 1-20' }
        options.maxReplies = parsed
        options.replies = true
      } else if (arg === '--focus') options.focus = value
      else options.out = value
    } else if (arg.startsWith('-')) return { error: `unknown option ${arg}` }
    else options.url = options.url ? `${options.url} ${arg}` : arg
  }
  return options.url ? options : { error: 'a post URL is required' }
}

async function version(command: string, args: string[]): Promise<string | null> {
  const result = await runProcess(command, args, 10_000)
  return result.code === 0 ? (result.stdout.trim().split(/\r?\n/)[0] ?? 'installed') : null
}

async function check(ytDlpPath: string): Promise<string> {
  const runtime = process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.versions.node}`
  const ytDlp = await version(ytDlpPath, ['--version'])
  const ffmpeg = await version('ffmpeg', ['-version'])
  const ffprobe = await version('ffprobe', ['-version'])
  const line = (ok: boolean, name: string, detail: string) => `- ${ok ? '✅' : '❌'} **${name}**: ${detail}`
  return [
    '# lurk check',
    `Runtime: ${runtime}. Nothing is installed by lurk itself; ask the user before installing anything below.`,
    '',
    line(
      Boolean(ytDlp),
      'yt-dlp',
      ytDlp
        ? `${ytDlp}. Opens YouTube, TikTok, Instagram, Bilibili and Reddit-video posts and downloads videos.`
        : 'missing. Needed for TikTok, Instagram, Bilibili and Reddit-video posts, Instagram comments, and video downloads. X, Bluesky, Reddit text/image posts and YouTube basics work without it. Install: `pipx install yt-dlp`, `brew install yt-dlp`, `winget install yt-dlp`, or a release binary from github.com/yt-dlp/yt-dlp.'
    ),
    line(
      Boolean(ffmpeg && ffprobe),
      'ffmpeg + ffprobe',
      ffmpeg && ffprobe
        ? 'installed. Makes frame grids from videos when Gemini is not used, and lets yt-dlp merge video and audio.'
        : 'missing. Needed for frame grids when GEMINI_API_KEY is not set. Install: `brew install ffmpeg`, `sudo apt install ffmpeg`, or `winget install ffmpeg`.'
    ),
    line(
      Boolean(process.env.GEMINI_API_KEY),
      'GEMINI_API_KEY',
      process.env.GEMINI_API_KEY
        ? `set. Videos are watched with sound by \`${process.env.LURK_GEMINI_MODEL || 'gemini-flash-lite-latest'}\`.`
        : 'not set. Videos fall back to silent frame grids. A free key comes from aistudio.google.com/apikey.'
    ),
    line(
      Boolean(process.env.YOUTUBE_API_KEY),
      'YOUTUBE_API_KEY',
      process.env.YOUTUBE_API_KEY
        ? 'set. YouTube comments can be read.'
        : 'not set. YouTube comments are unavailable; everything else works. A key comes from the Google Cloud console (YouTube Data API v3).'
    )
  ].join('\n')
}

async function watchVideo(post: SocialPost, dir: string, options: Options, ytDlpPath: string): Promise<VideoReport> {
  const apiKey = process.env.GEMINI_API_KEY
  const model = process.env.LURK_GEMINI_MODEL || 'gemini-flash-lite-latest'
  let videoPath: string | null = null
  let why = options.frames ? '--frames was requested' : 'GEMINI_API_KEY is not set'

  if (apiKey && !options.frames) {
    // Gemini reads public YouTube videos by URL, so nothing is downloaded or uploaded for them.
    if (post.platform === 'youtube') {
      process.stderr.write('lurk: watching the video with Gemini…\n')
      const watched = await watchWithGemini({
        apiKey,
        model,
        source: { kind: 'url', url: post.canonicalUrl },
        focus: options.focus
      })
      if ('text' in watched) return { kind: 'watched', model, text: watched.text }
      why = `Gemini could not watch it (${watched.reason})`
    } else {
      process.stderr.write('lurk: downloading the video…\n')
      const downloaded = await downloadVideo(post, dir, { ytDlpPath, timeoutMs: VIDEO_TIMEOUT_MS })
      if ('reason' in downloaded) return { kind: 'unavailable', reason: `download failed: ${downloaded.reason}` }
      videoPath = downloaded.path
      process.stderr.write('lurk: watching the video with Gemini…\n')
      const watched = await watchWithGemini({
        apiKey,
        model,
        source: { kind: 'file', path: videoPath, mimeType: 'video/mp4' },
        focus: options.focus
      })
      if ('text' in watched) return { kind: 'watched', model, text: watched.text }
      why = `Gemini could not watch it (${watched.reason})`
    }
  }

  if (!videoPath) {
    process.stderr.write('lurk: downloading the video…\n')
    const downloaded = await downloadVideo(post, dir, { ytDlpPath, timeoutMs: VIDEO_TIMEOUT_MS })
    if ('reason' in downloaded) return { kind: 'unavailable', reason: `download failed: ${downloaded.reason}` }
    videoPath = downloaded.path
  }
  const duration = await probeDuration(videoPath)
  if (duration === null) return { kind: 'unavailable', reason: 'ffprobe is missing or could not read the video' }
  process.stderr.write('lurk: extracting frames…\n')
  const grids = await frameGrids(videoPath, dir, duration)
  if ('reason' in grids) return { kind: 'unavailable', reason: `ffmpeg failed: ${grids.reason}` }
  const captions = await captionsWithYtDlp(ytDlpPath, post.target.extractorUrl, dir, 60_000)
  const hint = apiKey ? null : 'Set GEMINI_API_KEY to watch with sound.'
  return { kind: 'frames', grids: grids.grids, timestamps: grids.plan.timestamps, captions, why, hint }
}

export async function main(argv: string[]): Promise<number> {
  const ytDlpPath = process.env.LURK_YTDLP || 'yt-dlp'
  const parsed = parseArgs(argv)
  if (parsed === 'help') {
    console.log(USAGE)
    return 0
  }
  if (parsed === 'check') {
    console.log(await check(ytDlpPath))
    return 0
  }
  if ('error' in parsed) {
    console.error(`lurk: ${parsed.error}\n\n${USAGE}`)
    return 2
  }

  const target = findSocialPostTarget(parsed.url)
  if (!target) {
    console.error(`lurk: not a supported post link. Supported: ${Object.values(PLATFORM_NAMES).join(', ')}.`)
    return 2
  }

  const lookup = await lookupPost(target, { ytDlpPath })
  const sections = [renderPost(lookup, target)]

  if (lookup.status === 'found' && parsed.media) {
    const dir = parsed.out ?? join(tmpdir(), 'lurk', `${target.platform}-${target.id}-${Date.now()}`)
    await mkdir(dir, { recursive: true })
    const images = await downloadImages(lookup.post, dir)
    const imageSection = renderImages(images)
    if (imageSection) sections.push(imageSection)
    if (postHasVideo(lookup.post)) sections.push(renderVideo(await watchVideo(lookup.post, dir, parsed, ytDlpPath)))
  }

  if (parsed.replies) {
    const replies = await readReplies(target, {
      maxReplies: parsed.maxReplies,
      ytDlpPath,
      youtubeApiKey: process.env.YOUTUBE_API_KEY
    })
    sections.push(renderReplies(replies))
  }

  console.log(sections.join('\n\n'))
  return 0
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code
})
