import type { Scripts } from '../domain';
import innerLibrary from '../vendor/inner-self/library.js?raw';
import innerInput from '../vendor/inner-self/input.js?raw';
import innerContext from '../vendor/inner-self/context.js?raw';
import innerOutput from '../vendor/inner-self/output.js?raw';
import autoLibrary from '../vendor/auto-cards/library.js?raw';
import autoInput from '../vendor/auto-cards/input.js?raw';
import autoContext from '../vendor/auto-cards/context.js?raw';
import autoOutput from '../vendor/auto-cards/output.js?raw';
export function presetScripts(preset: 'inner-self' | 'auto-cards'): Scripts {
  return preset === 'inner-self'
    ? { enabled: true, preset, library: innerLibrary, input: innerInput, context: innerContext, output: innerOutput }
    : { enabled: true, preset, library: autoLibrary, input: autoInput, context: autoContext, output: autoOutput };
}
