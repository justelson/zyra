import { useEffect, useState, type ReactNode } from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import ProjectIcon from '@/components/ui/ProjectIcon'
import { useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'
import {
    hydrateProjectMetadataForPaths,
    normalizeProjectPath,
    resolveAssistantProjectPresentation
} from './assistant-sessions-rail-utils'

export function AssistantProjectIcon({
    projectPath,
    projectIconPath,
    projectType,
    framework,
    size = 16,
    expanded = false,
    fallbackIcon,
    className
}: {
    projectPath: string | null | undefined
    projectIconPath?: string | null
    projectType?: string | null
    framework?: string | null
    size?: number
    expanded?: boolean
    fallbackIcon?: ReactNode
    className?: string
}) {
    const { settings } = useSettings()
    const normalizedPath = normalizeProjectPath(projectPath)
    const [, setMetadataRevision] = useState(0)
    const cachedPresentation = resolveAssistantProjectPresentation(normalizedPath, settings.projectIconOverrides)
    const resolvedIconPath = projectIconPath || cachedPresentation.projectIconPath
    const resolvedProjectType = projectType || cachedPresentation.projectType
    const resolvedFramework = framework || cachedPresentation.framework
    const meaningfulProjectType = Boolean(
        resolvedProjectType
        && !['unknown', 'default', 'folder'].includes(resolvedProjectType)
    )
    const hasProjectPresentation = Boolean(
        resolvedIconPath
        || resolvedFramework
        || meaningfulProjectType
    )

    useEffect(() => {
        if (!normalizedPath) return
        let cancelled = false
        void hydrateProjectMetadataForPaths([normalizedPath]).then((hydratedCount) => {
            if (!cancelled && hydratedCount > 0) setMetadataRevision((current) => current + 1)
        })
        return () => {
            cancelled = true
        }
    }, [normalizedPath])

    if (fallbackIcon && (!normalizedPath || !resolvedIconPath)) return <>{fallbackIcon}</>

    if (!normalizedPath || !hasProjectPresentation) {
        const FolderIcon = expanded ? FolderOpen : Folder
        return <FolderIcon size={size} strokeWidth={1.75} className={cn('shrink-0 text-sparkle-text-muted/70', className)} />
    }

    return (
        <ProjectIcon
            key={resolvedIconPath || normalizedPath}
            projectType={meaningfulProjectType ? resolvedProjectType || undefined : undefined}
            framework={resolvedFramework || undefined}
            customIconPath={resolvedIconPath}
            fallbackIcon={fallbackIcon}
            size={size}
            className={cn('shrink-0 overflow-hidden rounded-sm', className)}
        />
    )
}
