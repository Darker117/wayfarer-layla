# Script compatibility — Wayfarer 1.0

This is a bounded AI Dungeon-style environment, not a claim of universal AI Dungeon compatibility.

## Supported

- Synchronous JavaScript Library + Input / Context / Output hooks; the final expression (usually `modifier(text)`) supplies `{ text, stop }`.
- Fresh globals for each hook; Library is evaluated with that hook. Global `text`/`stop` changes and returned overrides work.
- Persistent JSON-serializable `state`, including `state.memory.context`, `authorsNote`, `frontMemory`, and `state.message`.
- Ordered history with `text`, `rawText`, and action types `start`, `do`, `say`, `story`, `continue`. Context and Output see the current input. Input sees earlier actions. Private player Think is stored as `mode: "think"`; script history uses the existing `type: "story"` plus `sourceMode: "think"` and `visibility: "private"`. Its raw action is labeled as a private thought, never audible Say. This keeps the legacy type vocabulary intact.
- `info.actionCount`, `characterNames`; Context additionally receives `maxChars`, `memoryLength`.
- `storyCards` / `worldInfo` are aliases. Export `value` maps to script `entry`; exact `description` notes are preserved. Array order and direct card mutations persist.
- `addStoryCard(keys, entry = '', type = 'custom', title = keys, description = '', options = {})`. Returns index, or the actual card when `options.returnCard` is true. Duplicate keys return false. The extra arguments are required by the current Inner Self source.
- `updateStoryCard(index, keys, entry, type, title?, description?)`, `removeStoryCard(index)`, and the `addWorldEntry`, `updateWorldEntry`, `removeWorldEntry` aliases.
- `log`, `console.log/warn/error/info/debug`, and `sandboxConsole.log`. Logs are bounded and visible from the adventure menu.
- Context contains `AI Instructions`, optional `Plot Essentials`, `Adventure Memory`, `World Lore`, and `Recent Story:`. Author's note precedes the latest response; front memory follows the latest input. `memoryLength` describes the exact prefix before `Recent Story:`.
- Output hooks receive the complete generation. Calls with Library or Output source are buffered so internal generations do not stream to the visible story. Input/Context-only scripts with empty Library and Output source stream after those hooks complete; their Output fallback leaves text unchanged. The script decides what becomes prose. Empty and zero-width script outputs are retained for state/history but displayed as a state update.

## Bundled versions

Original, unmodified upstream files are under `src/vendor/`:

| Script | Pinned upstream commit |
| --- | --- |
| [Inner Self](https://github.com/LewdLeah/Inner-Self) | `297a1a04c0e11b41f69e3e57a607b47eee34334b` |
| [Auto-Cards](https://github.com/LewdLeah/Auto-Cards) | `c8a4e4d6e1ef03b3177fa35c8c332afe1f914aa3` |

Inner Self includes its own integrated Auto-Cards version. Use one preset; loading both libraries independently is unnecessary. Configuration cards and NPC brains remain editable in the card manager.

## Deliberate differences and limits

- Undo restores the complete pre-turn checkpoint. Retry restores the checkpoint after Input and reruns Context/generation/Output; it does not replay Input side effects. This is transactional rollback, not an exact emulation of AI Dungeon's retained-state retry counters.
- `stop: true` commits script state without generation/prose; it is presented as a paused turn rather than AI Dungeon's generic error messages. Empty Input/Output is accepted to support internal update turns.
- The opening scene is shown directly from the template; it is not treated as an initial model generation.
- Scenario placeholder questionnaires, multiplayer, native AI Dungeon model services, async hooks, timers, imports, network access, DOM, and arbitrary host APIs are not implemented.
- Scripts cannot independently invoke a model API. Multi-step generators such as Auto-Cards may redirect the normal Context/Output cycle and ask the player to Continue. Wayfarer does not automatically keep generating on an empty response.
- Native model output quality depends on the selected Layla model following the script's prompts and structured-output format. Passing deterministic compatibility tests does not guarantee every model will reliably produce valid NPC updates.
- Think is visible to the narrator and scripts, but instructions exclude it from NPC observations. Private labels survive Wayfarer context truncation even when Input rewrites the text. Scripts can replace context, summarize history or mutate NPC/card state; their existing semantics are preserved and the host guidance cannot guarantee that a script or model respects every knowledge boundary. Wayfarer adds no private/public adapter, output filter or extra generation pass.
- Backups keep store version 1 and accept the additive Think mode. Current builds still read older backups; older app versions that validate a fixed mode list may reject backups containing Think.
- Context budgets are estimated in characters; they are not token-exact. Extremely long instructions/lore are bounded so recent story has room. The host may impose its own model context limits.
- QuickJS runs inside a separate disposable Web Worker, with a 48 MB runtime allocation budget, 1 MB stack budget, 1.5-second interpreter deadline, and 10-second worker deadline. Serialized input/output is capped at 10 MB. These are resource guards, not a guarantee against every possible browser/engine implementation flaw.
- Card enabled/pinned controls affect Wayfarer's context selection. Scripts still see every card, including configuration/brain cards. Notes do not enter normal context unless the script deliberately selects them.

See `VALIDATION.md` for observed tests, including what was verified on the physical phone.

## Optional video

Video is a separate composer action, not a saved turn mode. It never invokes Input/Context/Output hooks or mutates adventure snapshots. Its context builder selects only public completed story passages and observable player input. Think text, model reasoning, private card fields and script state are excluded. Device video preferences and connection records stay outside the store-version-1 library and all story backups. Wayfarer 1.5 connects directly to ComfyUI; AI prompt enhancement and AI duration selection additionally require Layla. See [video setup](docs/VIDEO.md).
