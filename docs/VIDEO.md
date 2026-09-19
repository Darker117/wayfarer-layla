# Local video in Wayfarer 1.4

## Make a clip

1. Open **Video settings** at the bottom left of the composer to pair your desktop and choose options. **Adventure videos** in these settings lets you view, save, share, cancel or delete clips.
2. Select **Video**, beside Do / Say / Think / Story. It selects the input mode without opening settings or starting a render.
3. Write your scene, then press **Send** (the up-arrow), or Ctrl/Cmd+Enter. Wayfarer uses your saved video options and clears the draft once the desktop accepts it. An empty Video input cannot continue the story.
4. Progress and the finished video appear directly in the story, between the surrounding AI passages. Play, save, share and remove controls are available there too. You can continue writing while ComfyUI renders; reopening the adventure recovers the clips and their positions.

**Enhance with AI** is optional and defaults on. **AI chooses length** is independent: it can choose seconds without rewriting the prompt. If either option is on, Wayfarer makes one separate Layla model call with a structured result. With both off, the scene goes to the gateway with no Layla call, so a normal desktop browser can generate video too. Narrative scripts never run for video. Story generation waits while video uses Layla; after preparation, video rendering does not lock the story controls.

Options are saved per adventure on the current device: 480p / 720p, manual whole seconds from **1 to 225** (3:45), AI length selection, style, optional image, and context from the last 1 / 3 / 6 completed public turns. Context can be disabled. An image provides appearance guidance; without it, the first segment is true text-to-video. Subsequent segments use the preceding final frame.

## Longer videos

The gateway divides videos longer than 15 seconds into balanced segments of at most 15 seconds. For example, 16 seconds becomes two 8-second generations; 225 seconds becomes fifteen 15-second generations. Each segment is newly generated, with a last-frame image passed to the next one. No looping, slowing, duplicated clips or silent shortening is used. Joins can have visible changes or audible seams; this is not a guarantee of continuous action or perfect identity preservation over 3:45.

H3 uses a `17k+5` frame grid at 24 fps. Segments generate 124–362 frames and are trimmed to the requested length. Tiny 1–4 second requests generate a 5-second source and trim it. The final output is H.264 MP4 with AAC audio and a 16:9 display aspect. 480p uses 864×480 generation, cropped to 852×480 with a 640:639 pixel aspect; 720p uses 1280×736 generation, cropped to 1280×720. Uploaded images are cover-cropped before H3 conditioning so they are not stretched.

Rendering time depends on hardware, cache state and clip length. A 225-second request performs fifteen separate generations. No long-clip speed or quality benchmark is implied by support for that duration.

## Start the PC Companion

