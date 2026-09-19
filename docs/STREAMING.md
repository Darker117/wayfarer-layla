# Streaming verification and accepted script behavior

## Implemented in the computer review build

Ordinary generation consumes the real SDK's `content` and `reasoning` events directly. Separate content snapshots update the visible answer before `finalChatCompletion()` resolves. Final fields reconcile the display and only the answer is committed. No animation expands an already completed result.

Browser tests send `<think>…</think>The gate`, then ` opens beneath the moon.`, then ` A bell rings.` through the SDK's native-message bridge. They assert each visible answer state while generation is active and the saved turn count is still zero. The host terminal event is deliberately withheld until those checks finish. Thinking remains collapsed until opened, updates live, and never enters a saved turn or next prompt.

The jump-to-latest control fades in whenever the story end is below the reading area, including during active scrolling. It hides near the end, follows composer/viewport changes, respects reduced motion, and resumes following on an explicit jump. New chunks and final saves do not pull a reader back down after scrolling upward. Browser tests cover 320, 390, and 1440 px plus a shortened viewport.

Input/Context-only scripts with empty Library and Output source also stream after their hooks complete. The sandbox has a proven identity Output fallback in that case. This narrow exception does not use a preset label, prompt marker, or guessed script flag. A browser check verifies two answer states before completion and preserves the preceding script state change.

## Native evidence and hold

Earlier phone testing observed actual reasoning, a completed saved sample response, and Stop followed by immediate Back. It did **not** capture two distinct visible intermediate answer states before completion. Native answer streaming therefore remains unverified. Version 1.4 includes the additional scrolling, player Think and narrator-instruction changes alongside local video and the PC Companion; its desktop checks do not establish native answer streaming.

## Why the current scripts cannot simply expose a later public phase

The pinned sources are unchanged. Preset names alone are not a trustworthy capability declaration because their source is editable.

- **Inner Self combines both jobs in one completion.** Its prompt templates in `src/vendor/inner-self/library.js` request a parenthetical brain operation followed by the story continuation. Context chooses that combined task around lines 2020–2035. The Output hook parses the complete response and applies brain operations around lines 2267–2750. The reasoning stream belongs to the combined private/public job; there is no protocol event announcing that only public-story reasoning has begun.
- **Even Inner Self's narrative-only Context branch still runs a whole-response Output transformation.** The Output hook can replace text with a guide, remove operation blocks, repair malformed blocks, normalize text, or take an early return based on the response exceeding 3,000 characters (around lines 2118–2123). A prefix processed in isolation is not guaranteed to equal the beginning of the final processed result.
- **Auto-Cards uses complete generation cycles.** Context selects card generation or memory compression around lines 2717–2789 of `src/vendor/auto-cards/library.js`; Output consumes those completions around lines 3041–3273. It may request another Continue. A future narrative cycle is not a second automatic generation in the current Wayfarer turn. Its public branches apply formatting and can still replace the whole output through `concludeOutputBlock` (around lines 5105–5152), including control-card/confirmation workflows and embedded user scripts. Inferring a phase from a prompt phrase or a preset label would be unsafe.
- **Arbitrary Output hooks cannot promise any visible prefix.** A hook may replace or suppress the entire response based on its final token. Publishing an earlier raw prefix could disclose text that should never have appeared.

## Accepted script behavior

The user chose to keep the existing bundled-script behavior after reviewing the extra model calls, latency, and compatibility changes required by a separate private/public generation adapter. That adapter is not part of this update.

Inner Self, Auto-Cards, and arbitrary Output-processing scripts keep their existing complete-response hooks and necessary buffering. Their private model text and reasoning remain hidden while processing; only the hook's finished output is shown. No extra model passes were added and no hooks were bypassed. Ordinary turns and the proven Input/Context-only case retain live answers and optional live thinking. The jump-to-latest and reader-follow improvements apply to the story view independently of script mode.

The accepted computer-only scope is complete. Updated phone installation, two visible intermediate native answer states, and the final current-library comparison remain pending the user's readiness. Any new user-created turns or state must be preserved when device work resumes.
