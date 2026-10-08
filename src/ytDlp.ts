import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from './process.js'

export const MAX_YTDLP_STDOUT_BYTES = 2 * 1024 * 1024

export function buildYtDlpArgs(url: string, timeoutMs: number, extraArgs: readonly string[] = []): string[] {
  return [
    '--ignore-config',
    '--no-plugin-dirs',
    '--no-cache-dir',
    '--no-playlist',
    '--no-warnings',
    '--socket-timeout',
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    '--retries',
    '0',
    '--extractor-retries',
    '0',
    '--js-runtimes',
    'node',
    '--dump-json',
    '--skip-download',
    ...extraArgs,
    url
  ]
}

function isolatedEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '',
    HOME: home,
    XDG_CACHE_HOME: home,
    XDG_CONFIG_HOME: home,
    TMPDIR: home
  }
}

export async function runYtDlp(
  binaryPath: string,
  url: string,
  timeoutMs: number,
  extraArgs: readonly string[] = []
): Promise<{ metadata: unknown } | { reason: string }> {
  const home = await mkdtemp(join(tmpdir(), 'rokabot-social-'))
  try {
    return await new Promise((resolve) => {
      const child = spawn(binaryPath, buildYtDlpArgs(url, timeoutMs, extraArgs), {
        cwd: home,
        env: isolatedEnvironment(home),
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore']
      })
      const output: Buffer[] = []
      let outputBytes = 0
      let failure: string | null = null
      let settled = false
      const finish = (result: { metadata: unknown } | { reason: string }) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(() => {
        failure = 'timeout'
        child.kill('SIGKILL')
      }, timeoutMs)

      child.stdout?.on('data', (chunk: Buffer) => {
        outputBytes += chunk.byteLength
        if (outputBytes > MAX_YTDLP_STDOUT_BYTES) {
          failure = 'output_too_large'
          child.kill('SIGKILL')
          return
        }
        output.push(chunk)
      })
      child.once('error', (error: NodeJS.ErrnoException) => {
        finish({ reason: error.code === 'ENOENT' ? 'binary_missing' : 'spawn_error' })
      })
      child.once('close', (code) => {
        if (failure) {
          finish({ reason: failure })
          return
        }
        if (code !== 0) {
          finish({ reason: `exit_${code ?? 'unknown'}` })
          return
        }

        const line = Buffer.concat(output).toString('utf8').trim().split(/\r?\n/, 1)[0]
        if (!line) {
          finish({ reason: 'empty_output' })
          return
        }
        try {
          finish({ metadata: JSON.parse(line) as unknown })
        } catch {
          finish({ reason: 'invalid_json' })
        }
      })
    })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

export async function isYtDlpAvailable(binaryPath: string, timeoutMs = 10_000): Promise<boolean> {
  const home = await mkdtemp(join(tmpdir(), 'rokabot-social-check-'))
  try {
    return await new Promise((resolve) => {
      const child = spawn(binaryPath, ['--version'], {
        cwd: home,
        env: isolatedEnvironment(home),
        shell: false,
        stdio: 'ignore'
      })
      let settled = false
      const finish = (available: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(available)
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish(false)
      }, timeoutMs)
      child.once('error', () => finish(false))
      child.once('close', (code) => finish(code === 0))
    })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

const MAX_DOWNLOAD = '200M'

/** Downloads the post's video as one MP4 into `outDir`; merging separate streams needs ffmpeg. */
export async function downloadVideoWithYtDlp(
  binaryPath: string,
  url: string,
  outDir: string,
  timeoutMs: number
): Promise<{ path: string } | { reason: string }> {
  const result = await runProcess(
    binaryPath,
    [
      '--ignore-config',
      '--no-playlist',
      '--no-warnings',
      '--quiet',
      '-f',
      'b[ext=mp4]/bv*[ext=mp4]+ba[ext=m4a]/b',
      '--max-filesize',
      MAX_DOWNLOAD,
      '--merge-output-format',
      'mp4',
      '-o',
      join(outDir, 'video.%(ext)s'),
      '--print',
      'after_move:filepath',
      url
    ],
    timeoutMs
  )
  const path = result.stdout.trim().split(/\r?\n/).pop() ?? ''
  if (result.timedOut) return { reason: 'timeout' }
  if (result.code !== 0 || !path) return { reason: `exit_${result.code ?? 'unknown'}` }
  return { path }
}

/** Captions or auto-captions as plain text, when the platform has them (mostly YouTube). */
export async function captionsWithYtDlp(
  binaryPath: string,
  url: string,
  outDir: string,
  timeoutMs: number
): Promise<string | null> {
  const result = await runProcess(
    binaryPath,
    [
      '--ignore-config',
      '--no-playlist',
      '--no-warnings',
      '--quiet',
      '--skip-download',
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      'en.*,en,-live_chat',
      '--sub-format',
      'vtt',
      '-o',
      join(outDir, 'captions.%(ext)s'),
      url
    ],
    timeoutMs
  )
  if (result.code !== 0) return null
  const files = (await readdir(outDir)).filter((name) => name.startsWith('captions.') && name.endsWith('.vtt'))
  if (files.length === 0) return null
  return vttToText(await readFile(join(outDir, files[0]), 'utf8'))
}

// Auto-captions repeat each line as it scrolls, so consecutive duplicates are dropped.
export function vttToText(vtt: string): string {
  const lines: string[] = []
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.replace(/<[^>]+>/g, '').trim()
    if (!line || line === 'WEBVTT' || /^(Kind|Language):/.test(line) || line.includes('-->') || /^\d+$/.test(line)) {
      continue
    }
    if (lines[lines.length - 1] !== line) lines.push(line)
  }
  return lines.join(' ')
}
