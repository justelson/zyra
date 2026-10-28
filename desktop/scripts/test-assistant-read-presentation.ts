import assert from 'node:assert/strict'
import { getAssistantReadFilePresentation as present, getAssistantCapturedImageSource, getAssistantCapturedImagePath, resolveAssistantReadFilePath } from '../src/renderer/src/pages/assistant/assistant-read-presentation'
for (const [kind, names] of Object.entries({
    image: ['photo.png', 'photo.JPG', 'image.svg', 'image.webp', 'image.avif', 'image.gif', 'image.bmp', 'image.tiff', 'image.heic', 'image.apng'],
    video: ['clip.mp4', 'clip.webm', 'clip.mov', 'clip.avi', 'clip.mkv', 'clip.mpeg', 'clip.mts', 'clip.ogv'],
    audio: ['sound.wav', 'sound.mp3', 'sound.flac', 'sound.m4a'],
    pdf: ['report.pdf'], docx: ['document.docx'], xlsx: ['sheet.xlsx'], pptx: ['slides.pptx'],
    text: ['source.ts', 'source.py', 'README', '.env', 'config.json', 'table.csv', 'notes.md', 'custom.extension'],
    binary: ['archive.zip', 'program.exe', 'font.woff2', 'database.sqlite']
})) for (const name of names) assert.equal(present({ path: `C:/synthetic/${name}` }).kind, kind, name)
assert.equal(present({ path: 'unknown', output: '\u0000binary' }).kind, 'binary')
assert.equal(resolveAssistantReadFilePath('assets/a#b.png', 'C:/workspace'), 'C:/workspace/assets/a#b.png')
assert.equal(resolveAssistantReadFilePath('../other/image.png', 'C:/workspace'), 'C:/other/image.png')
assert.equal(resolveAssistantReadFilePath('C:\\other\\image.png', 'D:/workspace'), 'C:\\other\\image.png')
assert.equal(resolveAssistantReadFilePath('file:///C:/cache/image.png', 'D:/workspace'), 'file:///C:/cache/image.png')
assert.equal(present({ path: 'trace.log', output: '\u001b[32mtext\u001b[0m' }).kind, 'text', 'text logs with ANSI escapes remain captured text')
assert.equal(present({ path: 'unknown', readIsImage: true }).kind, 'image')
assert.equal(present({ path: 'unknown', historyImageCount: 1 }).kind, 'image')
assert.equal(present({ path: 'unknown', output: 'Read image file [image/png]' }).kind, 'image')
const result = (mimeType: string, data: string) => ({ content: [{ type: 'image', mimeType, data }] })
assert.equal(getAssistantCapturedImageSource(result('image/png', 'AAAA')), 'data:image/png;base64,AAAA')
for (const mime of ['text/html', 'image/../html', 'image/png; charset=utf8']) assert.equal(getAssistantCapturedImageSource(result(mime, 'AAAA')), null)
for (const data of ['https://example.invalid/tracker.png', '<script>', '', 'A']) assert.equal(getAssistantCapturedImageSource(result('image/png', data)), null)
assert.equal(getAssistantCapturedImageSource(result('image/png', 'A'.repeat(20 * 1024 * 1024 + 1))), null, 'oversized inline bytes cannot enter the renderer')
assert.equal(getAssistantCapturedImagePath(['1. Image 1 [IMAGE]\npath: C:/synthetic/canonical.png\nmime: image/png']), 'C:/synthetic/canonical.png')
assert.equal(getAssistantCapturedImagePath([{ path: 'file:///synthetic/captured.png' }]), 'file:///synthetic/captured.png')
for (const path of ['https://example.invalid/image.png', 'javascript:alert(1)', 'relative.png']) assert.equal(getAssistantCapturedImagePath([{ path }]), null)
assert.equal(present({ path: 'original.png', imageAttachments: [{ path: 'C:/cache/snapshot.png' }] }).imageSource, 'C:/cache/snapshot.png')
console.log('PASS: read file-type inventory, canonical image paths, lazy image metadata and bounded safe inline sources')
