import type { PlayableVideo } from './types.js'

export interface VideoCandidate {
  url: string
  container: string | null
  protocol: string | null
  hasVideo: boolean
  hasAudio: boolean | null
  bytes: number | null
  bitrate: number | null
  headers: Record<string, string> | null
}

function qualifies(candidate: VideoCandidate): boolean {
  if (!candidate.hasVideo || !/^https?:\/\//i.test(candidate.url)) return false
  if (candidate.protocol !== null && candidate.protocol !== 'https' && candidate.protocol !== 'http') return false
  if (candidate.container === 'mp4') return true
  if (candidate.container !== null) return false

  try {
    return new URL(candidate.url).pathname.toLowerCase().endsWith('.mp4')
  } catch {
    return false
  }
}

function audioRank(hasAudio: boolean | null): number {
  return hasAudio === true ? 0 : hasAudio === null ? 1 : 2
}

/** Muxed (video + audio) beats video-only; then smaller bytes, then lower bitrate. Null when nothing qualifies. */
export function selectPlayableVideo(candidates: VideoCandidate[]): PlayableVideo | null {
  const candidate = candidates
    .filter(qualifies)
    .sort(
      (left, right) =>
        audioRank(left.hasAudio) - audioRank(right.hasAudio) ||
        (left.bytes ?? Number.POSITIVE_INFINITY) - (right.bytes ?? Number.POSITIVE_INFINITY) ||
        (left.bitrate ?? Number.POSITIVE_INFINITY) - (right.bitrate ?? Number.POSITIVE_INFINITY)
    )[0]

  if (!candidate) return null
  return {
    url: candidate.url,
    bytes: candidate.bytes,
    headers: candidate.headers,
    hasAudio: candidate.hasAudio
  }
}
