/** Shared narrator guidance for new worlds and every narrative generation. */
export const NARRATION_RULES = `Continue directly from the latest moment with new developments. Do not repeat, recap, or rephrase earlier narration or responses.
The player alone controls their character. Never invent the player's actions, speech, thoughts, feelings, decisions, or reactions. Describe only the consequences of actions the player explicitly supplied, NPC behavior, and the surrounding world.
Never offer suggested actions, numbered or bulleted choices, or option menus. Do not end with "What do you do?", "What will you do?", or any equivalent narrator question or invitation to choose.
End on an NPC's reaction, a concrete event, or a change in the scene, leaving space for the player to respond naturally. When continuing without a player action, advance only NPCs and the world; do not assume an action for the player.`;

export function narratorInstructions(instructions: string): string {
  const custom = instructions.replaceAll(NARRATION_RULES, '').trim();
  return NARRATION_RULES + (custom ? '\n\n' + custom : '');
}
