import { useEffect, useState } from 'react';
import { resolveAppearance, unavailableAppearance } from '../shared/appearance';
import { resolveAccentTokens, resolveStatusTokens, resolveThemeTokens } from '../shared/zyra/settings-theme-semantics';
import type { ExtensionState } from '../shared/protocol';
export function useAppearance(state: ExtensionState | null) {
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => { const media = matchMedia('(prefers-color-scheme: dark)'); const changed = () => setSystemDark(media.matches); media.addEventListener('change', changed); return () => media.removeEventListener('change', changed); }, []);
  const resolved = resolveAppearance(state?.theme || 'zyra', state?.zyraAppearance || unavailableAppearance, systemDark);
  useEffect(() => {
    const root = document.documentElement, t = resolveThemeTokens(resolved.tokens);
    const accent = resolveAccentTokens(resolved.accent.primary, resolved.accent.secondary, t.bg);
    const status = resolveStatusTokens(t.bg, t.primary);
    const variables = { bg: t.bg, text: t.text, secondary: t.textDarker, muted: t.textSecondary, faint: t.textMuted, card: t.card, border: t.border,
      primary: accent.primary, 'on-primary': accent.onPrimary, success: status.success, danger: status.danger };
    for (const [name, value] of Object.entries(variables)) root.style.setProperty('--' + name, value);
    root.dataset.theme = resolved.id; root.style.colorScheme = resolved.appearance;
  }, [resolved.id, resolved.tokens, resolved.accent.primary, resolved.accent.secondary]);
  return resolved;
}
