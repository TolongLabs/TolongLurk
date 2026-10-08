import type { SocialPlatform } from '../urls.js'
import type { ReplyFetchContext, ReplyLookup, SocialReply } from './types.js'

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

const UNREADABLE = new Set(['[deleted]', '[removed]'])

export interface ReplyCandidate extends SocialReply {
  tiebreak?: number
}

export function compactReplyText(value: string, maxChars: number): string {
  // Sliced by code point, not UTF-16 unit, so a cap inside an emoji cannot leave a lone surrogate behind.
  return Array.from(value.replace(/\s+/g, ' ').trim()).slice(0, maxChars).join('').trimEnd()
}

function readable(candidates: ReplyCandidate[], maxReplyChars: number) {
  return candidates
    .map((candidate, index) => ({ ...candidate, text: compactReplyText(candidate.text, maxReplyChars), index }))
    .filter((candidate) => candidate.text && !UNREADABLE.has(candidate.text.toLowerCase()))
}

function strip({ author, text, likes }: SocialReply): SocialReply {
  return { author, text, likes }
}

export function rankReplies(candidates: ReplyCandidate[], maxReplies: number, maxReplyChars: number): SocialReply[] {
  return readable(candidates, maxReplyChars)
    .sort(
      (left, right) =>
        (right.likes ?? -1) - (left.likes ?? -1) ||
        (right.tiebreak ?? 0) - (left.tiebreak ?? 0) ||
        left.index - right.index
    )
    .slice(0, maxReplies)
    .map(strip)
}

export function takeReplies(candidates: ReplyCandidate[], maxReplies: number, maxReplyChars: number): SocialReply[] {
  return readable(candidates, maxReplyChars).slice(0, maxReplies).map(strip)
}

export function found(platform: SocialPlatform, replies: SocialReply[], total: number | null): ReplyLookup {
  return { status: 'found', platform, replies, total }
}

export function failed(platform: SocialPlatform, reason: string): ReplyLookup {
  return { status: 'failed', platform, reason }
}

export async function fetchJson(
  context: ReplyFetchContext,
  url: URL,
  init: RequestInit = {}
): Promise<{ ok: true; body: unknown } | { ok: false; reason: string }> {
  const response = await context.fetcher(url, { ...init, signal: context.signal })
  if (!response.ok) return { ok: false, reason: `http_${response.status}` }
  try {
    return { ok: true, body: (await response.json()) as unknown }
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
}
