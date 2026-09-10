import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Search, Link2 } from 'lucide-react';
import { THEMES } from '../shared/zyra/settings-theme-catalog';
import { resolveAppearance, type ThemePreference, type ZyraAppearance } from '../shared/appearance';
export function ThemePicker({ value, appearance, disabled, onChange }: { value: ThemePreference; appearance: ZyraAppearance; disabled: boolean; onChange: (value: ThemePreference) => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), search = useRef<HTMLInputElement>(null);
  const id = useId();
  const current = resolveAppearance('zyra', appearance, matchMedia('(prefers-color-scheme: dark)').matches);
  const options = [{ id: 'zyra' as ThemePreference, name: 'Follow Zyra', color: current.tokens.bg, accent: current.accent.primary }, ...THEMES.map(t => ({ id: t.id as ThemePreference, name: t.name, color: t.tokens.bg, accent: t.tokens.primary }))];
  const filtered = options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()));
  const selected = options.find(o => o.id === value)!;
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useEffect(() => { if (!open) return; search.current?.focus(); const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside); }, [open]);
  useEffect(() => { if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [open, active, id]);
  const choose = (next: ThemePreference) => { onChange(next); close(true); };
  return <div className={'theme-picker' + (open ? ' open' : '')} ref={root} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) close(); }} onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    if (!open) { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(0); } return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(n => Math.max(0, Math.min(filtered.length - 1, n + (e.key === 'ArrowDown' ? 1 : -1)))); }
    if (e.key === 'Enter' && e.target === search.current && filtered[active]) { e.preventDefault(); choose(filtered[active].id); }
  }}>
    <button ref={trigger} type="button" className="theme-trigger" aria-label="Theme" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => { setQuery(''); setActive(0); setOpen(!open); }}><i className="theme-swatch" style={{ background: selected.color, borderColor: selected.accent }}/><span>{selected.name}</span><ChevronDown size={13}/></button>
    {open && <div className="theme-menu"><label className="theme-search"><Search size={13}/><input ref={search} role="combobox" aria-label="Search themes" aria-expanded="true" aria-controls={id} aria-autocomplete="list" aria-activedescendant={filtered[active] ? `${id}-${active}` : undefined} placeholder="Search themes…" value={query} onChange={e => { setQuery(e.target.value); setActive(0); }}/></label><div id={id} role="listbox" aria-label="Zyra themes" className="theme-options">{filtered.map((theme, index) => <button key={theme.id} id={`${id}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={value === theme.id} className={index === active ? 'highlighted' : ''} onPointerMove={() => setActive(index)} onClick={() => choose(theme.id)}>{theme.id === 'zyra' ? <Link2 size={13}/> : <i className="theme-swatch" style={{ background: theme.color, borderColor: theme.accent }}/>}<span>{theme.name}</span>{value === theme.id && <Check size={13}/>}</button>)}{!filtered.length && <p className="no-themes">No matching themes</p>}</div></div>}
    <span className="theme-source">{value === 'zyra' ? (appearance.available ? current.name : 'Waiting for Zyra') : 'Browser only'}</span>
  </div>;
}
