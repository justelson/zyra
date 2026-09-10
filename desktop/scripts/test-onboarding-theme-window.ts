import assert from 'node:assert/strict'
import { getThemeWindow } from '../src/renderer/src/onboarding/onboarding-theme-window'

for (const size of [0, 1, 6, 11, 12, 17, 25, 40]) {
    const catalog = Array.from({ length: size }, (_, index) => ({ id: `theme-${index}` }))
    for (const theme of catalog) {
        const visible = getThemeWindow(catalog, theme.id)
        assert.equal(visible.length, Math.min(size, 11))
        assert(visible.includes(theme), 'selection must never fall into the More themes cell')
        assert.deepEqual(visible, catalog.slice(catalog.indexOf(visible[0]), catalog.indexOf(visible[0]) + 11))
    }
    assert.deepEqual(getThemeWindow(catalog, 'missing'), catalog.slice(0, 11))
}
console.log('onboarding theme window: ok')
