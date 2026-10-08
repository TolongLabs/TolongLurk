import type { SocialPlatform, SocialPostTarget } from './urls.js'

export interface PlayableVideo {
  url: string
  /** Exact or declared byte size when known. */
  bytes: number | null
  /** Request headers the host requires (yt-dlp `http_headers`), else null. */
  headers: Record<string, string> | null
  /** true = has a sound track, false = known silent/video-only, null = unknown. */
  hasAudio: boolean | null
}

export interface SocialPost {
  platform: SocialPlatform
  id: string
  canonicalUrl: string
  target: SocialPostTarget
  authorHandle: string
  authorName: string
  createdAt: string | null
  text: string
  quotedText: string
  quotedAuthorHandle: string
  photoCount: number
  videoCount: number
  imageUrl: string | null
  /** Every photo in the post, in order; imageUrl alone is the first photo or a cover. */
  imageUrls: string[]
  externalTitle: string
  replyCount: number | null
  durationSec: number | null
  video: PlayableVideo | null
}

export type SocialPostLookup =
  | { status: 'found'; post: SocialPost }
  | { status: 'failed'; platform: SocialPlatform; reason: string }
  | { status: 'none' }
