import ts from 'typescript'
import { extractFile, listPackage } from '@electron/asar'
import path from 'node:path'

// Vite emits these renderer packages into out/renderer and the extension's local
// vendor/worker assets. Shipping their raw npm trees in app.asar duplicates them.
export const BUNDLED_RENDERER_PACKAGES = Object.freeze([
    '@pierre/diffs', '@silurus/ooxml', 'mermaid', 'monaco-editor',
    'react-syntax-highlighter', 'recharts'
])

export function assertNoExternalRendererImports(source, file) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
        /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const check = specifier => {
        if (BUNDLED_RENDERER_PACKAGES.some(name => specifier === name || specifier.startsWith(`${name}/`)))
            throw new Error(`Renderer-only dependency is required outside its bundle: ${file} -> ${specifier}`)
    }
    const visit = node => {
        if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly
            && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text)
        if (ts.isExportDeclaration(node) && !node.isTypeOnly
            && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text)
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
            || ts.isIdentifier(node.expression) && node.expression.text === 'require')
            && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) check(node.arguments[0].text)
        ts.forEachChild(node, visit)
    }
    visit(ast)
}

export function validateRendererPayload(archive) {
    const files = listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, ''))
    for (const name of BUNDLED_RENDERER_PACKAGES) {
        if (files.some(file => file === `node_modules/${name}` || file.startsWith(`node_modules/${name}/`)))
            throw new Error(`Duplicate renderer dependency in packaged app: ${name}`)
    }
    for (const file of files.filter(file => /^out\/(?:main|preload)\/.*\.(?:js|cjs|mjs)$/.test(file)))
        assertNoExternalRendererImports(extractFile(archive, path.normalize(file)).toString('utf8'), file)
    if (!files.includes('out/renderer/index.html') || !files.some(file => /^out\/renderer\/.*\.js$/.test(file)))
        throw new Error('Compiled renderer assets are missing')
}
