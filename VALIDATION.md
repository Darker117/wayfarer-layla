# Validation

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

When updating an existing installation, fully restart Layla after overwriting the app ZIP. Layla 7.4 can otherwise retain a stale database connection; clearing app data is unnecessary.
