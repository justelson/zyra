import Editor from '@monaco-editor/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { getAppearanceCodeFontStack, useSettings } from '@/lib/settings'
import { monaco } from '@/lib/monaco/runtime'
import { buildZyraMonacoWidgetColors } from '@/lib/monaco/zyra-widget-theme'
import { useThemeRevision } from '@/lib/use-theme-revision'
import { parseUnifiedDiffMarkers, type GitLineMarker } from './gitDiff'
import { shouldApplyMonacoExternalValue } from './monacoExternalValueSync'
import { attachPreviewEditorLifecycle } from './monacoPreviewEditorLifecycle'

const MONACO_THEME_ID = 'devscope-preview'

function areLineMarkersEqual(left: GitLineMarker[], right: GitLineMarker[]): boolean {
    if (left === right) return true
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
        if (left[index].line !== right[index].line || left[index].type !== right[index].type) {
            return false
        }
    }
    return true
}

function focusPreviewEditorLine(editor: MonacoEditor.IStandaloneCodeEditor | null, focusLine?: number | null): void {
    if (!editor || !focusLine || focusLine < 1) return
    const model = editor.getModel()
    const lineNumber = model
        ? Math.min(Math.max(1, Math.floor(focusLine)), model.getLineCount())
        : Math.floor(focusLine)

    editor.revealLineInCenter(lineNumber, monaco.editor.ScrollType.Immediate)
    editor.setPosition({ lineNumber, column: 1 })
    editor.focus()
}

const baseOptions: MonacoEditor.IStandaloneEditorConstructionOptions = {
    readOnly: true,
    domReadOnly: true,
    folding: true,
    showFoldingControls: 'always',
    minimap: {
        enabled: true,
        side: 'right',
        renderCharacters: false,
        showSlider: 'always',
        size: 'proportional',
        scale: 1,
        maxColumn: 140
    },
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    renderLineHighlight: 'none',
    renderLineHighlightOnlyWhenFocus: true,
    automaticLayout: true,
    smoothScrolling: false,
    contextmenu: true,
    overviewRulerLanes: 3,
    hideCursorInOverviewRuler: true,
    wordWrap: 'on',
    wrappingStrategy: 'advanced',
    cursorBlinking: 'solid',
    occurrencesHighlight: 'off',
    selectionHighlight: false,
    renderValidationDecorations: 'off',
    scrollbar: {
        vertical: 'visible',
        horizontal: 'visible',
        alwaysConsumeMouseWheel: false,
        useShadows: false,
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10
    },
    fontSize: 13,
    lineHeight: 20,
    padding: { top: 14, bottom: 14 },
    stickyScroll: { enabled: false },
    unicodeHighlight: { ambiguousCharacters: false },
    links: false,
    fixedOverflowWidgets: true
}

const largeFileOptions: MonacoEditor.IStandaloneEditorConstructionOptions = {
    ...baseOptions,
    minimap: {
        enabled: true,
        side: 'right',
        renderCharacters: false,
        showSlider: 'always',
        size: 'fit',
        scale: 1,
        maxColumn: 90
    },
    folding: false,
    codeLens: false,
    bracketPairColorization: { enabled: false },
    guides: { bracketPairs: false, indentation: false }
}

interface MonacoPreviewEditorProps {
    value: string
    language: string
    modelPath?: string
    isLargeFile: boolean
    filePath?: string
    projectPath?: string
    gitDiffText?: string
    readOnly?: boolean
    onChange?: (value: string) => void
    onEditorMount?: (editor: MonacoEditor.IStandaloneCodeEditor | null) => void
    wordWrap?: 'on' | 'off'
    minimapEnabled?: boolean
    fontSize?: number
    findRequestToken?: number
    replaceRequestToken?: number
    focusLine?: number | null
    lineNumberStart?: number
    lineMarkersOverride?: GitLineMarker[]
}

function readThemeVariable(name: string, fallback: string): string {
    if (typeof window === 'undefined') return fallback
    const computed = getComputedStyle(document.body)
    const value = computed.getPropertyValue(name).trim()
    return value || fallback
}

