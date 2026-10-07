import assert from 'node:assert/strict'
import { visualizationPaletteCss } from '../src/renderer/src/components/ui/visualization/visualization-palette'

const rgb = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16))
const luminance = (color: readonly number[]) => color.reduce((sum, channel, index) => {
    const value = channel / 255
    return sum + [0.2126, 0.7152, 0.0722][index]! * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
}, 0)
const contrast = (a: readonly number[], b: readonly number[]) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)

for (const scheme of ['dark', 'light'] as const) {
    const tokens = Object.fromEntries(visualizationPaletteCss(scheme).split(';').map(declaration => declaration.split(':')))
    const low = rgb(tokens['--viz-heat-low']!), high = rgb(tokens['--viz-heat-high']!)
    const foregrounds = scheme === 'dark' ? ['#eef1f6'] : ['#20242b', '#18212b']
    let previous = luminance(low)
    for (let value = 0; value <= 100; value++) {
        const fill = low.map((channel, index) => channel + (high[index]! - channel) * value / 100)
        for (const text of foregrounds) assert(contrast(rgb(text), fill) >= 4.5, `${scheme}: foreground contrast at ${value}%`)
        const current = luminance(fill)
        assert(scheme === 'dark' ? current >= previous : current <= previous, `${scheme}: monotonic intensity at ${value}%`)
        previous = current
    }
    const series = Array.from({ length: 6 }, (_, index) => tokens[`--viz-series-${index + 1}`]!)
    assert.equal(new Set(series).size, 6, 'series have distinct identities')
    for (const color of series) assert(contrast(rgb(tokens['--viz-on-series']!), rgb(color)) >= 4.5, `${scheme}: readable on-series labels`)
}
console.log('Visualization palette: all six label contrasts and every heatmap percentage passed in light/dark')
