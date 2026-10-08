# TolongLurk

An agent skill, `lurk`, that reads public social media posts without logging in: the text, every photo, the video, and the most-liked replies. Point your coding agent at a post link and it can tell you what the post says, what is in its images and video, and what people are saying underneath.

It works with any agent that loads skills from a directory (Claude Code, Codex CLI, Gemini CLI, Antigravity, OpenCode, Devin and others) and runs on any machine with Node.js 18+ or Bun. There are no accounts, cookies or browser sessions.

## Supported Platforms

| Platform | Post | Video | Replies |
| --- | --- | --- | --- |
| X / Twitter | FxTwitter API | FxTwitter MP4 | FxTwitter `/2/conversation`, by likes |
| Bluesky | Public AppView API | yt-dlp | `getPostThread`, by likes |
| YouTube | yt-dlp, falling back to oEmbed | Gemini by URL, or yt-dlp | YouTube Data API v3, by likes (needs `YOUTUBE_API_KEY`) |
| TikTok | yt-dlp | yt-dlp | TikTok comment endpoint, by likes |
| Reddit | The post's comment feed (any post) | yt-dlp (`v.redd.it`) | Comment feed, Reddit's top-voted order |
| Instagram | yt-dlp | yt-dlp | yt-dlp comments, by likes |
| Bilibili | yt-dlp | yt-dlp | `x/v2/reply`, by likes |

## Requirements

- **Required:** Node.js 18 or newer, or Bun.
- **Optional:**
  - [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) for TikTok, Instagram, Bilibili and Reddit-video posts, and for downloading videos.
  - `ffmpeg` and `ffprobe` for frame grids when Gemini is not used.
  - `GEMINI_API_KEY` to watch videos with sound. A free key is available from [Google AI Studio](https://aistudio.google.com/apikey).
  - `YOUTUBE_API_KEY` to read YouTube comments, from the [Google Cloud console](https://console.cloud.google.com/apis/library/youtube.googleapis.com) (YouTube Data API v3).

`lurk --check` reports what is present and what each piece enables. The skill tells your agent to ask before installing anything.

## Installation

Clone the repository once, then link it into each agent's skills directory. The prebuilt `dist/lurk.mjs` is committed, so there is no install or build step.

```bash
git clone https://github.com/TolongLabs/TolongLurk ~/TolongLurk

ln -s ~/TolongLurk ~/.claude/skills/lurk                 # Claude Code
ln -s ~/TolongLurk ~/.codex/skills/lurk                  # Codex CLI
ln -s ~/TolongLurk ~/.gemini/skills/lurk                 # Gemini CLI
ln -s ~/TolongLurk ~/.gemini/antigravity/skills/lurk     # Antigravity
ln -s ~/TolongLurk ~/.config/opencode/skills/lurk        # OpenCode
ln -s ~/TolongLurk ~/.config/devin/skills/lurk           # Devin
ln -s ~/TolongLurk ~/.agents/skills/lurk                 # tools that read the shared ~/.agents/skills
```

Create a parent directory with `mkdir -p` first if it does not exist yet. On Windows, use `mklink /D` from an administrator prompt, or copy the folder. Restart the agent afterwards; in Claude Code the skill is then available as `/lurk`.

## Usage

Agents call it for you. To run it yourself:

```bash
node ~/TolongLurk/dist/lurk.mjs "https://x.com/user/status/123"
node ~/TolongLurk/dist/lurk.mjs "https://www.reddit.com/r/sub/comments/abc/title/" --replies
node ~/TolongLurk/dist/lurk.mjs "https://youtu.be/VIDEO_ID" --focus "what game is shown?"
node ~/TolongLurk/dist/lurk.mjs --check
```

| Option | Effect |
| --- | --- |
| `--replies` | Also read the most-liked replies or comments |
| `--max-replies <n>` | How many replies to read (default 5, at most 20) |
| `--no-media` | Text only; skip images and video |
| `--frames` | Use ffmpeg frame grids even when `GEMINI_API_KEY` is set |
| `--focus <text>` | What to look for in a video, passed to Gemini as context |
| `--out <dir>` | Where to save images and frames (default: a new folder under the system temp directory) |

| Environment Variable | Effect |
| --- | --- |
| `GEMINI_API_KEY` | Watch videos with sound through Gemini |
| `LURK_GEMINI_MODEL` | Gemini model for watching (default `gemini-flash-lite-latest`) |
| `YOUTUBE_API_KEY` | Read YouTube comments |
| `LURK_YTDLP` | Path to `yt-dlp` if it is not on `PATH` |

## How Videos Are Handled

- **With `GEMINI_API_KEY`:** YouTube videos are passed to Gemini by URL. Other videos are downloaded, uploaded to the Gemini Files API, watched at low resolution with sound, and deleted from Google's side afterwards. The output is a summary, a timeline, the lines that matter quoted exactly, and the on-screen text.
- **Without it:** the video is downloaded and `ffmpeg` cuts 16 evenly spaced frames, or 32 past two minutes, into 4×4 grids. Each frame's time is listed, and captions are added where the platform has them. The audio is not heard, so this path is slower to read and weaker on talking videos.

## Limits

- **Rate limits:** Reddit and Instagram rate-limit a busy IP; requests come back refused until the limit lifts.
- **Unofficial sources:** FxTwitter, TikTok's comment endpoint and Bilibili's reply API can change without notice.
- **YouTube bot checks:** from some home IPs, YouTube blocks yt-dlp. Titles still come through oEmbed, and Gemini still watches by URL.
- **Single posts only:** no search, timelines or full threads; that would need a logged-in session.

## Development

```bash
bun install
bun test
bun run typecheck && bun run lint
bun run build   # regenerate dist/lurk.mjs; commit it with the source change
```

## License

MIT
