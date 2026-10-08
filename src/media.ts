import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BROWSER_USER_AGENT } from './replies/common.js'
import type { SocialPost } from './types.js'
import { downloadVideoWithYtDlp } from './ytDlp.js'

const MAX_IMAGES = 10
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_VIDEO_BYTES = 200 * 1024 * 1024
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

export type SavedImage = { url: string; path: string } | { url: string; reason: string }

export function postImageUrls(post: SocialPost): string[] {
  const urls = post.imageUrls.length > 0 ? post.imageUrls : post.imageUrl ? [post.imageUrl] : []
  return [...new Set(urls)].slice(0, MAX_IMAGES)
}

export function postHasVideo(post: SocialPost): boolean {
  return post.platform === 'youtube' || post.video !== null || post.videoCount > 0
}

export async function downloadImages(
  post: SocialPost,
  dir: string,
  fetcher: typeof fetch = fetch
): Promise<SavedImage[]> {
  const saved: SavedImage[] = []
  for (const [index, url] of postImageUrls(post).entries()) {
    try {
      const response = await fetcher(url, {
        headers: { 'User-Agent': BROWSER_USER_AGENT },
        signal: AbortSignal.timeout(20_000)
      })
      const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      const extension = IMAGE_EXTENSIONS[type]
      if (!response.ok) {
        saved.push({ url, reason: `http_${response.status}` })
        continue
      }
      if (!extension) {
        saved.push({ url, reason: `not_an_image (${type || 'unknown type'})` })
        continue
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        saved.push({ url, reason: 'too_large' })
        continue
      }
      const path = join(dir, `image-${index + 1}.${extension}`)
      await writeFile(path, bytes)
      saved.push({ url, path })
    } catch {
      saved.push({ url, reason: 'network_error' })
    }
  }
  return saved
}

/** The post's own MP4 when the source handed one over (FxTwitter, yt-dlp formats), else yt-dlp downloads it. */
export async function downloadVideo(
  post: SocialPost,
  dir: string,
  options: { ytDlpPath: string; timeoutMs: number; fetcher?: typeof fetch }
): Promise<{ path: string } | { reason: string }> {
  const fetcher = options.fetcher ?? fetch
  if (post.video?.url && (post.video.bytes ?? 0) <= MAX_VIDEO_BYTES) {
    try {
      const response = await fetcher(post.video.url, {
        headers: { 'User-Agent': BROWSER_USER_AGENT, ...(post.video.headers ?? {}) },
        signal: AbortSignal.timeout(options.timeoutMs)
      })
      const declared = Number(response.headers.get('content-length') ?? 0)
      if (response.ok && declared <= MAX_VIDEO_BYTES) {
        const path = join(dir, 'video.mp4')
        await writeFile(path, Buffer.from(await response.arrayBuffer()))
        if ((await stat(path)).size > 0) return { path }
      }
    } catch {
      // The extractor below still has a chance at it.
    }
  }
  return downloadVideoWithYtDlp(options.ytDlpPath, post.target.extractorUrl, dir, options.timeoutMs)
}