function applyMonacoTheme(appearance: 'light' | 'dark') {
    const isLightTheme = appearance === 'light'
    const text = readThemeVariable('--color-text', isLightTheme ? '#1e293b' : '#e2e8f0')
    const textDark = readThemeVariable('--color-text-dark', isLightTheme ? '#475569' : '#cbd5e1')
    const textSecondary = readThemeVariable('--color-text-secondary', isLightTheme ? '#64748b' : '#94a3b8')
    const card = readThemeVariable('--color-card', isLightTheme ? '#ffffff' : '#131c2c')
    const bg = readThemeVariable('--color-bg', isLightTheme ? '#f9fafb' : '#0c121f')
    const border = readThemeVariable('--color-border', isLightTheme ? '#e2e8f0' : '#1f2a3d')
    const accent = readThemeVariable('--accent-primary', isLightTheme ? '#2563eb' : '#60a5fa')
    const selectionHighlightBackground = isLightTheme ? `${accent}1f` : `${accent}26`
    const selectionHighlightBorder = isLightTheme ? `${accent}55` : `${accent}66`
    const wordHighlightBackground = isLightTheme ? `${accent}18` : `${accent}1c`
    const wordHighlightStrongBackground = isLightTheme ? `${accent}24` : `${accent}24`
    const wordHighlightBorder = isLightTheme ? `${accent}3d` : `${accent}4a`

    const themeData: monaco.editor.IStandaloneThemeData = {
        base: isLightTheme ? 'vs' : 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
            'editor.background': card,
            'editor.foreground': text,
            'editor.lineHighlightBackground': isLightTheme ? '#0f172a0d' : '#f8fafc12',
            'editor.lineHighlightBorder': 'transparent',
            'editorCursor.foreground': accent,
            'editorLineNumber.foreground': textSecondary,
            'editorLineNumber.activeForeground': textDark,
            'editor.selectionBackground': isLightTheme ? '#47556933' : '#94a3b833',
            'editor.inactiveSelectionBackground': isLightTheme ? '#64748b26' : '#94a3b826',
            'editor.selectionHighlightBackground': selectionHighlightBackground,
            'editor.selectionHighlightBorder': selectionHighlightBorder,
            'editor.wordHighlightBackground': wordHighlightBackground,
            'editor.wordHighlightStrongBackground': wordHighlightStrongBackground,
            'editor.wordHighlightBorder': wordHighlightBorder,
            'editor.wordHighlightStrongBorder': selectionHighlightBorder,
            'editor.findMatchHighlightBackground': wordHighlightStrongBackground,
            'editor.findMatchHighlightBorder': selectionHighlightBorder,
            'editorIndentGuide.background1': `${border}99`,
            'editorIndentGuide.activeBackground1': `${textSecondary}aa`,
            'editorRuler.foreground': `${border}99`,
            'editorGutter.background': card,
            'editorOverviewRuler.border': border,
            'editorBracketMatch.border': accent,
            'editorBracketMatch.background': `${accent}1f`,
            'minimap.background': bg,
            'minimapSlider.background': `${accent}33`,
            'minimapSlider.hoverBackground': `${accent}55`,
            'minimapSlider.activeBackground': `${accent}77`,
            'scrollbarSlider.background': `${accent}33`,
            'scrollbarSlider.hoverBackground': `${accent}55`,
            'scrollbarSlider.activeBackground': `${accent}77`,
            ...buildZyraMonacoWidgetColors({
                isLightTheme,
                text,
                textSecondary,
                card,
                background: bg,
                border,
                accent
            })
        }
    }

    try {
        monaco.editor.defineTheme(MONACO_THEME_ID, themeData)
        monaco.editor.setTheme(MONACO_THEME_ID)
    } catch (error) {
        console.error('Failed to apply Monaco theme, falling back to built-in theme:', error)
        monaco.editor.setTheme(isLightTheme ? 'vs' : 'vs-dark')
    }
}

