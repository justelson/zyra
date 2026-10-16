import { Box } from 'lucide-react'

export const INLINE_REFERENCE_CHIP_GEOMETRY = 'inline-flex h-[1.41em] max-w-full items-center gap-[0.33em] rounded-[0.5em] border px-[0.5em] text-[0.86em] font-medium leading-none align-middle'
export const SKILL_REFERENCE_CHIP_TONE = 'border-fuchsia-500/25 bg-fuchsia-500/[0.12] text-fuchsia-700 dark:text-fuchsia-300'

export function SkillReferenceChip({ reference }: { reference: string }) {
    const label = reference.slice('/skill:'.length)
    return (
        <span
            data-skill-reference={reference}
            data-markdown-copy={reference}
            aria-label={`Skill: ${label}`}
            title={`Skill: ${label}`}
            className={`relative align-[-0.125em] ${INLINE_REFERENCE_CHIP_GEOMETRY} ${SKILL_REFERENCE_CHIP_TONE}`}
        >
            <Box aria-hidden="true" className="block size-[1.17em] shrink-0 self-center opacity-85" />
            <span className="block max-w-[24ch] self-center truncate leading-tight">{label}</span>
        </span>
    )
}
