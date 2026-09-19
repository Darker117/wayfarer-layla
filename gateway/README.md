# Wayfarer PC Companion

Generate videos on your PC from the Wayfarer mini-app in Layla. This Windows companion connects the phone to your existing ComfyUI setup and manages reusable connection codes.

## Start here

1. Extract **wayfarer-pc-companion-1.4.0.zip** into a folder on your PC.
2. Check the [requirements and setup instructions](../docs/VIDEO.md#start-the-pc-companion). Node.js, ComfyUI, Comfy MCP, FFmpeg and the workflow's model files are installed separately.
3. Start ComfyUI, then double-click **Start-Wayfarer-PC-Companion.cmd** in this folder.
4. The companion opens in your browser. Create a code for **10, 20, or 30 minutes**, or **Forever** (the default). Saved codes can be copied, reused and deleted.
5. In Wayfarer 1.4 or newer, open **Video settings** and enter your PC's private HTTPS address and the code. Choose **Pair desktop**.

Use the [Wayfarer mini-app download](https://github.com/Darker117/wayfarer-layla/releases/tag/v1.4.0) on the phone. The PC companion stays on the PC.

## Connection codes

Codes survive companion restarts. Their duration controls **new pairings**: connected devices can finish their videos after a timed code expires. Deleting a code prevents future use and disconnects every device paired through that code. Each pairing keeps its own adventure clips separate.

The companion runs in the background. Reopen its page at **http://127.0.0.1:8788**. Logs and saved data are in `%LOCALAPPDATA%\WayfarerVideo`. The existing `Start-Wayfarer-Video.cmd` launcher remains available.

## Video options

- 480p or 720p, 16:9 with audio.
- 1–225 seconds (3 minutes 45 seconds), or a length chosen by Layla.
- Optional prompt enhancement, public story context, video style and starting image.
- Longer videos use newly generated segments guided by the previous segment's final frame. Joins may be visible or audible.
- Progress, cancellation, recovery, playback and saving are controlled from Wayfarer.

This is a launcher-based companion, not a bundled ComfyUI installer. Model weights and third-party runtimes are not included. See [validation notes](../VALIDATION.md) for actual tests and remaining phone checks.
