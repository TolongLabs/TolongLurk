import { base, date, imageUrl } from './parsers.js'
import type { SocialPost } from './types.js'
import type { SocialPostTarget } from './urls.js'

const NAMED_ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }

// One pass per layer: decoding `&amp;lt;` must yield `&lt;`, not `<`.
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (match, entity: string) => {
    if (entity[0] !== '#') return NAMED_ENTITIES[entity.toLowerCase()] ?? match
    const code = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1))
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  })
}

export function feedField(entry: string, pattern: RegExp): string {
  return pattern.exec(entry)?.[1] ?? ''
}

// The feed is machine-generated Atom and only a few fields are read, so bounded patterns are enough.
export function feedEntries(feed: string): string[] {
  return [...feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry]) => entry)
}

export function entryAuthor(entry: string): string {
  return decodeEntities(feedField(entry, /<author>\s*<name>([^<]*)<\/name>/)).replace(/^\/u\//, '')
}

export function entryContent(entry: string): string {
  return decodeEntities(feedField(entry, /<content[^>]*>([\s\S]*?)<\/content>/))
}

export function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

// The comment feed's first entry is the post itself, whatever its kind; yt-dlp only extracts Reddit-hosted video.
export function parseRedditFeedPost(feed: string, target: SocialPostTarget, maxTextChars: number): SocialPost | null {
  const entry = feedEntries(feed).find((candidate) => feedField(candidate, /<id>([^<]*)<\/id>/).startsWith('t3_'))
  if (!entry) return null

  const content = entryContent(entry)
  const title = htmlToText(feedField(entry, /<title>([\s\S]*?)<\/title>/))
  const body = htmlToText(content.match(/<div class="md">([\s\S]*?)<\/div>/)?.[1] ?? '')
  const link = feedField(content, /href="([^"]*)">\[link\]/)
  const subreddit = decodeEntities(feedField(entry, /<category term="([^"]*)"/))
  const post = base(target)
  post.authorHandle = entryAuthor(entry)
  post.authorName = subreddit ? `r/${subreddit}` : ''
  post.createdAt = date(feedField(entry, /<published>([^<]*)<\/published>/))
  post.text = [title, body].filter(Boolean).join(' — ').slice(0, maxTextChars)
  post.imageUrl = imageUrl(decodeEntities(feedField(entry, /<media:thumbnail url="([^"]*)"/)))
  post.photoCount = post.imageUrl ? 1 : 0
  post.videoCount = link.startsWith('https://v.redd.it/') ? 1 : 0
  return post
}
