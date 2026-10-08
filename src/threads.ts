import { array, base, capped, imageUrl, nonNegativeInteger, object, string } from './parsers.js'
import type { SocialPost } from './types.js'
import type { SocialPostTarget } from './urls.js'

type JsonObject = Record<string, unknown>

// Threads renders the post and its first replies into the page only for a request that looks like a browser
// navigating to it; without Accept and Sec-Fetch-* it serves an empty app shell.
export const THREADS_PAGE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1'
}

const DATA_BLOCK = /<script type="application\/json"[^>]*\bdata-sjs\b[^>]*>([\s\S]*?)<\/script>/g

export interface ThreadsReply {
  author: string
  text: string
  likes: number | null
}

export interface ThreadsPage {
  post: SocialPost
  replies: ThreadsReply[]
}

/** Every `result.data.media` in the page's embedded GraphQL results: the post, its replies, and related posts. */
function mediaResults(html: string): JsonObject[] {
  const found: JsonObject[] = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (value === null || typeof value !== 'object') return
    const media = object(object(object(object(value).result).data).media)
    if (Object.keys(media).length > 0) found.push(media)
    for (const child of Object.values(value)) walk(child)
  }
  for (const [, json] of html.matchAll(DATA_BLOCK)) {
    try {
      walk(JSON.parse(json))
    } catch {
      // Unrelated blocks are not always JSON the post depends on.
    }
  }
  return found
}

function firstCandidate(media: JsonObject): string | null {
  return imageUrl(object(array(object(media.image_versions2).candidates)[0]).url)
}

function firstVideoUrl(media: JsonObject): string | null {
  return imageUrl(object(array(media.video_versions)[0]).url)
}

function hasAudio(...media: JsonObject[]): boolean | null {
  const flag = media.map((item) => item.has_audio).find((value) => typeof value === 'boolean')
  return typeof flag === 'boolean' ? flag : null
}

function replyNodes(info: JsonObject, key: 'direct_replies' | 'pinned_replies'): JsonObject[] {
  return array(object(info[key]).edges).map((edge) =>
    object(object(array(object(object(object(edge).node).posts).edges)[0]).node)
  )
}

export function parseThreadsPage(html: string, target: SocialPostTarget, maxTextChars: number): ThreadsPage | null {
  const results = mediaResults(html)
  const media = results.find((item) => item.code === target.id && 'caption' in item)
  if (!media) return null

  const info = object(media.text_post_app_info)
  const user = object(media.user)
  const items = array(media.carousel_media).map(object)
  const videoItems = items.filter((item) => firstVideoUrl(item))
  const linkCard = object(info.link_preview_attachment)
  const quote = object(object(info.share_info).quoted_post)
  const videoSource = firstVideoUrl(media) ? media : videoItems[0]
  const takenAt = nonNegativeInteger(media.taken_at)

  const post = base(target)
  post.authorHandle = string(user.username)
  post.authorName = string(user.full_name)
  post.createdAt = takenAt === null ? null : new Date(takenAt * 1000).toISOString().slice(0, 10)
  post.text = capped(object(media.caption).text, maxTextChars)
  post.quotedText = capped(object(quote.caption).text, maxTextChars)
  post.quotedAuthorHandle = string(object(quote.user).username)
  post.externalTitle = capped(linkCard.title, maxTextChars)
  post.replyCount = nonNegativeInteger(info.direct_reply_count)
  if (items.length > 0) {
    post.photoCount = items.length - videoItems.length
    post.videoCount = videoItems.length
  } else if (firstVideoUrl(media)) {
    post.videoCount = 1
  } else if (firstCandidate(media)) {
    post.photoCount = 1
  }
  post.imageUrl = (items[0] ? firstCandidate(items[0]) : firstCandidate(media)) ?? imageUrl(linkCard.image_url)
  post.imageUrls =
    items.length > 0
      ? items.filter((item) => !firstVideoUrl(item)).flatMap((item) => firstCandidate(item) ?? [])
      : post.photoCount > 0 && post.imageUrl
        ? [post.imageUrl]
        : []
  if (videoSource) {
    post.video = {
      url: firstVideoUrl(videoSource) as string,
      bytes: null,
      headers: null,
      hasAudio: hasAudio(videoSource, media)
    }
  }

  // The page carries the first replies Threads chose to show; a pinned reply can repeat one of them.
  const replyInfo = object(
    results.find((item) => item.id === media.id && 'direct_replies' in object(item.text_post_app_info))
      ?.text_post_app_info
  )
  const seen = new Set<string>()
  const replies: ThreadsReply[] = []
  for (const node of [...replyNodes(replyInfo, 'pinned_replies'), ...replyNodes(replyInfo, 'direct_replies')]) {
    const key = string(node.pk) || string(node.id)
    if (!key || seen.has(key)) continue
    seen.add(key)
    replies.push({
      author: string(object(node.user).username),
      text: string(object(node.caption).text),
      likes: nonNegativeInteger(node.like_count)
    })
  }

  return { post, replies }
}
