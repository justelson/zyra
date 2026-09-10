import { z } from 'zod';
import { getThemeDefinition, isThemeId, isLightThemeId, isDarkThemeId, type Theme, type ThemeTokens } from './zyra/settings-theme-catalog';
import { ACCENT_COLORS, presetAccent } from './zyra/appearance-presets';
export type ThemePreference = 'zyra' | Theme;
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const tokens = z.object(Object.fromEntries(Object.keys(getThemeDefinition('dark').tokens).map(key => [key, color])) as Record<keyof ThemeTokens, typeof color>);
const accent = z.object({ primary: color, secondary: color });
const theme = z.custom<Theme>(isThemeId);
export const appearanceSchema = z.object({
  available: z.boolean(),
  reduceMotion: z.boolean().optional(),
  mode: z.enum(['system', 'light', 'dark']),
  lightTheme: theme.refine(isLightThemeId),
  darkTheme: theme.refine(isDarkThemeId),
  accent: accent.optional(),
  custom: z.object({ name: z.string().max(100), baseTheme: theme, tokens, accent }).optional()
});
export type ZyraAppearance = z.infer<typeof appearanceSchema>;
export const unavailableAppearance: ZyraAppearance = { available: false, mode: 'system', lightTheme: 'paper-light', darkTheme: 'vercel' };
export function isThemePreference(value: unknown): value is ThemePreference { return value === 'zyra' || isThemeId(value); }
// Only appearance fields cross the bridge. The device record never leaves the host.
export function appearanceFromPreferences(record: unknown): ZyraAppearance {
  const envelope = z.object({ schemaVersion: z.literal(1), shared: z.record(z.unknown()) }).parse(record);
  const s = envelope.shared;
  const mode = s.appearanceThemeMode === 'light' || s.appearanceThemeMode === 'dark' ? s.appearanceThemeMode : 'system';
  const lightTheme = isLightThemeId(s.appearanceLightTheme) ? s.appearanceLightTheme : 'paper-light';
  const darkTheme = isDarkThemeId(s.appearanceDarkTheme) ? s.appearanceDarkTheme : 'vercel';
  const custom = s.appearanceCustomTheme as Record<string, unknown> | undefined;
  const customResult = s.appearanceCustomThemeActive && mode !== 'system' && custom
    ? appearanceSchema.shape.custom.safeParse({ name: 'Custom', baseTheme: custom.baseTheme, tokens: sanitizeTokens(custom.tokens, custom.baseTheme), accent: sanitizeAccent(custom.accentColor) }) : null;
  const accentResult = accent.safeParse(sanitizeAccent(s.accentColor ?? presetAccent('vercel')));
  return { available: true, mode, lightTheme, darkTheme, reduceMotion: s.accessibilityReduceMotion === true,
    ...(accentResult.success ? { accent: accentResult.data } : {}),
    ...(customResult?.success && customResult.data?.baseTheme === (mode === 'light' ? lightTheme : darkTheme) ? { custom: customResult.data } : {}) };
}
function sanitizeAccent(value: unknown) {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return ACCENT_COLORS.find(a => a.name === candidate.name) || (candidate.name === 'Custom' && accent.safeParse(candidate).success ? accent.parse(candidate) : ACCENT_COLORS[0]);
}
function sanitizeTokens(value: unknown, id: unknown) {
  if (!isThemeId(id)) return value;
  const base = getThemeDefinition(id).tokens, input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(base).map(([key,fallback]) => [key, color.safeParse(input[key]).success ? input[key] : fallback]));
}
export function resolveAppearance(preference: ThemePreference, zyra: ZyraAppearance, systemDark: boolean) {
  const follows = preference === 'zyra';
  const id = follows ? (zyra.mode === 'dark' || (zyra.mode === 'system' && systemDark) ? zyra.darkTheme : zyra.lightTheme) : preference;
  const definition = getThemeDefinition(id);
  const custom = follows && zyra.custom?.baseTheme === id ? zyra.custom : undefined;
  const activeAccent = presetAccent(id), inactiveAccent = presetAccent(id === zyra.lightTheme ? zyra.darkTheme : zyra.lightTheme);
  let selectedAccent = follows ? zyra.accent : activeAccent;
  const sameAccent = (a: {primary:string;secondary:string}, b: {primary:string;secondary:string}) => a.primary.toLowerCase() === b.primary.toLowerCase() && a.secondary.toLowerCase() === b.secondary.toLowerCase();
  if (follows && zyra.mode === 'system' && selectedAccent && !sameAccent(activeAccent,inactiveAccent) && sameAccent(selectedAccent,inactiveAccent)) selectedAccent = activeAccent;
  return { id, name: custom?.name || definition.name, appearance: isLightThemeId(id) ? 'light' as const : 'dark' as const,
    tokens: custom?.tokens || definition.tokens,
    accent: custom?.accent || selectedAccent || activeAccent };
}
