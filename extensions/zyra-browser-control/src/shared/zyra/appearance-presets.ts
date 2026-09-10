import { ACCENT_COLORS } from '../../../../../desktop/src/shared/preferences/accent-presets'
import { getThemeDefinition, type Theme } from './settings-theme-catalog'
export { ACCENT_COLORS }
export function presetAccent(id: Theme) { return ACCENT_COLORS.find(accent => accent.name === getThemeDefinition(id).accentColor) || ACCENT_COLORS[0] }
