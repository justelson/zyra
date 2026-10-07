import { isPreviewDistribution } from '@shared/distribution-identity'

export function DevChannelLabel({ dev = import.meta.env.DEV || isPreviewDistribution() }: { dev?: boolean }) {
    return dev ? <span className="shrink-0 rounded border border-[var(--surface-divider)] px-1.5 py-0.5 text-[10px] font-medium text-sparkle-text-secondary" data-distribution-channel="dev">Dev channel</span> : null
}
