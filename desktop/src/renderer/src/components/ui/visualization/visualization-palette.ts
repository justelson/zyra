// Chart identity is independent of the app accent. Heatmap endpoints leave
// enough contrast for the normal theme foreground throughout the scale.
const palettes = {
    dark: {
        series: ['#a78bfa', '#2dd4bf', '#fbbf24', '#fb7185', '#60a5fa', '#a3e635'],
        track: '#2d293e', heatLow: '#20343c', heatHigh: '#117568', onSeries: '#17212b'
    },
    light: {
        series: ['#7140c5', '#087f75', '#a36100', '#be3455', '#2563c5', '#477313'],
        track: '#e9e5f1', heatLow: '#e7f4ef', heatHigh: '#93ded3', onSeries: '#ffffff'
    }
} as const

export function visualizationPaletteCss(scheme: 'light' | 'dark'): string {
    const palette = palettes[scheme]
    return palette.series.map((color, index) => `--viz-series-${index + 1}:${color}`).join(';')
        + `;--viz-track:${palette.track};--viz-heat-low:${palette.heatLow};--viz-heat-high:${palette.heatHigh};--viz-on-series:${palette.onSeries}`
}
