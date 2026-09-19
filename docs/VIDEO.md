# Direct ComfyUI video in Wayfarer 1.5

## Connect your PC

Wayfarer calls ComfyUI directly. There is no companion app, MCP service, pairing code, or separate video gateway to run.

1. Use your existing ComfyUI installation with the working Hermes FastH3 models and nodes. This release keeps that eight-step INT8 workflow; it does not switch models.
2. Add these arguments to your ComfyUI launch options, including in Stability Matrix if that is your launcher:

   ```text
   --listen 127.0.0.1 --port 8188 --enable-cors-header null --cache-none
   ```

   `null` permits Layla's local-file WebView origin. `--cache-none` releases intermediate node results instead of keeping every segment's decoded frames in memory. Long-video submission checks for this or ComfyUI's RAM-pressure cache option. Keep your normal model paths and GPU options.
3. For a browser on that same PC, enter **http://127.0.0.1:8188** under **Video settings → PC connection → ComfyUI address**, then **Connect to ComfyUI**. For browser testing, use its origin instead of `null` as the CORS argument (for example `http://127.0.0.1:5173`).
4. For a phone, use the private HTTPS address described below. The phone's `127.0.0.1` refers to the phone, not the PC.

ComfyUI **0.36.0** was used for native verification. The client checks for the required video, H3, and SageAttention nodes and exact model filenames before generation. It needs current native `Video Slice`, `ConcatenateVideo`, `GetVideoComponents`, dynamic SaveVideo options, caller-supplied UUID prompt IDs, and job-scoped cancellation. Older ComfyUI versions may need updating.

### Phone access away from home

Run Tailscale on your PC and phone in the same authorized tailnet. The PC must stay awake, online, and running ComfyUI. Inspect existing routes before changing them:

```powershell
tailscale serve status --json
```

If this HTTPS route is unused, or was dedicated to the old Wayfarer gateway, point it directly to ComfyUI:

```powershell
tailscale serve --bg --yes http://127.0.0.1:8188
```

Enter the printed HTTPS address in Wayfarer. Preserve unrelated Serve routes. Use private Serve, not public Funnel or router port forwarding: ComfyUI has no Wayfarer pairing/authentication layer, and access to this address permits ComfyUI operations. Restrict the route to your intended devices/users through Tailscale access rules.

A private LAN or Tailscale HTTP address is also accepted if your ComfyUI is already listening on that interface and your WebView permits it. HTTPS is the recommended phone route. A failed CORS/network request leaves the draft intact.

## Make and manage a clip

1. Open **Video settings** at the bottom left to connect and choose options.
2. Select **Video** beside Do / Say / Think / Story. Selecting it does not open settings or render anything.
3. Write the scene in the composer and press **Send**, or Ctrl/Cmd+Enter. The draft clears after ComfyUI accepts it. Empty Video input cannot continue the story.
4. The video appears above the latest completed AI-written narration, or above the opening if there are no turns. The story contains the player and narration; save/share/remove/cancel controls stay in **Video settings → Adventure videos**.

**Enhance with AI** is optional. **AI-chosen length** works independently. When either is enabled, Layla makes one planning call; otherwise Wayfarer sends the entered scene with the chosen style/context directly. Narrative scripts do not run for video. Normal story generation remains available once video planning finishes.

Options are saved per adventure on this device:

- 480p or 720p; widescreen presentation with audio.
- Manual whole seconds from **1 to 225** (3 minutes 45 seconds), or AI-chosen duration.
- Optional style, independent of any image-generator style setting.
- Optional public context from the last **1, 3, or 6** completed turns. Private Think input, model reasoning, cards, memory and script internals are excluded.
- Optional PNG/JPEG/WebP starting image up to 10 MB. Without one, the first segment uses text-to-video. Images belong to the selected PC; upload again after changing servers. Removing image guidance does not delete the PC's uploaded file.

Playback uses ComfyUI's native `/view` file response and range requests. Only visible players are mounted, so long videos are not fully buffered into JavaScript memory. Saving/sharing downloads a copy when requested; Layla's save bridge supports files up to 64 MB in this app. Save larger files directly from the PC's `ComfyUI/output/wayfarer` folder.

**Remove clip** clears its Wayfarer entry and its ComfyUI history record. The MP4 remains on the PC: ComfyUI's standard API has no output-file deletion endpoint. Delete that file through your PC's file manager when you no longer need it.

## Long clips and recovery

A single ComfyUI workflow generates balanced segments of at most 15 seconds, encodes each segment, and passes its final frame as guidance for the next. Native video nodes join the encoded segments and save one MP4. ComfyUI continues executing the accepted workflow if Layla closes. No companion or phone background process is needed.

H3 generates on its `17k+5` frame grid at 24 fps; native video nodes trim to the requested whole seconds. Tiny requests generate a five-second source and trim it. 480p renders at 864×480 and crops to conventional widescreen **854×480** square-pixel output; 720p renders at 1280×736 and crops to **1280×720**. Final video is H.264 with AAC audio. Segment joins can be visible or audible. A 225-second clip requires fifteen model generations, not one short generation stretched or looped.

Wayfarer saves the request UUID before submitting and recovers it using ComfyUI queue/history. ComfyUI does not deduplicate repeated submissions, so recovery **never POSTs the same render again**. If neither queue nor history contains it, inspect ComfyUI before using **Clear unconfirmed record**. Clearing tracking does not cancel a request that arrives later.

Cancellation targets the exact request ID; Wayfarer never calls the global interrupt or clears another application's queue. A failed render is shown with its error. There is no segment-resume or retry-export action in direct mode. After a ComfyUI restart, unfinished jobs may be lost; history also belongs to ComfyUI's current session. Completed clips with already-saved file metadata remain playable as long as their output file remains present.

Connections, clip records, prompt associations and video options are device-local, separate from the story database and story backups. Keep the same URL to recover the same local clip list. Existing 1.4 companion state and files are preserved, but do not automatically appear in the new direct connection. Story saves and cards are unchanged. Source under `gateway/` is legacy only and is not included in the 1.5 mini-app package.

## Verification

See [Validation](../VALIDATION.md). `npm test` covers native graph construction, exact 1–225-second allocation, scoped cancellation, direct submission, lost-response recovery and file ownership. Browser tests cover the actual composer/settings flow and fixture playback. With ComfyUI running and its queue idle, `npm run test:comfy-direct` exercises a synthetic 225-second native workflow without model calls. `node tools/test-direct-comfy.mjs --render` explicitly runs a neutral five-second production-model smoke. Full 225-second AI generation speed and continuity are not benchmarked.
