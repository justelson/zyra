/**
 * Zyra Logo Component
 * Stylized logo based on the original README banner
 */

import { cn } from '@/lib/utils'
import { useSettings } from '@/lib/settings'

interface ZyraLogoProps {
    size?: 'sm' | 'md' | 'lg' | 'xl'
    showText?: boolean
    className?: string
}

const ZYRA_CLI_ASCII_LOGO_ROWS = [
    '┏━━━┳┓ ┏┳━┳━━┓',
    '┣━━┃┃┃ ┃┃┏┫┏┓┃',
    '┃┃━━┫┗━┛┃┃┃┏┓┃',
    '┗━━━┻━┓┏┻┛┗┛┗┛',
    '    ┏━┛┃',
    '    ┗━━┛'
]

export const ZYRA_CLI_ASCII_LOGO = ZYRA_CLI_ASCII_LOGO_ROWS.join('\n')

export default function ZyraLogo({ size = 'md', showText = false, className }: ZyraLogoProps) {
    const { settings } = useSettings()
    const themeColors = {
        primary: settings.accentColor.secondary,
        secondary: settings.accentColor.primary
    }

    const sizes = {
        sm: { icon: 24, text: 'text-xs' },
        md: { icon: 28, text: 'text-sm' },
        lg: { icon: 48, text: 'text-lg' },
        xl: { icon: 80, text: 'text-2xl' }
    }

    const { icon, text } = sizes[size] || sizes.md

    return (
        <div className={cn('flex items-center gap-2', className)}>
            <div
                className="relative flex items-center justify-center"
                style={{ width: icon, height: icon }}
            >
                <div
                    className="absolute inset-0 rounded-lg blur-sm"
                    style={{
                        background: `linear-gradient(to bottom right, ${themeColors.primary}33, ${themeColors.secondary}33)`
                    }}
                />

                <div
                    className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-lg border bg-gradient-to-br from-[#0a1628] to-[#0c1a2e]"
                    style={{ borderColor: `${themeColors.primary}4D` }}
                >
                    <svg viewBox="0 0 24 24" className="h-[70%] w-[70%]" fill="none">
                        <g style={{ color: themeColors.primary }}>
                            <rect x="4" y="4" width="3" height="2" fill="currentColor" opacity="0.9" />
                            <rect x="7" y="4" width="3" height="2" fill="currentColor" opacity="0.8" />
                            <rect x="10" y="4" width="3" height="2" fill="currentColor" opacity="0.7" />
                            <rect x="13" y="5" width="2" height="2" fill="currentColor" opacity="0.6" />
                            <rect x="4" y="6" width="3" height="2" fill="currentColor" opacity="0.9" />
                            <rect x="4" y="8" width="3" height="2" fill="currentColor" opacity="0.85" />
                            <rect x="4" y="10" width="3" height="2" fill="currentColor" opacity="0.8" />
                            <rect x="4" y="12" width="3" height="2" fill="currentColor" opacity="0.85" />
                            <rect x="4" y="14" width="3" height="2" fill="currentColor" opacity="0.9" />
                            <rect x="4" y="16" width="3" height="2" fill="currentColor" opacity="0.9" />
                            <rect x="15" y="7" width="2" height="2" fill="currentColor" opacity="0.5" />
                            <rect x="16" y="9" width="2" height="2" fill="currentColor" opacity="0.4" />
                            <rect x="17" y="11" width="2" height="2" fill="currentColor" opacity="0.35" />
                            <rect x="16" y="13" width="2" height="2" fill="currentColor" opacity="0.4" />
                            <rect x="15" y="15" width="2" height="2" fill="currentColor" opacity="0.5" />
                            <rect x="4" y="18" width="3" height="2" fill="currentColor" opacity="0.9" />
                            <rect x="7" y="18" width="3" height="2" fill="currentColor" opacity="0.8" />
                            <rect x="10" y="18" width="3" height="2" fill="currentColor" opacity="0.7" />
                            <rect x="13" y="17" width="2" height="2" fill="currentColor" opacity="0.6" />
                        </g>
                        <rect x="2" y="2" width="2" height="2" fill={themeColors.primary} opacity="0.8" />
                    </svg>
                    <div
                        className="absolute inset-0 animate-pulse bg-gradient-to-b from-transparent via-transparent to-transparent"
                        style={{
                            backgroundImage: `linear-gradient(to bottom, transparent, ${themeColors.primary}0D, transparent)`
                        }}
                    />
                </div>
            </div>

            {showText && (
                <span className={cn('font-semibold text-sparkle-text', text)}>
                    Zyra
                </span>
            )}
        </div>
    )
}

export function ZyraLogoMini({ className }: { className?: string }) {
    const { settings } = useSettings()
    const themeColors = {
        primary: settings.accentColor.secondary,
        secondary: settings.accentColor.primary
    }

    return (
        <div className={cn('relative inline-flex', className)}>
            <div
                className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg border bg-gradient-to-br from-[#0a1628] to-[#0c1a2e]"
                style={{ borderColor: `${themeColors.primary}4D` }}
            >
                <span className="relative z-10 text-sm font-bold" style={{ color: themeColors.primary }}>Z</span>
                <div
                    className="absolute left-0.5 top-0.5 h-1 w-1 rounded-full"
                    style={{ backgroundColor: themeColors.primary }}
                />
            </div>
        </div>
    )
}

export function ZyraLogoASCII({
    className,
    shimmer = false,
    size = 'md',
    tone = 'accent',
    variant = 'cli'
}: {
    className?: string
    shimmer?: boolean
    size?: 'md' | 'lg'
    tone?: 'accent' | 'neutral' | 'theme'
    variant?: 'cli' | 'loading'
}) {
    const { settings } = useSettings()
    const themeColors = {
        primary: settings.accentColor.secondary,
        secondary: settings.accentColor.primary
    }
    const shimmerBackground = tone === 'neutral'
        ? 'linear-gradient(100deg, transparent 0%, var(--loading-shimmer-dim) 34%, var(--loading-shimmer-bright) 45%, var(--color-text) 50%, var(--loading-shimmer-bright) 55%, var(--loading-shimmer-dim) 66%, transparent 100%)'
        : `linear-gradient(90deg, ${themeColors.primary}55, ${themeColors.primary}, ${themeColors.secondary}, ${themeColors.primary}55)`
    const solidColor = tone === 'neutral' ? 'var(--loading-logo-base)' : tone === 'theme' ? 'var(--accent-primary)' : themeColors.primary
    const logoTextClass = cn(
        'm-0 select-none whitespace-pre font-mono',
        size === 'lg' ? 'text-[18px] leading-[0.94] tracking-[-0.03em]' : 'text-[13px] leading-[1.05] tracking-[-0.03em]'
    )

    if (variant === 'loading') {
        const loadingShineStyle = {
            backgroundImage: shimmerBackground,
            backgroundSize: '280% 100%',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            animation: 'zyraAsciiShine 4s linear infinite'
        }
        const cellClassName = cn(
            'inline-flex items-center justify-center font-mono leading-none',
            size === 'lg' ? 'h-[21px] w-[9px] text-[21px]' : 'h-[14px] w-[6.5px] text-[14px]'
        )

        const grid = ZYRA_CLI_ASCII_LOGO_ROWS.map((row, rowIndex) => (
            <div key={rowIndex} className="flex h-[1em]">
                {Array.from(row.padEnd(14, ' ')).map((char, columnIndex) => (
                    <span key={`${rowIndex}-${columnIndex}`} className={cellClassName}>
                        {char === ' ' ? '\u00A0' : char}
                    </span>
                ))}
            </div>
        ))

        return (
            <div className={cn('relative inline-block leading-none', className)}>
                <div className="relative" style={{ color: solidColor }} aria-hidden="true">
                    {grid}
                </div>
                {shimmer ? (
                    <div className="pointer-events-none absolute inset-0" style={loadingShineStyle} aria-hidden="true">
                        {grid}
                    </div>
                ) : null}
            </div>
        )
    }

    const logoStyle = shimmer ? {
        backgroundImage: shimmerBackground,
        backgroundSize: tone === 'neutral' ? '280% 100%' : '260% 100%',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        animation: tone === 'neutral' ? 'zyraLogoShimmer 4s linear infinite' : 'shimmer 2.8s linear infinite'
    } : { color: solidColor }

    return (
        <div className={cn('relative inline-block', className)}>
            <pre className={logoTextClass} style={logoStyle}>
                {ZYRA_CLI_ASCII_LOGO}
            </pre>
        </div>
    )
}

export function ZyraLogoASCIIMini({ className, shimmer = false }: { className?: string; shimmer?: boolean }) {
    const { settings } = useSettings()
    const themeColors = {
        primary: settings.accentColor.secondary,
        secondary: settings.accentColor.primary
    }

    return (
        <div className={cn('relative inline-block', className)}>
            <pre
                className="m-0 select-none whitespace-pre font-mono text-[6px] leading-[1] tracking-[-0.03em]"
                style={shimmer ? {
                    backgroundImage: `linear-gradient(90deg, ${themeColors.primary}55, ${themeColors.primary}, ${themeColors.secondary}, ${themeColors.primary}55)`,
                    backgroundSize: '240% 100%',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                    animation: 'shimmer 2.4s linear infinite'
                } : { color: themeColors.primary }}
            >
                {ZYRA_CLI_ASCII_LOGO}
            </pre>
        </div>
    )
}
