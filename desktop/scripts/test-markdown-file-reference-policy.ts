import assert from 'node:assert/strict'
import { looksLikeMarkdownFileReference } from '../src/renderer/src/components/ui/markdown/fileReferences'

for (const value of ['ordinary', 'working', '12345', '你好', 'héllo', 'C:', 'https:', '#heading', 'input/output', '@scope/package', '.png', 'folder/another/file']) {
    assert.equal(looksLikeMarkdownFileReference(value), false, `${value} must remain prose`)
}
for (const value of ['README.md', '.env', '.env.local', '%2Eenv', 'src/components', 'client/server', 'src/component.tsx:12:3', './extensionless', '../config', '~/config', 'C:\\work\\file', 'C:%5Cwork%5Cfile', '\\\\host\\share', '%5C%5Chost%5Cshare', '/opt/example/file', 'file:///C:/work/file', 'résumé.txt']) {
    assert.equal(looksLikeMarkdownFileReference(value), true, `${value} must remain navigable`)
}
assert.equal(looksLikeMarkdownFileReference('readme%2Emd'), true, 'encoded filename extensions stay navigable')
assert.equal(looksLikeMarkdownFileReference('https://example.com/a.md'), false, 'web links stay external')
console.log('Markdown file reference policy: prose, encoded paths, UNC, file URLs, positions and Unicode passed')