Download **wayfarer-pc-companion-1.4.1.zip** from [Wayfarer's GitHub releases](https://github.com/Darker117/wayfarer-layla/releases/tag/v1.4.1) and extract it on your PC. It contains the companion's local browser page, gateway and Windows launcher. The separate **wayfarer-1.4.1.zip** is imported into Layla on your phone.

Requirements:

- Node.js 22 or newer (verified with Node 24).
- The existing local ComfyUI running on `127.0.0.1:8188`.
- Python environment containing `comfy-mcp`, its MCP SDK and `comfy-cli`. The Windows default is `%LOCALAPPDATA%\comfy-mcp-tools\Scripts\python.exe`; override with `WAYFARER_MCP_PYTHON` if needed.
- `ffmpeg` and `ffprobe` in PATH; optional overrides `WAYFARER_FFMPEG` and `WAYFARER_FFPROBE`.
- The approved Hermes graph's local weights and nodes: FastH3 eight-step INT8 convrot, Qwen3VL NVFP4, MiniMax H3 video/audio VAEs and the native SageAttention patch. The graph is `gateway/fasth3.json`. It contains model basenames, not model files or credentials. It is the working Hermes configuration, not the original Spectrum workflow.

On Windows, run **Start-Wayfarer-PC-Companion.cmd** from the extracted download (or `gateway/Start-Wayfarer-PC-Companion.cmd` in source). It starts the gateway hidden and opens the companion page, without starting, restarting or changing ComfyUI. Logs and a process ID go into `%LOCALAPPDATA%\WayfarerVideo`. For a foreground terminal, run `node gateway/server.mjs` from the project root; Ctrl+C stops that gateway only.

Open **http://127.0.0.1:8788** on the desktop. Choose **10, 20 or 30 minutes**, or **Forever** (the default), then select **Create code**. Codes are reusable and survive companion restarts. Their duration controls new pairings; devices already connected can finish videos after a timed code expires. **Delete** removes a code and revokes every connection established through it. Existing connections made before this code-management update remain valid until disconnected.

In Wayfarer’s Video settings, enter the gateway address and code, then choose **Pair desktop** and **Test connection**. Codes and tokens are never printed to terminal logs. Saved reusable codes live in the companion's local state so the desktop page can show and copy them later.

For a desktop browser on the same PC, use `http://127.0.0.1:8787`. Pairing grants that device access only to its own adventures' jobs. **Disconnect** revokes its token. Do not disconnect while clips or a pending submission need recovery; another pairing creates a different ownership identity.

## Private phone access from elsewhere

Use Tailscale on the PC and phone, signed into an authorized tailnet. The PC must stay powered on, connected, and running ComfyUI and the gateway. Review your tailnet access policy to restrict the PC service to intended devices/users.

Inspect existing configuration first:

```powershell
tailscale serve status --json
```

With no conflicting route, publish **only the authenticated API port** inside the tailnet:

```powershell
tailscale serve --bg --yes http://127.0.0.1:8787
```

Use the HTTPS address printed by Tailscale in Wayfarer. Do not forward pairing port 8788 or ComfyUI port 8188. Do not use public Funnel. Do not reset unrelated Serve configuration. To remove just this HTTPS proxy later, use `tailscale serve --https=443 off` after checking it still belongs to Wayfarer.

The gateway permits opaque WebView origins (`null`) and the local development origins by default. Other exact origins can be configured with comma-separated `WAYFARER_ORIGINS`; restart the gateway after changing it. It never enables wildcard CORS. Pairing and bearer authorization still apply to allowed origins.

Phone Tailscale membership, WebView HTTPS/CORS, file picking, playback and Layla save/share require device verification. The desktop and browser checks do not establish these phone behaviors; see the validation notes for the results recorded so far.

## Storage, privacy and recovery

- Video preferences, submitted scene text and timeline positions, the pairing credential and pending submission identity live in device-local browser storage, separate from the narrative database. They are intentionally excluded from Wayfarer story backups. Restoring an adventure creates a new ID and does not inherit video authority or uploaded images.
- Public context includes final visible narrative and observable Do / Say / Story inputs from completed turns. It excludes Think input, model reasoning, raw script input, card notes/brains, script state and memory. A visible story output can still describe a private event; inspect the prompt and disable context when desired.
- Desktop job records, reusable connection codes, prompts needed for unfinished segments, uploads and rendered media live in `%LOCALAPPDATA%\WayfarerVideo`. Device tokens are stored as hashes on the desktop. The token on the paired device is a credential: clearing app/browser storage loses it. Local companion state is excluded from source control and release downloads. The final enhanced prompt is removed from the gateway record after completion; the original scene text remains on the sending device for the inline video message until that clip is removed; ComfyUI has its own local history retention.
- Video/image blobs never enter the main library or its JSON backup. Download clips separately. The gateway retains generated segment files for recovery; **Remove clip** deletes its gateway files. ComfyUI's own input/output copies remain under its normal retention policy.
- Closing the panel or returning to the adventure list does not cancel desktop work. Reopening fetches owned jobs. A lost submission reply is retried with the same ID, avoiding a second render. Cancellation before a delayed submission records an ownership-scoped tombstone so that late request cannot start work.
- A gateway restart resumes a known submitted prompt or the next unsubmitted segment. An ambiguous interruption during MCP submission stops with an error instead of risking a duplicate. Check the owned desktop queue before retrying that case.
- Cancel targets exactly the active owned Comfy prompt and any gateway encoder. It prevents later segments. The service does not call global interrupt, clear other queues, restart ComfyUI, unload others' models, or expose arbitrary workflows, MCP commands or file paths.

Bounds: 10 MB PNG/JPEG/WebP uploads, at most 24 megapixels, 30 retained uploads per paired device, two active videos globally, 200 retained job records, and 512 MB per source segment. Mobile preview/download is limited to 128 MB and native Layla save to 64 MB to avoid large base64 allocations. Larger finished clips remain in the desktop output directory. All limits produce explicit errors.

## Verification

Run `npm test`, `npm run test:gateway`, `npm run test:ui`, and `npm run build`. The browser suite uses a mock native bridge and gateway; desktop gateway tests exercise real HTTP, authorization, scoped cancellation and persistence. `tools/video-smoke.mjs` explicitly queues a neutral real local generation; do not run it as a routine unit test.

See [validation notes](../VALIDATION.md) for actual media verification and remaining device checks.
