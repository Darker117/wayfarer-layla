import type { ChatCompletionStream } from '@layla-network/sdk';

export interface StreamView {
  onText: (text: string) => void;
  onThinking?: (text: string) => void;
  signal: AbortSignal;
}

/** Consume the SDK's separate channels; raw host text never reaches the UI. */
export async function readResponse(stream: ChatCompletionStream, view: StreamView): Promise<string> {
  const content = (_delta: string, snapshot: string) => { if (!view.signal.aborted) view.onText(snapshot); };
  const reasoning = (_delta: string, snapshot: string) => { if (!view.signal.aborted) view.onThinking?.(snapshot); };
  const ignoreError = () => {};
  stream.on('content', content).on('reasoning', reasoning).on('error', ignoreError);
  try {
    const result = await stream.finalChatCompletion();
    if (view.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const message = result.choices[0]?.message;
    // Reconcile with the canonical completion, including hosts that finish in
    // one update. Reasoning is display-only, never part of the returned answer.
    view.onText(message?.content ?? '');
    view.onThinking?.(message?.reasoning ?? '');
    return message?.content ?? '';
  } finally {
    stream.off('content', content).off('reasoning', reasoning).off('error', ignoreError);
  }
}
