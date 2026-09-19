# Validation

## Version 1.4.1 — Inline story videos

- Video is a selected composer mode. Send and Ctrl/Cmd+Enter submit the draft with saved video parameters; selecting the mode never generates or opens settings. Empty Video input cannot continue the narrative. Accepted submissions clear the draft, while failed submissions preserve it.
- Video progress and playback appear between AI passages. Original video prompts and ordering are saved on the sending device, independently of narrative turns and scripts. Reopening an adventure recovers owned clips and their positions. Offscreen video buffers are released to bound mobile memory usage.
- Video settings stays at the bottom left. Adventure videos provides direct playback, save/share, cancellation, recovery and deletion, with the same operations available inline.
- All **74 core tests** and **37 browser checks** pass, plus TypeScript and production packaging. Browser checks exercise a real synthetic MP4, verify playback time advances, and cover the native save-file request through a simulated Layla bridge. They also cover all enhancement/AI-length combinations, uploaded images and chosen parameters, inline errors and lost-reply recovery, chronological placement, reopen, deletion, and 320/390/1440 px layouts.
- No new GPU render or phone interaction was performed for this UI update. Existing PC Companion 1.4.0 remains compatible; its 1.4.1 download only updates usage documentation. The earlier native playback/save/share checks remain user testing tasks.

## Version 1.4.0 — Local video and PC Companion

- The PC Companion manages persistent, reusable connection codes with 10/20/30-minute or Forever validity. Forever is the default. Gateway checks cover reuse, persistence across restarts, expiry for new pairings, deletion revoking linked device credentials, and local-only code management. Browser checks cover code creation, reload, deletion and layouts at 320/390/960 px. The companion has a separate Windows download and launcher.

- **74 core unit tests**, **11 gateway integration tests**, and **34 browser checks** pass, including the PC Companion's saved code controls. TypeScript, production build and whitespace checks pass.
- Composer Video submits the existing draft directly. Tests cover all four combinations of optional AI enhancement / AI-chosen duration: zero model calls when both are off, one when either or both are on. The public structured result excludes model reasoning; private Think input/script fields are absent from video context. Story turns, action selection and draft remain intact.
- Gateway tests cover auth/CORS, fixed workflow overrides, exact model frame grid, every 1–225-second segment allocation, wrong-owner/wrong-adventure rejection, idempotent submission, cancellation during deferred validation/submission, late-submission tombstones, persisted identities and failed MCP child handling. Browser checks include uploads, errors, custom lengths, reconnect after a lost response, and 320/390/1440 px layout. Screenshots are included.
- **Real local model smoke:** a neutral 480p 5-second clip passed through gateway → Python MCP stdio → ComfyUI FastH3, with observed sampling progress and native audio. An export aspect-ratio issue was fixed by preserving the exact pixel-aspect rational; its existing source was re-exported without a second model generation. Final streams are exactly 5.000 seconds, H.264/AAC, 852×480, 16:9 display aspect.
- **Real sequential model smoke:** a 16-second request generated two independent 8-second segments. The first was text-to-video; the second used an uploaded final frame from the first. A last-frame seek issue was fixed and the second segment resumed from the saved first segment. The final H.264 video and AAC audio streams are exactly 16.000 seconds; the MP4 container reports 16.031982 seconds from AAC padding. Stills on both sides of the join were inspected. Full-length motion quality and seamless audio are not claimed.
- **Full 225-second synthetic pipeline:** real gateway/FFmpeg with mock MCP/Comfy sources completed fifteen segments and fourteen continuation-image uploads. A gateway restart after segment two submitted resumed the known job without duplicate submission (15 total). Cancel during the next guide upload prevented the next submission. Maximum accepted ID/prompt lengths remained valid. Final synthetic container duration was 225.031982 seconds, H.264/AAC, 16:9. This used **zero GPU calls** and does not constitute a real 225-second model benchmark. Reproduce with `npm run test:video-segments`.
- Windows launcher and local Python MCP initialization were exercised. The authenticated API is loopback-only; private Tailscale HTTPS proxies only port 8787. Unauthenticated HTTPS requests return 401. The companion page stays local on 8788. No public Funnel, existing ComfyUI restart or model download occurred during video validation.
- **Remaining user checks:** pair the phone through its Tailscale connection; verify Layla WebView HTTPS/CORS, image picking, video/audio playback, save/share and device-local preference persistence. Phone installation and user testing are separate from the desktop results above. Prior 1.3 device validation does not establish these new video behaviors.

