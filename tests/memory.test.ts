import { it, expect, vi, afterEach } from 'vitest';
import { initialStore } from '../src/seeds';
import { startAdventure } from '../src/domain';
import { layla, memoryProjections, ownedMemory, recallMemories, syncMemories } from '../src/host';
import type { LaylaMemory } from '@layla-network/sdk';
afterEach(() => vi.restoreAllMocks());
it('excludes notes and other adventures; never overwrites unverified host IDs', async () => {
  const a = startAdventure(initialStore().scenarios[0]); a.memoryBinding = { characterId: 'test', characterName: 'Test', links: { [a.cards[0].uid]: 42 } }; a.cards[0].fields.description = 'NEVER MIRROR THE BRAIN';
  const projections = memoryProjections(a); expect(JSON.stringify(projections)).not.toContain('NEVER MIRROR');
  const foreign: LaylaMemory = { id: 42, character_id: 'test', session_id: 'unrelated', rawText: 'User memory', summary: 'User memory', timestamp: 1, knowledgeGraphJSON: null };
  expect(ownedMemory(a, foreign)).toBe(false);
  vi.spyOn(layla.memories, 'list').mockResolvedValue([foreign]);
  const writes = vi.spyOn(layla.memories, 'createOrUpdate').mockImplementation(async entries => entries.map((e, i) => ({ ...e, id: 100 + i })));
  await syncMemories(a); expect(writes.mock.calls.every(call => call[0].every(m => m.id === 0))).toBe(true);
  const own = { ...foreign, id: 88, session_id: `wayfarer-${a.id}`, rawText: projections[0].raw };
  vi.spyOn(layla.memories, 'getTopMemories').mockResolvedValue([foreign, own, { ...own, rawText: projections[0].raw + ' stale' }]);
  expect(await recallMemories(a)).toEqual([own]);
});
it('cancels a pending host recall with the active turn', async () => {
  const a = startAdventure(initialStore().scenarios[0]); a.memoryBinding = { characterId: 'test', characterName: 'Test', links: {} };
  const controller = new AbortController();
  vi.spyOn(layla.memories, 'getTopMemories').mockImplementation((_character, _count, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  }));
  const request = recallMemories(a, controller.signal); controller.abort();
  await expect(request).rejects.toThrow('Cancelled');
});
