/** Shared narrator guidance for new worlds and every narrative generation. */
const ORIGINAL_RULES = `Continue directly from the latest moment with new developments. Do not repeat, recap, or rephrase earlier narration or responses.
The player alone controls their character. Never invent the player's actions, speech, thoughts, feelings, decisions, or reactions. Describe only the consequences of actions the player explicitly supplied, NPC behavior, and the surrounding world.
Never offer suggested actions, numbered or bulleted choices, or option menus. Do not end with "What do you do?", "What will you do?", or any equivalent narrator question or invitation to choose.
End on an NPC's reaction, a concrete event, or a change in the scene, leaving space for the player to respond naturally. When continuing without a player action, advance only NPCs and the world; do not assume an action for the player.`;

export const KNOWLEDGE_RULES = `Say is audible dialogue; Think is private player thought, never speech or an observable action. NPCs know only what they witnessed, heard, were told, or plausibly learned through an established source. Narrator knowledge, world lore and memory are not automatically NPC knowledge. Keep private thoughts, plans and offstage events private unless the player reveals them or an established in-world ability conveys them. Distinguish observation from inference and rumor; retain uncertainty. Never invent a source to justify knowledge. Preserve who knows what, sources and privacy when summarizing or creating lore.`;
export const PROSE_STYLE_RULES = `Never use "ozone" as a descriptor in generated narrative, openings, summaries or card prose. Choose a concrete detail appropriate to the scene instead. Preserve user text and structured fields without substitution.`;
export const NARRATION_RULES = ORIGINAL_RULES + '\n' + KNOWLEDGE_RULES + '\n' + PROSE_STYLE_RULES;

export function narratorInstructions(instructions: string): string {
  const custom = instructions.replaceAll(NARRATION_RULES, '').replaceAll(ORIGINAL_RULES, '').trim();
  return NARRATION_RULES + (custom ? '\n\n' + custom : '');
}
