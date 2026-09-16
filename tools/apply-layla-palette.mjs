import { readFile, writeFile } from 'node:fs/promises';
// Matched to the connected phone's Layla import dialog: #222, #333, #47a6ff.
let css = await readFile('src/style.css', 'utf8');
const exact = { '#101817':'#1b1b1b', '#17211f':'#222222', '#1d2925':'#2a2a2a', '#9aa9a1':'#bcbcbc', '#b6d7b1':'#47a6ff', '#c7e9bb':'#78beff', '#131d1a':'#1c1c1c', '#e9ece3':'#f5f5f5', '#202b27':'#333333', '#1a2b20':'#061626', '#c9e7c2':'#78beff' };
css = css.replace(/#[\da-f]{6}(?:[\da-f]{2})?\b/gi, hex => {
  const base = hex.slice(0,7), alpha = hex.slice(7);
  if (exact[base]) return exact[base] + alpha;
  const [r,g,b] = [1,3,5].map(i=>parseInt(base.slice(i,i+2),16));
  if(g >= r && g >= b && g > b + 2) {
    const level = Math.min(242, Math.round((r+g+b)/3) + (g > 100 ? 15 : 5));
    return '#' + level.toString(16).padStart(2,'0').repeat(3) + alpha;
  }
  return hex;
});
css += `\n/* Layla's current dark palette, sampled on the Red Magic. */
:root{--accent:#47a6ff;--muted:#bcbcbc;--line:#ffffff16;--success:#2bc65a;--secondary:#80cbc4}
.button.primary,.send{background:var(--accent);border-color:var(--accent);color:#061626}
.button.primary:hover:not(:disabled),.send:hover:not(:disabled){background:#78beff}
.button:not(.primary):not(.danger){background:#333;color:#f5f5f5}
.brand-mark{color:var(--accent);border-color:#47a6ff66;background:#47a6ff10}
.sidebar nav button.active,.action-modes button.active,.mobile-nav button.active svg,.filter-row button.active{background:#1f2d38;color:#66b8ff;border-color:#47a6ff55}
.mobile-nav button.active,.tabs button.active,.back-link,.text-button,.round-play,.continue,.turn-actions button:hover{color:#66b8ff}
.tabs button.active{border-color:var(--accent)}
.round-play,.sidebar-create{border-color:#47a6ff66}.status-dot,.connection span,.local-badge span{background:var(--success)}
.connection,.save-indicator{color:#bcbcbc}.eyebrow,.page-top>.eyebrow,.section-heading .eyebrow,.nav-label,.mobile-status{color:#aaa}
.welcome-art>svg{color:#47a6ff40}.orbit-ring{border-color:#47a6ff29}
.welcome-art{opacity:.72}.resume-card{background:linear-gradient(100deg,#242b31,#222);border-color:#47a6ff30}
.composer{background:#222;border-color:#444}.composer-wrap{background:linear-gradient(transparent,#1b1b1b 25%)}
.composer textarea{background:transparent;color:#f5f5f5}.send.cancel{background:#e4c07c;color:#241c0e}
.notice,.toast{background:#222d36;border-color:#47a6ff40;color:#e7f1fa}.notice strong{color:#f5f5f5}
.lore-icon{color:#78beff;background:#47a6ff15}.preset{background:#222;border-color:#444}.preset>svg{color:var(--accent)}
.preset:hover,.scenario-card:hover{border-color:#47a6ff66}.prose{color:#ededed}.player-action{border-color:#47a6ff55;background:#47a6ff0c}
.player-action>span,.writing-status,.pulse-dot{color:#78beff}.pulse-dot{background:var(--accent)}
.scene{background:radial-gradient(ellipse at 65% 30%,#3b586c,#1c3041 42%,#171d24)}
.scene-orb{background:#a9d8ff;box-shadow:0 0 40px 15px #47a6ff20}.scene-stars{filter:grayscale(1)}
.ridge-back{fill:#29475f}.ridge-front{fill:#152b3c}.river{fill:#69baff28}.trees{fill:#10202d}
.scene-emblem{color:#b6dfff99;border-color:#b6dfff35}
.scene-ocean{background:radial-gradient(ellipse at 68% 25%,#346171,#203947 48%,#142632)}
.scene-dusk{background:radial-gradient(ellipse at 60% 30%,#68565a,#372c34 45%,#201e25)}
.scene-dusk .scene-orb{background:#e5c4ad}.scene-dusk .ridge-back{fill:#49353e}.scene-dusk .ridge-front{fill:#29232d}.scene-dusk .river{fill:#dba27824}.scene-dusk .trees{fill:#201c24}
`;
await writeFile('src/style.css', css);
let assets = await readFile('tools/assets.mjs', 'utf8');
const colors = {'#38523a':'#24455f','#14251b':'#1b1b1b','#b5cb97':'#47a6ff','#bfd79e':'#8bcaff','#66865d':'#2681ce','#213521':'#142534','#12241c':'#1b1b1b','#e3ead2':'#f5f5f5','#bacd9f':'#8bcaff','#496b50':'#345c78','#14271e':'#181f27','#ccdbac':'#a8d9ff','#274834':'#29475f','#152f22':'#152b3c','#afc79524':'#69baff28'};
for(const [from,to] of Object.entries(colors)) assets=assets.replaceAll(from,to);
await writeFile('tools/assets.mjs',assets);
