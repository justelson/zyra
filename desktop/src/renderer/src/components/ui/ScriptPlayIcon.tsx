import type { SVGProps } from 'react'

/** Rounded triangle, shared by script launch controls. */
export function ScriptPlayIcon({ size = 16, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
        <path d="M8.6 4.8C7.4 4.1 6 5 6 6.4v11.2c0 1.4 1.4 2.3 2.6 1.6l9.8-5.6c1.3-.8 1.3-2.5 0-3.2L8.6 4.8Z" />
    </svg>
}
