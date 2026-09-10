import { Download, HardDrive, Monitor, Search, Trash2, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { DevScopeManagedFont } from '@shared/contracts/font-contracts'
import {
    createAppearanceLocalFont,
    createAppearanceManagedFont,
    DEFAULT_APPEARANCE_UI_FONT,
    getAppearanceManagedFontId,
    type AppearanceCodeFont,
    type AppearanceUiFont
} from '@/lib/settings'
import { ensureAppearanceFontLoaded, forgetAppearanceManagedFont } from '@/lib/appearance-font-runtime'
import { SettingsButton, SettingsDialog, SettingsInput, SettingsNotice, SettingsSegmented } from '../settings-layout'

const GOOGLE_FONT_FAMILIES = [
    'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Source Sans 3', 'Nunito Sans',
    'DM Sans', 'Manrope', 'Work Sans', 'IBM Plex Sans', 'Fira Sans', 'Merriweather', 'Playfair Display',
    'Roboto Slab', 'Space Grotesk', 'Plus Jakarta Sans', 'Outfit', 'Ubuntu', 'Noto Sans', 'Noto Serif',
    'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Roboto Mono', 'IBM Plex Mono', 'Inconsolata',
    'Space Mono', 'Geist', 'Archivo', 'Barlow', 'Cabin', 'Karla', 'Mulish', 'Rubik', 'Libre Franklin',
    'Crimson Pro', 'Lora', 'Bitter', 'PT Sans', 'PT Serif'
] as const

type FontManagerTab = 'google' | 'downloaded' | 'installed' | 'manual'
type FontTarget = 'ui' | 'code'
type FontSelection = AppearanceUiFont | AppearanceCodeFont

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FontSample({ family, target }: { family: string; target: FontTarget }) {
    return (
        <span className="block truncate text-[12px] text-[var(--settings-text-secondary)]" style={{ fontFamily: family }}>
            {target === 'code' ? 'const zyra = "Aa 0123"' : 'The quick brown fox · Aa 0123'}
        </span>
    )
}

export function AppearanceFontManagerDialog({
    open,
    target,
    managedFonts,
    currentFont,
    usedManagedFontIds,
    onManagedFontsChange,
    onSelect,
    onClose
}: {
    open: boolean
    target: FontTarget
    managedFonts: DevScopeManagedFont[]
    currentFont: FontSelection
    usedManagedFontIds: string[]
    onManagedFontsChange: (fonts: DevScopeManagedFont[]) => void
    onSelect: (font: FontSelection) => void
    onClose: () => void
}) {
    const [tab, setTab] = useState<FontManagerTab>('google')
    const [query, setQuery] = useState('')
    const [manualFamily, setManualFamily] = useState('')
    const [installedFonts, setInstalledFonts] = useState<string[]>([])
    const [busyKey, setBusyKey] = useState('')
    const [status, setStatus] = useState<{ tone: 'neutral' | 'error' | 'success'; message: string } | null>(null)
    const openRef = useRef(open)
    const operationGenerationRef = useRef(0)
    openRef.current = open

    const closeDialog = () => {
        operationGenerationRef.current += 1
        openRef.current = false
        setStatus(null)
        setBusyKey('')
        onClose()
    }

    const normalizedQuery = query.trim().toLowerCase()
    const googleFonts = useMemo(() => {
        const matches = GOOGLE_FONT_FAMILIES.filter((family) => !normalizedQuery || family.toLowerCase().includes(normalizedQuery))
        const customFamily = query.trim()
        if (customFamily && !GOOGLE_FONT_FAMILIES.some((family) => family.toLowerCase() === customFamily.toLowerCase())) {
            return [customFamily, ...matches].slice(0, 40)
        }
        return matches.slice(0, 40)
    }, [normalizedQuery, query])
    const visibleManagedFonts = useMemo(() => managedFonts.filter(font => !normalizedQuery || font.family.toLowerCase().includes(normalizedQuery)), [managedFonts, normalizedQuery])
    const visibleInstalledFonts = useMemo(() => installedFonts
        .filter((family) => !normalizedQuery || family.toLowerCase().includes(normalizedQuery))
        .slice(0, 100), [installedFonts, normalizedQuery])

    const selectManagedFont = async (font: DevScopeManagedFont) => {
        const operationGeneration = operationGenerationRef.current
        const selection = createAppearanceManagedFont(font.id)
        setBusyKey(`use:${font.id}`)
        try {
            await ensureAppearanceFontLoaded(selection)
            if (!openRef.current || operationGeneration !== operationGenerationRef.current) return
            onSelect(selection)
            closeDialog()
        } catch (error) {
            if (openRef.current) setStatus({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to load the font.' })
        } finally {
            if (operationGeneration === operationGenerationRef.current) setBusyKey('')
        }
    }

    const downloadGoogle = async (family: string) => {
        const operationGeneration = operationGenerationRef.current
        setBusyKey(`google:${family}`)
        setStatus({ tone: 'neutral', message: `Downloading ${family} into Zyra’s local font cache…` })
        try {
            const result = await window.devscope.fonts.downloadGoogle(family)
            if (!result.success) throw new Error(result.error)
            const nextFonts = [...managedFonts.filter((font) => font.id !== result.font.id), result.font]
                .sort((left, right) => left.family.localeCompare(right.family))
            onManagedFontsChange(nextFonts)
            if (openRef.current && operationGeneration === operationGenerationRef.current) await selectManagedFont(result.font)
        } catch (error) {
            if (openRef.current) setStatus({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to download the Google Font.' })
        } finally {
            if (operationGeneration === operationGenerationRef.current) setBusyKey('')
        }
    }

    const scanInstalledFonts = async () => {
        const operationGeneration = operationGenerationRef.current
        setBusyKey('installed:scan')
        setStatus(null)
        try {
            const result = await window.devscope.fonts.listSystem()
            if (!result.success) throw new Error(result.error)
            if (!openRef.current || operationGeneration !== operationGenerationRef.current) return
            setInstalledFonts(result.fonts)
            setStatus({ tone: 'success', message: `Found ${result.fonts.length} installed font families.` })
        } catch (error) {
            if (openRef.current) setStatus({ tone: 'error', message: error instanceof Error ? error.message : 'Zyra could not read installed fonts.' })
        } finally {
            if (operationGeneration === operationGenerationRef.current) setBusyKey('')
        }
    }

    const importFont = async () => {
        const operationGeneration = operationGenerationRef.current
        setBusyKey('manual:import')
        setStatus(null)
        try {
            const result = await window.devscope.fonts.importFile()
            if (!result.success) throw new Error(result.error)
            if (result.cancelled || !result.font) return
            const nextFonts = [...managedFonts.filter((font) => font.id !== result.font?.id), result.font]
                .sort((left, right) => left.family.localeCompare(right.family))
            onManagedFontsChange(nextFonts)
            if (openRef.current && operationGeneration === operationGenerationRef.current) await selectManagedFont(result.font)
        } catch (error) {
            if (openRef.current) setStatus({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to import the font.' })
        } finally {
            if (operationGeneration === operationGenerationRef.current) setBusyKey('')
        }
    }

    const removeFont = async (font: DevScopeManagedFont) => {
        const operationGeneration = operationGenerationRef.current
        setBusyKey(`remove:${font.id}`)
        try {
            const result = await window.devscope.fonts.removeManaged(font.id)
            if (!result.success) throw new Error(result.error)
            forgetAppearanceManagedFont(font.id)
            onManagedFontsChange(managedFonts.filter((entry) => entry.id !== font.id))
            if (getAppearanceManagedFontId(currentFont) === font.id) onSelect(target === 'code' ? 'system-mono' : DEFAULT_APPEARANCE_UI_FONT)
            if (openRef.current) setStatus({ tone: 'success', message: `${font.family} was removed from Zyra’s font cache.` })
        } catch (error) {
            if (openRef.current) setStatus({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to remove the font.' })
        } finally {
            if (operationGeneration === operationGenerationRef.current) setBusyKey('')
        }
    }

    const useLocalFamily = (family: string) => {
        const normalized = family.trim()
        if (!normalized) return
        onSelect(createAppearanceLocalFont(normalized))
        closeDialog()
    }

    const listClass = 'min-h-0 flex-1 overflow-y-auto rounded-lg border border-[var(--settings-border)] bg-[var(--settings-section)] [scrollbar-gutter:stable]'

    return (
        <SettingsDialog
            open={open}
            title={target === 'code' ? 'Choose a code font' : 'Choose a UI font'}
            description="Choose a downloaded, installed or imported font."
            onClose={closeDialog}
            className="flex h-[680px] max-h-[calc(100vh-40px)] !max-w-[680px] flex-col"
            contentClassName="flex min-h-0 flex-1 flex-col !space-y-0 gap-4 overflow-y-auto"
        >
            <div className="shrink-0 self-start">
                <SettingsSegmented
                    value={tab}
                    options={[
                        { value: 'google', label: 'Google Fonts' },
                        { value: 'downloaded', label: 'Downloaded' },
                        { value: 'installed', label: 'Installed' },
                        { value: 'manual', label: 'Manual' }
                    ]}
                    onChange={(value) => {
                        setTab(value)
                        setQuery('')
                        setStatus(null)
                    }}
                    label="Font source"
                />
            </div>

            {tab !== 'manual' ? (
                <div className="relative shrink-0">
                    <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--settings-text-muted)]" />
                    <SettingsInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'google' ? 'Search or enter an exact Google font family' : 'Search fonts'} className="!w-full !pl-8" autoFocus />
                </div>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col gap-4">
            {tab === 'google' ? (
                <>
                    <SettingsNotice className="shrink-0">
                        Fonts download only after you click Download and are then cached for offline use.
                    </SettingsNotice>
                    <div className={listClass}>
                        {googleFonts.map((family) => {
                            const downloaded = managedFonts.find((font) => font.source === 'google' && font.family.toLowerCase() === family.toLowerCase())
                            return (
                                <div key={family} className="flex min-h-14 items-center gap-3 border-b border-[var(--settings-row-divider)] px-3 py-2 last:border-b-0">
                                    <Download size={14} className="shrink-0 text-[var(--settings-text-muted)]" />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-[12px] font-medium">{family}</div>
                                        <div className="text-[10px] text-[var(--settings-text-muted)]">{downloaded ? `Downloaded · ${formatBytes(downloaded.sizeBytes)}` : 'Google Fonts'}</div>
                                    </div>
                                    <SettingsButton
                                        variant={downloaded ? 'outline' : 'accent'}
                                        disabled={Boolean(busyKey)}
                                        onClick={() => downloaded ? void selectManagedFont(downloaded) : void downloadGoogle(family)}
                                    >
                                        {busyKey === `google:${family}` ? 'Downloading…' : downloaded ? 'Use' : 'Download'}
                                    </SettingsButton>
                                </div>
                            )
                        })}
                    </div>
                </>
            ) : null}

            {tab === 'downloaded' ? (
                <div className={listClass}>
                    {visibleManagedFonts.length === 0 ? <div className="flex h-full min-h-24 items-center justify-center px-4 text-center text-xs text-[var(--settings-text-muted)]">{managedFonts.length ? 'No matching fonts.' : 'No downloaded or imported fonts yet.'}</div> : null}
                    {visibleManagedFonts.map((font) => (
                        <div key={font.id} className="flex min-h-14 items-center gap-3 border-b border-[var(--settings-row-divider)] px-3 py-2 last:border-b-0">
                            <HardDrive size={14} className="shrink-0 text-[var(--settings-text-muted)]" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-[12px] font-medium">{font.family}</div>
                                <div className="text-[10px] capitalize text-[var(--settings-text-muted)]">{font.source} · {formatBytes(font.sizeBytes)}</div>
                            </div>
                            <SettingsButton disabled={Boolean(busyKey)} onClick={() => void selectManagedFont(font)}>Use</SettingsButton>
                            <SettingsButton
                                variant="ghost"
                                disabled={Boolean(busyKey) || usedManagedFontIds.includes(font.id)}
                                onClick={() => void removeFont(font)}
                                aria-label={`Remove ${font.family}`}
                                title={usedManagedFontIds.includes(font.id) ? 'Change this font in the current or saved custom theme before removing it' : 'Remove cached font'}
                            >
                                <Trash2 size={12} />
                            </SettingsButton>
                        </div>
                    ))}
                </div>
            ) : null}

            {tab === 'installed' ? (
                <>
                    <div className="flex shrink-0 items-center justify-between gap-3">
                        <p className="text-[11px] leading-5 text-[var(--settings-text-secondary)]">Use fonts registered on this device without copying their files.</p>
                        <SettingsButton variant="outline" disabled={Boolean(busyKey)} onClick={() => void scanInstalledFonts()}>
                            <Monitor size={12} />
                            {busyKey === 'installed:scan' ? 'Scanning…' : 'Browse installed'}
                        </SettingsButton>
                    </div>
                    <div className={listClass}>
                        {visibleInstalledFonts.length === 0 ? <div className="flex h-full min-h-24 items-center justify-center px-4 text-center text-xs text-[var(--settings-text-muted)]">{installedFonts.length ? 'No matching fonts.' : 'Choose Browse installed to load the font list.'}</div> : null}
                        {visibleInstalledFonts.map((family) => (
                            <div key={family} className="flex min-h-14 items-center gap-3 border-b border-[var(--settings-row-divider)] px-3 py-2 last:border-b-0">
                                <Monitor size={14} className="shrink-0 text-[var(--settings-text-muted)]" />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-[12px] font-medium">{family}</div>
                                    <FontSample family={`"${family.replace(/["\\;{}]/g, '')}"`} target={target} />
                                </div>
                                <SettingsButton onClick={() => useLocalFamily(family)}>Use</SettingsButton>
                            </div>
                        ))}
                    </div>
                </>
            ) : null}

            {tab === 'manual' ? (
                <div className="grid min-h-0 flex-1 grid-rows-2 gap-4">
                    <div className="rounded-lg border border-[var(--settings-border)] bg-[var(--settings-section)] p-3">
                        <div className="text-[12px] font-medium">Use an installed family by name</div>
                        <p className="mt-1 text-[11px] leading-5 text-[var(--settings-text-muted)]">Useful when installed-font browsing is unavailable or permission is declined.</p>
                        <div className="mt-3 flex gap-2">
                            <SettingsInput value={manualFamily} onChange={(event) => setManualFamily(event.target.value)} placeholder="e.g. Aptos" className="!w-full" />
                            <SettingsButton variant="accent" disabled={!manualFamily.trim()} onClick={() => useLocalFamily(manualFamily)}>Use</SettingsButton>
                        </div>
                    </div>
                    <div className="rounded-lg border border-[var(--settings-border)] bg-[var(--settings-section)] p-3">
                        <div className="text-[12px] font-medium">Import a font file</div>
                        <p className="mt-1 text-[11px] leading-5 text-[var(--settings-text-muted)]">Copies a .ttf, .otf, .woff, or .woff2 file into Zyra’s private font cache.</p>
                        <SettingsButton className="mt-3" disabled={Boolean(busyKey)} onClick={() => void importFont()}>
                            <Upload size={12} />
                            {busyKey === 'manual:import' ? 'Importing…' : 'Choose font file'}
                        </SettingsButton>
                    </div>
                </div>
            ) : null}
            </div>

            {status ? <SettingsNotice tone={status.tone} className="shrink-0">{status.message}</SettingsNotice> : null}
        </SettingsDialog>
    )
}
