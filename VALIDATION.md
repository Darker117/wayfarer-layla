# Validation

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
