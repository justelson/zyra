export function playBrowserCaptureSound() {
    try {
        const audio = new AudioContext()
        const tone = audio.createOscillator()
        const gain = audio.createGain()
        tone.connect(gain).connect(audio.destination)
        tone.type = 'triangle'
        tone.frequency.setValueAtTime(920, audio.currentTime)
        tone.frequency.exponentialRampToValueAtTime(480, audio.currentTime + 0.065)
        gain.gain.setValueAtTime(0.08, audio.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.075)
        tone.onended = () => { void audio.close() }
        tone.start()
        tone.stop(audio.currentTime + 0.08)
    } catch { /* A silent device still receives the capture preview. */ }
}