## Version 1.3.0 review build — Private player thoughts and perspective

- The floating arrow now fades in while above the latest passage, including during active scrolling. It keeps the earlier reduced-motion, viewport placement and reader-position protections.
- Think is an explicit saved turn mode. New tests cover transformed script input, private context boundaries under truncation, replay, Redo, Undo, backup restore, and exclusion from host memory. Say remains audible dialogue. Legacy script history types are preserved with additive private metadata.
- NPC perspective and the “ozone” descriptor preference use shared AI instructions, including scenario/card JSON drafts and host generation. Tests assert one model call, exact structured output and no rewriting of source text. No extra model pass, text substitution or enforcement filter was added. Instructions cannot guarantee model behavior or undo a script's own memory/context choices.
- All **65 core tests** and the current production TypeScript/build checks pass. All **24 browser integration checks** pass after updating scroll synchronization and the Resume locator in the affected tests (19 passed in the first full run; all seven affected checks passed on rerun). Think/Say save, Redo, resume, Undo and cancellation were exercised at 320, 390 and 1440 px, with 44 px controls and no horizontal overflow. Changed-UI screenshots were visually reviewed.
- Historical follow-up: 1.3.0 was later installed with explicit authorization and the original 44-turn adventure remained visible. Native testing was stopped at the user’s request before a full post-install backup comparison. Distinct native answer-stream snapshots remain unverified. No new commit, push or release was made; the current 1.4 work remains computer-only.

## Version 1.2.0 review build — Live answers, thinking, and jump to latest

- Ordinary turns stream the SDK's answer snapshots. Model-provided reasoning uses a separate, initially collapsed **Show thinking** panel that can be toggled during generation. Thinking is temporary and never persisted or included in a later prompt.
- Script turns with Library or Output source buffer both channels. Input/Context-only scripts with neither source stream after their hooks complete. Tests exercise actual Inner Self brain operations and Auto-Cards card generation, plus custom Output hooks that transform or suppress a response. Internal script work never appears as live prose or model thinking.
- **56 core tests** cover split thinking markers at every boundary, one-character chunks, multiple blocks, incomplete markers, reasoning before JSON, final reconciliation, late events, cancellation, and existing storage/memory/script behavior.
- All **21 browser integration checks** and the production TypeScript/build checks pass. Streaming checks use the real SDK with a controlled native bridge to verify distinct visible answer snapshots before the terminal event, collapsed/expanded behavior, Redo, Stop, error cleanup, canonical-only saves, and delayed events from a cancelled request. Layout checks include a 320 px thinking panel, preserving its reading position, and keeping live text above the composer.
- The floating down-arrow passes idle/active-scroll/bottom visibility checks at 320, 390, and 1440 px. Tests cover reduced motion, shorter viewports, returning to live text, resumed following, and preserving the reader's position during new chunks and the final save.
- The SDK's standard thinking protocol is supported. Malformed non-protocol tags remain ordinary text; an unclosed thinking block with no answer fails without saving. No reasoning is synthesized when the model provides none.
- Earlier native testing showed actual reasoning, a saved sample response, and cancellation with immediate Back. Distinct intermediate **answer** states have not yet been captured on the phone. Device work is on hold at the user's request; the current computer build is not installed or published. The fresh pre-update backup is retained, and final current-library comparison remains pending. The user chose to keep existing bundled-script buffering instead of adding separate private/public model passes; see [streaming investigation](docs/STREAMING.md).