export default function MonacoPreviewEditor({
    value,
    language,
    modelPath,
    isLargeFile,
    filePath,
    projectPath,
    gitDiffText,
    readOnly = true,
    onChange,
    onEditorMount,
    wordWrap = 'on',
    minimapEnabled = true,
    fontSize = 13,
    findRequestToken = 0,
    replaceRequestToken = 0,
    focusLine = null,
    lineNumberStart = 1,
    lineMarkersOverride
}: MonacoPreviewEditorProps) {
    const { settings } = useSettings()
    const themeRevision = useThemeRevision()
    const editorTheme = useMemo(() => MONACO_THEME_ID, [])
    const [compactLayout, setCompactLayout] = useState(() => {
        if (typeof window === 'undefined') return false
        return window.innerWidth < 980
    })
    const [lineMarkers, setLineMarkers] = useState<GitLineMarker[]>([])
    const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
    const editorLifecycleCleanupRef = useRef<(() => void) | null>(null)
    const onEditorMountRef = useRef(onEditorMount)
    onEditorMountRef.current = onEditorMount
    const decorationIdsRef = useRef<string[]>([])
    const externalSyncInFlightRef = useRef(false)
    const lastLocallyEmittedValueRef = useRef<string | null>(null)
    const lastModelPathRef = useRef(modelPath)

    useEffect(() => {
        applyMonacoTheme(settings.appearanceResolvedMode)
    }, [settings.theme, settings.appearanceResolvedMode, settings.accentColor.primary, settings.accentColor.secondary, themeRevision])

    useEffect(() => {
        if (typeof window === 'undefined') return

        const updateLayout = () => {
            setCompactLayout(window.innerWidth < 980)
        }

        window.addEventListener('resize', updateLayout)
        return () => window.removeEventListener('resize', updateLayout)
    }, [])

    useEffect(() => {
        if (Array.isArray(lineMarkersOverride)) {
            setLineMarkers((current) => areLineMarkersEqual(current, lineMarkersOverride) ? current : lineMarkersOverride)
            return
        }

        let disposed = false

        const loadGitMarkers = async () => {
            if (typeof gitDiffText === 'string') {
                if (!disposed) {
                    const nextMarkers = parseUnifiedDiffMarkers(gitDiffText)
                    setLineMarkers((current) => areLineMarkersEqual(current, nextMarkers) ? current : nextMarkers)
                }
                return
            }

            if (!projectPath || !filePath || isLargeFile) {
                if (!disposed) {
                    setLineMarkers((current) => current.length === 0 ? current : [])
                }
                return
            }

            try {
                const response = await window.devscope.getWorkingDiff(projectPath, filePath, 'combined')
                if (disposed || !response?.success) {
                    if (!disposed) {
                        setLineMarkers((current) => current.length === 0 ? current : [])
                    }
                    return
                }

                const nextMarkers = parseUnifiedDiffMarkers(String(response.diff || ''))
                if (!disposed) {
                    setLineMarkers((current) => areLineMarkersEqual(current, nextMarkers) ? current : nextMarkers)
                }
            } catch {
                if (!disposed) {
                    setLineMarkers((current) => current.length === 0 ? current : [])
                }
            }
        }

        void loadGitMarkers()
        return () => {
            disposed = true
        }
    }, [gitDiffText, projectPath, filePath, isLargeFile, lineMarkersOverride])

    useEffect(() => {
        const editor = editorRef.current
        if (!editor) return

        const success = readThemeVariable('--status-success', '#22c55e')
        const warning = readThemeVariable('--status-warning', '#d97706')
        const danger = readThemeVariable('--status-danger', '#dc2626')
        const markerPalette = {
            added: { solid: success, minimap: `${success}B3` },
            modified: { solid: warning, minimap: `${warning}B3` },
            deleted: { solid: danger, minimap: `${danger}B3` }
        } as const

        const nextDecorations = lineMarkers.map((marker) => ({
            range: new monaco.Range(marker.line, 1, marker.line, 1),
            options: {
                isWholeLine: false,
                linesDecorationsClassName:
                    marker.type === 'added'
                        ? 'git-preview-gutter-added'
                        : marker.type === 'modified'
                            ? 'git-preview-gutter-modified'
                            : 'git-preview-gutter-deleted',
                overviewRuler: {
                    color: markerPalette[marker.type].solid,
                    position: monaco.editor.OverviewRulerLane.Full
                },
                minimap: {
                    color: markerPalette[marker.type].minimap,
                    position: monaco.editor.MinimapPosition.Inline
                }
            }
        }))

        decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, nextDecorations)
    }, [lineMarkers, themeRevision])

    useEffect(() => {
        return () => {
            editorLifecycleCleanupRef.current?.()
            editorLifecycleCleanupRef.current = null
            const editor = editorRef.current
            if (editor) {
                editor.deltaDecorations(decorationIdsRef.current, [])
            }
            decorationIdsRef.current = []
            editorRef.current = null
        }
    }, [])

    useEffect(() => {
        const editor = editorRef.current
        const model = editor?.getModel()
        if (!editor || !model) return

        const currentValue = model.getValue(monaco.editor.EndOfLinePreference.LF, false)
        const modelPathChanged = lastModelPathRef.current !== modelPath
        lastModelPathRef.current = modelPath
        const lastLocallyEmittedValue = lastLocallyEmittedValueRef.current
        const shouldApplyExternalValue = shouldApplyMonacoExternalValue({
            currentValue,
            incomingValue: value,
            readOnly,
            modelPathChanged,
            lastLocallyEmittedValue
        })
        if (value === lastLocallyEmittedValue) lastLocallyEmittedValueRef.current = null
        if (!shouldApplyExternalValue) return

        const selection = editor.getSelection()
        const scrollTop = editor.getScrollTop()
        const scrollLeft = editor.getScrollLeft()

        externalSyncInFlightRef.current = true
        editor.executeEdits('devscope-external-sync', [{
            range: model.getFullModelRange(),
            text: value
        }])
        if (selection) {
            editor.setSelection(selection)
        }
        editor.setScrollTop(scrollTop)
        editor.setScrollLeft(scrollLeft)
        externalSyncInFlightRef.current = false
        lastLocallyEmittedValueRef.current = null
    }, [modelPath, readOnly, value])

    const editorOptions = useMemo<MonacoEditor.IStandaloneEditorConstructionOptions>(() => {
        const base = isLargeFile ? largeFileOptions : baseOptions
        const nextBase: MonacoEditor.IStandaloneEditorConstructionOptions = {
            ...base,
            readOnly,
            domReadOnly: readOnly,
            cursorStyle: readOnly ? 'line-thin' : 'line',
            renderLineHighlight: readOnly ? 'none' : 'gutter',
            selectionHighlight: !readOnly,
            quickSuggestions: !readOnly,
            wordWrap,
            lineNumbers: lineNumberStart > 1
                ? (lineNumber) => String(lineNumber + lineNumberStart - 1)
                : 'on',
            fontFamily: getAppearanceCodeFontStack(settings.appearanceCodeFont),
            fontSize,
            minimap: {
                ...(base.minimap || {}),
                enabled: minimapEnabled
            }
        }

        if (!compactLayout) return nextBase

        return {
            ...nextBase,
            minimap: {
                enabled: minimapEnabled,
                side: 'right',
                renderCharacters: false,
                showSlider: 'always',
                size: 'fit',
                scale: 1,
                maxColumn: 90
            },
            overviewRulerLanes: 3,
            fontSize: Math.max(10, fontSize - 1),
            lineHeight: 18,
            padding: { top: 10, bottom: 10 }
        }
    }, [compactLayout, fontSize, isLargeFile, lineNumberStart, minimapEnabled, readOnly, settings.appearanceCodeFont, themeRevision, wordWrap])

    useEffect(() => {
        if (findRequestToken <= 0) return
        const editor = editorRef.current
        if (!editor) return
        editor.focus()
        void editor.getAction('actions.find')?.run()
    }, [findRequestToken])

    useEffect(() => {
        if (replaceRequestToken <= 0) return
        const editor = editorRef.current
        if (!editor) return
        editor.focus()
        void editor.getAction('editor.action.startFindReplaceAction')?.run()
    }, [replaceRequestToken])

    useEffect(() => {
        focusPreviewEditorLine(editorRef.current, focusLine)
    }, [focusLine])

    return (
        <Editor
            defaultValue={value}
            language={language}
            path={modelPath}
            theme={editorTheme}
            options={editorOptions}
            onChange={(nextValue) => {
                if (typeof onChange !== 'function') return
                if (externalSyncInFlightRef.current) return
                const normalizedValue = typeof nextValue === 'string' ? nextValue : ''
                lastLocallyEmittedValueRef.current = normalizedValue
                onChange(normalizedValue)
            }}
            onMount={(editor) => {
                editorLifecycleCleanupRef.current?.()
                editorRef.current = editor
                decorationIdsRef.current = editor.deltaDecorations([], [])
                focusPreviewEditorLine(editor, focusLine)
                editorLifecycleCleanupRef.current = attachPreviewEditorLifecycle(
                    editor,
                    (nextEditor) => onEditorMountRef.current?.(nextEditor)
                )
            }}
        />
    )
}
