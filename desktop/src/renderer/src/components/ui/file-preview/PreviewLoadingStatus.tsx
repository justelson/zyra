export function PreviewLoadingStatus({ label = 'Loading file...' }: { label?: string }) {
    return (
        <div className="flex h-full min-h-0 w-full flex-1 items-center justify-center text-sm text-sparkle-text-secondary" role="status" aria-live="polite">
            {label}
        </div>
    )
}