## Version 1.1.3 — Database recovery guidance and storage checks

- Reproduced `NativeDatabase.execAsync` / `java.lang.NullPointerException` on Layla 7.4.0 Direct during startup, without a ZIP import in that session. A page retry failed again. Force stopping and relaunching Layla recovered the current library. A subsequent ordinary mini-app exit/reopen succeeded.
- The failing native initialization belongs to Layla. Its SDK provides no native connection reset API. The exact event that originally invalidated the connection remains unconfirmed; this release improves recovery guidance and storage validation, not the host's native lifecycle.
- Startup now distinguishes this host failure and gives explicit Android Force stop steps. Original error text remains available under Error details.
- An invalid result or missing/null payload can no longer be mistaken for an empty library and overwritten by starter data. A save requires exactly one confirmed affected row; failed writes are not replayed automatically.
- Schema initialization is shared by concurrent operations, and failed initialization does not remain cached by Wayfarer.
- All **42 core tests** and **10 browser integration checks** pass, including the real SDK bridge with simulated native failures and recovery. Production TypeScript/build checks pass.
- Installed on the physical device. A temporary test adventure saved and survived a full Layla restart. After removing that test entry, a fresh export matched the complete pre-update library exactly. The revised error screen also fits at 320 px with its technical details expanded.

## Version 1.1.2 — Stop button fix

The previous release reproduced an unwanted second `send_message` after clicking Stop: React reused the button as a submit button before the click’s default action finished. The fix prevents that default action and gives Send and Stop distinct element keys. Cancellation still uses the SDK’s abort signal and native cancel command.

The production build and all **8 browser integration checks** pass. The regression check requires exactly one cancel per deliberate send, immediate Back availability, preservation of the unsent draft, no saved partial turn, and a successful second send/cancel cycle. It failed against 1.1.1 by observing two sends after one click, and passes with the fix.



## Version 1.1.1

- TypeScript and the self-contained production build pass.
- **21 core tests** pass: exact card round trips, unknown fields and private-note handling, context bounds, isolated saves, memory ownership, script compatibility, and turn transactions.
- Redo tests cover Do, Say, Story, and Continue. The same original action and prior history reach generation, the previous response is excluded, a new response replaces only the latest turn, and errors/cancellation leave the saved adventure intact.
- **7 browser integration checks** pass. These cover AI scenario drafts, narration rules retained alongside custom style, card import, the real QuickJS worker, nested dialogs, honest generation availability outside Layla, and the composer at 320, 390, and 1440 px.
- Empty or whitespace-only input submits Continue. Ctrl/Cmd+Enter uses the same behavior. Redo stays disabled before the first turn and during generation, and preserves both the unsent draft and selected action mode.
- A separate visual review captures 26 screens across 320, 360, 390, 768, and 1440 px with no horizontal overflow or page errors.

Browser generation tests use the SDK's explicit development mock. They verify integration behavior, not model quality. The mock's canned story response is excluded from the production package. Narrator instructions guide the model; they cannot guarantee perfect compliance from every model.

## Android integration

Physical-device testing uses a REDMAGIC 11 Pro with Android 16 and Layla 7.4.0 Direct. Prior release testing verified ZIP import, native SQLite persistence, real local-model generation, retry, cancellation, card handling, and the Inner Self worker. Native memory tests verified adventure ownership and private-note exclusion.

Local backup comparisons and phone screenshots are kept out of the public repository because they may contain personal stories or device details. Public screenshots show only bundled sample worlds and demo data.

When updating an existing installation, fully restart Layla after overwriting the app ZIP. A native database connection failure can also recur during ordinary use. If page retry fails, use Android Settings → Apps → Layla → Force stop, then reopen Wayfarer. Clearing app data is unnecessary.
