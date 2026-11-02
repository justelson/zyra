import assert from 'node:assert/strict'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMarkdownComponents } from '../src/renderer/src/components/ui/markdown/components'
import { readMarkdownMediaGeometry, rememberMarkdownMediaGeometry } from '../src/renderer/src/components/ui/markdown/markdown-media-geometry'

const source = 'https://example.test/tall-image.png'
rememberMarkdownMediaGeometry(source, 320, 960)
assert.deepEqual(readMarkdownMediaGeometry(source), { width: 320, height: 960 })
rememberMarkdownMediaGeometry(source, 0, 10)
assert.equal(readMarkdownMediaGeometry(source)?.height, 960, 'invalid metadata cannot replace valid geometry')
const components = createMarkdownComponents(undefined, { mediaMode: 'images-and-videos' })
const image = renderToStaticMarkup(createElement(components.img as ComponentType<any>, { src: source, alt: 'Tall image' }))
assert.match(image, /width="320" height="960"/, 'remounted image reserves its own decoded dimensions')
const authored = renderToStaticMarkup(createElement(components.img as ComponentType<any>, { src: source, width: 120, height: 80 }))
assert.match(authored, /width="120" height="80"/, 'authored dimensions win over cached geometry')
const videoSource = 'https://example.test/clip.mp4'
rememberMarkdownMediaGeometry(videoSource, 1280, 720)
const video = renderToStaticMarkup(createElement(components.a as ComponentType<any>, { href: videoSource, children: 'Clip' }))
assert.match(video, /width="1280" height="720"/, 'video metadata reserves aspect ratio on remount')
assert.match(video, /height:auto/, 'video dimensions remain responsive')
const oversized = 'data:image/png;base64,' + 'a'.repeat(5000)
rememberMarkdownMediaGeometry(oversized, 100, 100)
assert.equal(readMarkdownMediaGeometry(oversized), undefined, 'large inline media is not retained as cache keys')
for (let i = 0; i < 129; i++) rememberMarkdownMediaGeometry(`fixture:${i}`, 10, 20)
assert.equal(readMarkdownMediaGeometry(source), undefined, 'geometry retention is bounded')
assert.equal(readMarkdownMediaGeometry('fixture:128')?.height, 20)
console.log('PASS: bounded decoded media geometry, responsive remount dimensions and authored size precedence')
