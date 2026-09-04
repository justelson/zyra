export const WINDOWS_CONTROL_CURSOR_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Zyra Control Cursor</title><style>
:root{--accent-primary:#3b82f6;--accent-secondary:#60a5fa;--accent-primary-rgb:59 130 246;--accent-secondary-rgb:96 165 250;color-scheme:dark}
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;pointer-events:none}
.cursor{position:absolute;left:0;top:0;opacity:0;will-change:transform;transition-property:transform;transition-timing-function:cubic-bezier(.22,1,.36,1)}
.cursor.show{opacity:1}.visual{position:absolute;left:0;top:0;transform-origin:2px 2px}
.ring{position:absolute;left:-11px;top:-11px;width:24px;height:24px;border:1px solid rgb(var(--accent-secondary-rgb)/.72);border-radius:50%;background:rgb(var(--accent-primary-rgb)/.1);box-shadow:0 0 0 4px rgb(var(--accent-primary-rgb)/.05),0 0 18px rgb(var(--accent-primary-rgb)/.22);transition:transform 120ms cubic-bezier(.22,1,.36,1),background 120ms ease}
.cursor.pressing .ring{transform:scale(1.48);background:rgb(var(--accent-primary-rgb)/.27)}
.cursor.typing .ring,.cursor.scrolling .ring{transform:scale(1.16);background:rgb(var(--accent-secondary-rgb)/.2)}
.cursor.dragging .ring{transform:scale(1.28);background:rgb(var(--accent-primary-rgb)/.23)}
.pointer{position:absolute;left:-2px;top:-2px;width:21px;height:26px;filter:drop-shadow(0 2px 3px rgb(0 0 0/.78))}
.pointer path:first-child{fill:var(--accent-secondary)}
.tag{position:absolute;left:14px;top:15px;height:20px;display:flex;align-items:center;padding:0 7px;border:1px solid rgb(240 244 248/.1);border-radius:6px;background:rgb(12 18 31/.94);color:#f0f4f8;font:600 10px/1 "Bricolage Grotesque","Hanken Grotesk","Segoe UI",system-ui,sans-serif;white-space:nowrap;box-shadow:0 8px 24px rgb(0 0 0/.34),inset 2px 0 0 var(--accent-primary)}
@media (prefers-reduced-motion:reduce){.cursor,.ring{transition:none!important}}
</style></head><body><div id="cursor" class="cursor"><div class="visual"><i class="ring"></i><svg class="pointer" viewBox="0 0 22 27" aria-hidden="true"><path d="M2 1.5v20.2l5.1-4.5 3.5 7.2 4.1-2-3.5-7.1 7-.8L2 1.5Z" stroke="#07111f" stroke-width="1.5" stroke-linejoin="round"/><path d="M3.8 5.2v12.4l3.8-3.3 2.2 4.5" fill="none" stroke="rgb(255 255 255/.42)" stroke-width=".7" stroke-linecap="round"/></svg><span id="tag" class="tag">Zyra</span></div></div><script>
const root=document.documentElement;
const applyAppearance=(value)=>{root.style.setProperty('--accent-primary',String(value.accentPrimary||'#3b82f6'));root.style.setProperty('--accent-secondary',String(value.accentSecondary||'#60a5fa'));root.style.setProperty('--accent-primary-rgb',String(value.accentPrimaryRgb||'59 130 246'));root.style.setProperty('--accent-secondary-rgb',String(value.accentSecondaryRgb||'96 165 250'));root.dataset.reduceMotion=value.reduceMotion?'true':'false'};
globalThis.updateZyraCursor=(value)=>{applyAppearance(value);const cursor=document.querySelector('#cursor');const duration=root.dataset.reduceMotion==='true'?0:Math.max(0,Math.min(600,Number(value.durationMs)||0));cursor.style.transitionDuration=duration+'ms';cursor.style.transform='translate3d('+Number(value.x)+'px,'+Number(value.y)+'px,0)';cursor.className='cursor show '+String(value.phase||'idle');document.querySelector('#tag').textContent=value.phase&&value.phase!=='idle'?'Zyra · '+value.phase:'Zyra'};
globalThis.hideZyraCursor=()=>document.querySelector('#cursor').className='cursor';
</script></body></html>`

export const WINDOWS_CONTROL_SAFETY_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Zyra Control Indicator</title><style>
:root{--accent-primary:#3b82f6;--accent-secondary:#60a5fa;--accent-primary-rgb:59 130 246;--accent-secondary-rgb:96 165 250;color-scheme:dark}
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;pointer-events:none;font-family:"Bricolage Grotesque","Hanken Grotesk","Segoe UI",system-ui,sans-serif}
.edge{position:absolute;inset:0;overflow:hidden;box-shadow:inset 0 0 0 1px rgb(var(--accent-secondary-rgb)/.34),inset 0 0 14px rgb(var(--accent-primary-rgb)/.25),inset 0 0 44px rgb(var(--accent-primary-rgb)/.08)}
.wave{position:absolute;display:block;will-change:transform;opacity:.88}
.wave.top,.wave.bottom{left:-12%;width:124%;height:150px;background:radial-gradient(ellipse 24% 105% at 17% 0%,rgb(var(--accent-secondary-rgb)/.5),transparent 74%),radial-gradient(ellipse 31% 108% at 54% 0%,rgb(var(--accent-primary-rgb)/.37),transparent 72%),radial-gradient(ellipse 25% 100% at 88% 0%,rgb(var(--accent-secondary-rgb)/.45),transparent 72%)}
.wave.top{top:-57px;animation:wave-horizontal 9s ease-in-out infinite alternate}
.wave.bottom{bottom:-57px;transform:rotate(180deg);animation:wave-horizontal-reverse 11s ease-in-out infinite alternate}
.wave.left,.wave.right{top:-12%;height:124%;width:150px;background:radial-gradient(ellipse 105% 25% at 0% 16%,rgb(var(--accent-primary-rgb)/.44),transparent 74%),radial-gradient(ellipse 108% 31% at 0% 52%,rgb(var(--accent-secondary-rgb)/.35),transparent 72%),radial-gradient(ellipse 100% 25% at 0% 86%,rgb(var(--accent-primary-rgb)/.42),transparent 72%)}
.wave.left{left:-57px;animation:wave-vertical 10s ease-in-out infinite alternate}
.wave.right{right:-57px;transform:rotate(180deg);animation:wave-vertical-reverse 12s ease-in-out infinite alternate}
.indicator{position:absolute;left:50%;top:14px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;max-width:calc(100% - 40px);height:34px;padding:0 10px;border:1px solid rgb(240 244 248/.1);border-radius:8px;background:rgb(12 18 31/.94);color:#f0f4f8;box-shadow:0 12px 34px rgb(0 0 0/.34),inset 2px 0 0 var(--accent-primary);font-size:11px;font-weight:580;letter-spacing:-.005em;white-space:nowrap}
.signal{position:relative;width:8px;height:8px;flex:0 0 auto;border-radius:50%;background:var(--accent-secondary);box-shadow:0 0 0 4px rgb(var(--accent-primary-rgb)/.1),0 0 15px rgb(var(--accent-primary-rgb)/.52)}
.signal:after{content:"";position:absolute;inset:-4px;border:1px solid rgb(var(--accent-secondary-rgb)/.38);border-radius:50%;animation:signal-pulse 2.4s ease-out infinite}
.app-icon{width:18px;height:18px;flex:0 0 auto;display:grid;place-items:center;overflow:hidden;border:1px solid rgb(240 244 248/.12);border-radius:5px;background:rgb(var(--accent-primary-rgb)/.13);color:#f0f4f8;font-size:9px;font-weight:700}.app-icon img{display:none;width:100%;height:100%;object-fit:contain}.app-icon.has-image img{display:block}.app-icon.has-image .app-icon-fallback{display:none}
.label{min-width:0;overflow:hidden;text-overflow:ellipsis}.application{font-weight:650}.stop{display:flex;align-items:center;gap:5px;color:#aab4c3;font-size:10px;font-weight:500}.divider{width:1px;height:14px;background:rgb(240 244 248/.1)}
kbd{min-width:26px;height:20px;display:inline-flex;align-items:center;justify-content:center;padding:0 6px;border:1px solid rgb(240 244 248/.14);border-bottom-color:rgb(240 244 248/.24);border-radius:5px;background:rgb(240 244 248/.07);color:#f0f4f8;box-shadow:0 1px 1px rgb(0 0 0/.24);font:600 9px/1 "Bricolage Grotesque","Hanken Grotesk","Segoe UI",system-ui,sans-serif}
:root[data-compact="true"] .indicator{height:30px;top:12px;padding-inline:9px;font-size:10px}:root[data-compact="true"] kbd{height:18px}
@keyframes wave-horizontal{from{transform:translate3d(-3%,0,0) scaleX(.97)}to{transform:translate3d(3%,5px,0) scaleX(1.03)}}
@keyframes wave-horizontal-reverse{from{transform:rotate(180deg) translate3d(-2%,0,0) scaleX(.98)}to{transform:rotate(180deg) translate3d(3%,-4px,0) scaleX(1.04)}}
@keyframes wave-vertical{from{transform:translate3d(0,-3%,0) scaleY(.97)}to{transform:translate3d(5px,3%,0) scaleY(1.03)}}
@keyframes wave-vertical-reverse{from{transform:rotate(180deg) translate3d(0,-2%,0) scaleY(.98)}to{transform:rotate(180deg) translate3d(-4px,3%,0) scaleY(1.04)}}
@keyframes signal-pulse{0%{transform:scale(.72);opacity:.72}72%,100%{transform:scale(1.58);opacity:0}}
@media(max-width:520px){.indicator{top:10px;height:30px;transform:translateX(-50%) scale(.9);transform-origin:top center}.stop>span{display:none}}
@media(prefers-reduced-motion:reduce){.wave,.signal:after{animation:none!important}}
:root[data-reduce-motion="true"] .wave,:root[data-reduce-motion="true"] .signal:after{animation:none!important}
</style></head><body><div class="edge" aria-hidden="true"><i class="wave top"></i><i class="wave right"></i><i class="wave bottom"></i><i class="wave left"></i></div><div id="indicator" class="indicator" role="status" aria-live="polite" aria-label="Zyra is using this app"><i class="signal"></i><span id="app-icon" class="app-icon" aria-hidden="true"><img id="app-icon-image" alt=""><span id="app-icon-fallback" class="app-icon-fallback">A</span></span><span id="label" class="label">Zyra is using <strong class="application">this app</strong></span><i class="divider"></i><span class="stop"><span>Stop</span><kbd id="key">Esc</kbd></span></div><script>
const root=document.documentElement;
const applyAppearance=(value)=>{root.style.setProperty('--accent-primary',String(value.accentPrimary||'#3b82f6'));root.style.setProperty('--accent-secondary',String(value.accentSecondary||'#60a5fa'));root.style.setProperty('--accent-primary-rgb',String(value.accentPrimaryRgb||'59 130 246'));root.style.setProperty('--accent-secondary-rgb',String(value.accentSecondaryRgb||'96 165 250'));root.dataset.reduceMotion=value.reduceMotion?'true':'false';root.dataset.compact=value.compact?'true':'false'};
globalThis.updateZyraSafety=(value)=>{applyAppearance(value);const applicationName=String(value.application||'this app');document.querySelector('#indicator').setAttribute('aria-label','Zyra is using '+applicationName);const label=document.querySelector('#label');label.textContent='Zyra is using ';const application=document.createElement('strong');application.className='application';application.textContent=applicationName;label.append(application);document.querySelector('#key').textContent=String(value.key||'Ctrl+Alt+Esc');const iconRoot=document.querySelector('#app-icon');const iconImage=document.querySelector('#app-icon-image');const iconData=String(value.applicationIconDataUrl||'');if(iconData.startsWith('data:image/png;base64,')){iconImage.src=iconData;iconRoot.classList.add('has-image')}else{iconImage.removeAttribute('src');iconRoot.classList.remove('has-image')}document.querySelector('#app-icon-fallback').textContent=applicationName.trim().charAt(0).toUpperCase()||'A'};
</script></body></html>`
