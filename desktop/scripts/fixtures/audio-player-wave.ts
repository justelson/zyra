// Quiet synthetic PCM tone shared by the isolated browser/Electron checks.
export function createAudioPlayerWave(seconds = 8): Uint8Array {
    const rate = 16000
    const samples = Math.floor(rate * seconds)
    const bytes = new Uint8Array(44 + samples * 2)
    const view = new DataView(bytes.buffer)
    const text = (offset: number, value: string) => [...value].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)))
    text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt ')
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true)
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true)
    for (let index = 0; index < samples; index++) {
        const fade = Math.min(1, index / (rate / 10), (samples - index) / (rate / 10))
        view.setInt16(44 + index * 2, Math.round(Math.sin(index * Math.PI * 2 * 220 / rate) * 160 * fade), true)
    }
    return bytes
}
