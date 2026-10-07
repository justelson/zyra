import assert from 'node:assert/strict'
import { parseMarkdownToHast } from '../src/renderer/src/components/ui/markdown/markdownPipeline'
import type { Element, Root } from 'hast'

function markers(source: string): unknown[] {
    const values: unknown[] = []
    const walk = (node: Root | Element) => {
        if (node.type === 'element' && node.tagName === 'code') values.push(node.properties.dataCodeIncomplete)
        for (const child of node.children) if (child.type === 'element') walk(child)
    }
    walk(parseMarkdownToHast(source))
    return values
}
const fenced = '```mermaid\nflowchart LR\n A[First] --> B[Second]\n```'
for (let length = 11; length < fenced.length - 2; length++) assert.deepEqual(markers(fenced.slice(0, length)), ['true'])
assert.deepEqual(markers(fenced), ['false'])
assert.deepEqual(markers(fenced + '\n\nStill responding.'), ['false'])
assert.deepEqual(markers(fenced + '\n\n~~~mermaid\nflowchart LR\n A --> B'), ['false', 'true'])
assert.deepEqual(markers('````mermaid\nflowchart LR\n```'), ['true'])
assert.deepEqual(markers('> ```mermaid\n> flowchart LR\n> A --> B\n> ```'), ['false'])
assert.deepEqual(markers('```ts\nconst x = "mermaid"'), [undefined])
console.log('PASS: each partial Mermaid fence stays pending; completed, nested and alternate fences are distinguished')
