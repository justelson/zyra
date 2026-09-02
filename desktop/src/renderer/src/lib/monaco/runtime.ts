import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from '../../../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker'
import jsonWorker from '../../../../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js?worker'
import cssWorker from '../../../../../node_modules/monaco-editor/esm/vs/language/css/css.worker.js?worker'
import htmlWorker from '../../../../../node_modules/monaco-editor/esm/vs/language/html/html.worker.js?worker'
import tsWorker from '../../../../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker'
import codiconFontUrl from '../../../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf?url'
import '../../../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css'

type MonacoGlobal = typeof globalThis & {
    MonacoEnvironment?: {
        getWorker: (_moduleId: string, label: string) => Worker
    }
    __DEVSCOPE_MONACO_LOADER_READY__?: boolean
    __DEVSCOPE_MONACO_CODICON_READY__?: boolean
}

const globalWithMonaco = globalThis as MonacoGlobal

function ensureCodiconRuntime() {
    if (globalWithMonaco.__DEVSCOPE_MONACO_CODICON_READY__) return
    if (typeof document === 'undefined') return

    const existingStyle = document.getElementById('devscope-monaco-codicon-runtime')
    if (existingStyle) {
        globalWithMonaco.__DEVSCOPE_MONACO_CODICON_READY__ = true
        return
    }

    const style = document.createElement('style')
    style.id = 'devscope-monaco-codicon-runtime'
    style.textContent = `
@font-face {
    font-family: "codicon";
    font-display: block;
    src: url("${codiconFontUrl}") format("truetype");
}

.codicon[class*='codicon-'] {
    font: normal normal normal 16px/1 codicon;
    display: inline-block;
    text-decoration: none;
    text-rendering: auto;
    text-align: center;
    text-transform: none;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    user-select: none;
    -webkit-user-select: none;
}`
    document.head.appendChild(style)
    globalWithMonaco.__DEVSCOPE_MONACO_CODICON_READY__ = true
}

export function ensureMonacoRuntime() {
    ensureCodiconRuntime()

    if (!globalWithMonaco.MonacoEnvironment) {
        globalWithMonaco.MonacoEnvironment = {
            getWorker: (_moduleId: string, label: string) => {
                if (label === 'json') return new jsonWorker()
                if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
                if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
                if (label === 'typescript' || label === 'javascript') return new tsWorker()
                return new editorWorker()
            }
        }
    }

    if (!globalWithMonaco.__DEVSCOPE_MONACO_LOADER_READY__) {
        loader.config({ monaco })
        globalWithMonaco.__DEVSCOPE_MONACO_LOADER_READY__ = true
    }
}

ensureMonacoRuntime()

export { monaco }
