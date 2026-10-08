import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess } from './process.js'

const FRAMES_PER_GRID = 16

export interface FramePlan {
  frames: number
  grids: number
  timestamps: number[]
}

/** 16 frames for a short clip, 32 for anything past two minutes, spread evenly at the middle of each slice. */
export function framePlan(durationSec: number): FramePlan {
  const frames = durationSec <= 120 ? FRAMES_PER_GRID : FRAMES_PER_GRID * 2
  return {
    frames,
    grids: frames / FRAMES_PER_GRID,
    timestamps: Array.from({ length: frames }, (_, index) => ((index + 0.5) * durationSec) / frames)
  }
}

export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = String(whole % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

export async function probeDuration(path: string): Promise<number | null> {
  const result = await runProcess(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
    30_000
  )
  const duration = Number(result.stdout.trim())
  return result.code === 0 && Number.isFinite(duration) && duration > 0 ? duration : null
}

export async function frameGrids(
  path: string,
  dir: string,
  durationSec: number
): Promise<{ grids: string[]; plan: FramePlan } | { reason: string }> {
  const plan = framePlan(durationSec)
  const result = await runProcess(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      path,
      '-vf',
      `fps=${plan.frames}/${durationSec.toFixed(3)},scale=360:-2,tile=4x4`,
      '-frames:v',
      String(plan.grids),
      join(dir, 'frames-%d.jpg')
    ],
    120_000
  )
  if (result.code !== 0) return { reason: result.timedOut ? 'timeout' : `ffmpeg_exit_${result.code ?? 'unknown'}` }
  const grids = (await readdir(dir))
    .filter((name) => /^frames-\d+\.jpg$/.test(name))
    .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]))
    .map((name) => join(dir, name))
  return grids.length > 0 ? { grids, plan } : { reason: 'no_frames' }
}
