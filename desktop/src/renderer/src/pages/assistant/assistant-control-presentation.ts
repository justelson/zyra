import type { ControlCapability, ControlSideEffectClass, ControlTarget } from '@shared/agent-control/contracts'

export function controlTargetLabel(target: ControlTarget | undefined): string {
    if (!target) return 'the selected computer surface'
    if (target.kind === 'zyra-browser') {
        if (target.title?.trim()) return target.title.trim()
        if (target.origin) return hostLabel(target.origin) || target.origin
        return 'Zyra Browser'
    }
    if (target.kind === 'chrome-tab') {
        return target.origin ? `Chrome tab on ${hostLabel(target.origin) || target.origin}` : 'the selected Chrome tab'
    }
    if (target.title?.trim()) return target.title.trim()
    if (target.applicationName?.trim()) return target.applicationName.trim()
    return target.executableIdentity.split(/[\\/]/).at(-1) || 'the selected Windows app'
}

export function controlTargetScope(target: ControlTarget | undefined): string | null {
    if (!target) return null
    if (target.kind === 'windows-window') return target.executableIdentity
    return target.origin || null
}

export function controlCapabilitySummary(capabilities: readonly ControlCapability[]): string {
    const actions: string[] = []
    if (capabilities.some((entry) => entry.startsWith('observe.'))) actions.push('view')
    if (capabilities.some((entry) => entry.startsWith('pointer.'))) actions.push('click')
    if (capabilities.some((entry) => entry.startsWith('keyboard.')) || capabilities.includes('form.select')) actions.push('type')
    if (capabilities.includes('navigate')) actions.push('navigate')
    if (capabilities.includes('scroll')) actions.push('scroll')
    if (capabilities.includes('tab.manage')) actions.push('manage tabs')
    return actions.length > 0
        ? new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' }).format(actions)
        : 'use this surface'
}

export function controlSideEffectLabel(value: Exclude<ControlSideEffectClass, 'none'>): string {
    const labels: Record<Exclude<ControlSideEffectClass, 'none'>, string> = {
        'send-or-publish': 'send or publish content',
        purchase: 'complete a purchase',
        'account-change': 'change an account',
        'security-change': 'change security settings',
        'destructive-delete': 'delete data',
        'file-upload': 'upload a local file',
        'sensitive-data-submit': 'submit sensitive data',
        'software-install': 'install software',
        'legal-acceptance': 'accept legal terms'
    }
    return labels[value]
}

function hostLabel(value: string): string | null {
    try { return new URL(value).hostname.replace(/^www\./, '') || null }
    catch { return null }
}
