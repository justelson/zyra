const POSITION_SUFFIX_PATTERN = /:\d+(?::\d+)?$/
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/
const WINDOWS_ENCODED_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:%5[cC]/
const WINDOWS_UNC_PATH_PATTERN = /^\\\\/
const WINDOWS_ENCODED_UNC_PATH_PATTERN = /^%5[cC]%5[cC]/
const EXTERNAL_LINK_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i
const POSIX_FILESYSTEM_ROOTS = ['/Users/', '/home/', '/tmp/', '/var/', '/etc/', '/opt/', '/mnt/', '/Volumes/', '/private/', '/root/'] as const
const SCOPED_PACKAGE_REFERENCE_PATTERN = /^(@[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*)(?:\/[A-Za-z0-9._~!$&'()+,;=:@%\/-]+)?$/
const AUTO_PATH_ROOT_SEGMENTS = new Set([
    '.github', 'app', 'apps', 'assets', 'bin', 'client', 'config', 'desktop', 'docs', 'examples', 'lib',
    'node_modules', 'packages', 'public', 'resources', 'scripts', 'server', 'src', 'static', 'test', 'tests'
])
const STANDALONE_DOTFILES = new Set([
    '.dockerignore', '.editorconfig', '.env', '.eslintignore', '.eslintrc', '.gitattributes', '.gitignore',
    '.npmrc', '.nvmrc', '.prettierignore', '.prettierrc'
])
const FILE_REFERENCE_EXTENSIONS = new Set([
    'astro', 'bash', 'c', 'cjs', 'cpp', 'cs', 'css', 'csv', 'cts', 'env', 'gif', 'go', 'h', 'hpp',
    'htm', 'html', 'ico', 'java', 'jpeg', 'jpg', 'js', 'json', 'jsx', 'kt', 'kts', 'less', 'lock',
    'lua', 'md', 'mdx', 'mjs', 'mts', 'php', 'png', 'ps1', 'psd1', 'psm1', 'py', 'rb', 'rs', 'sass',
    'scss', 'sh', 'sql', 'svelte', 'svg', 'swift', 'toml', 'ts', 'tsx', 'txt', 'vue', 'webp', 'xml',
    'yaml', 'yml', 'zsh', 'pdf', 'docx', 'xlsx', 'pptx', 'zip', '7z', 'tar', 'gz', 'mp3', 'mp4'
])

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

function stripSearchHashAndPosition(value: string): string {
    const hashIndex = value.indexOf('#')
    const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value
    const queryIndex = withoutHash.indexOf('?')
    const withoutQuery = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash
    return withoutQuery.replace(POSITION_SUFFIX_PATTERN, '')
}

function basenameOfPath(pathValue: string): string {
    const normalized = pathValue.replace(/\\/g, '/').replace(/\/+$/, '')
    const slashIndex = normalized.lastIndexOf('/')
    return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized
}

function extensionOfPath(pathValue: string): string {
    const basename = basenameOfPath(stripSearchHashAndPosition(pathValue.trim()))
    if (!basename || basename === '.' || basename === '..') return ''
    if (basename.startsWith('.') && basename.indexOf('.', 1) === -1) return basename.slice(1)
    const dotIndex = basename.lastIndexOf('.')
    if (dotIndex <= 0 || dotIndex === basename.length - 1) return ''
    return basename.slice(dotIndex + 1).toLowerCase()
}

function hasKnownFileExtension(pathValue: string): boolean {
    const ext = extensionOfPath(pathValue)
    return Boolean(ext && FILE_REFERENCE_EXTENSIONS.has(ext))
}

function isAmbiguousBareSlashPair(pathValue: string): boolean {
    const segments = pathValue.split(/[\\/]+/).filter(Boolean)
    if (segments.length !== 2) return false
    if (AUTO_PATH_ROOT_SEGMENTS.has(segments[0]!.toLowerCase())) return false
    return segments.every((segment) => /^[A-Za-z]+$/.test(segment))
}

export type MarkdownPackageReference = {
    specifier: string
    packageName: string
    href: string
}

export function resolveMarkdownPackageReference(value: string): MarkdownPackageReference | null {
    const specifier = String(value || '').trim()
    if (!specifier || specifier.includes('\n') || /\s/.test(specifier)) return null
    const match = specifier.match(SCOPED_PACKAGE_REFERENCE_PATTERN)
    const packageName = match?.[1]
    if (!packageName) return null
    return {
        specifier,
        packageName,
        href: `https://www.npmjs.com/package/${packageName}`
    }
}

export function hasActiveTextSelection(): boolean {
    if (typeof window === 'undefined') return false
    const selection = window.getSelection()
    return Boolean(selection && !selection.isCollapsed && selection.toString().trim().length > 0)
}

export function looksLikeMarkdownFileReference(value: string): boolean {
    const trimmed = String(value || '').trim()
    if (!trimmed || trimmed.includes('\n') || /\s/.test(trimmed) || trimmed.startsWith('#')) return false
    if (resolveMarkdownPackageReference(trimmed)) return false
    const decodedTrimmed = safeDecode(trimmed)
    if (/[<>]/.test(decodedTrimmed)) return false
    if (/:$/.test(decodedTrimmed) && !WINDOWS_ABSOLUTE_PATH_PATTERN.test(decodedTrimmed) && !POSITION_SUFFIX_PATTERN.test(decodedTrimmed)) return false
    if (/^\.[^\\/]+$/.test(decodedTrimmed)) {
        const normalizedDotfile = decodedTrimmed.toLowerCase()
        return STANDALONE_DOTFILES.has(normalizedDotfile) || normalizedDotfile.startsWith('.env.')
    }
    const isWindowsPath = WINDOWS_ABSOLUTE_PATH_PATTERN.test(decodedTrimmed)
        || WINDOWS_UNC_PATH_PATTERN.test(decodedTrimmed)
        || WINDOWS_ENCODED_ABSOLUTE_PATH_PATTERN.test(trimmed)
        || WINDOWS_ENCODED_UNC_PATH_PATTERN.test(trimmed)
    if (EXTERNAL_LINK_PATTERN.test(trimmed) && !trimmed.toLowerCase().startsWith('file://') && !isWindowsPath) return false

    if (trimmed.toLowerCase().startsWith('file://')) return true
    const candidate = stripSearchHashAndPosition(decodedTrimmed)
    if (!candidate || candidate.endsWith('/') || candidate.endsWith('\\')) return false
    if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(candidate) || WINDOWS_UNC_PATH_PATTERN.test(candidate)) return true
    if (candidate.startsWith('./') || candidate.startsWith('../') || candidate.startsWith('~/')) return true
    if (candidate.startsWith('/')) {
        return POSITION_SUFFIX_PATTERN.test(trimmed)
            || POSIX_FILESYSTEM_ROOTS.some((prefix) => candidate.startsWith(prefix))
            || hasKnownFileExtension(candidate)
    }
    if (isAmbiguousBareSlashPair(candidate)) return false
    if (/[\\/]/.test(candidate) && !hasKnownFileExtension(candidate)) {
        const firstSegment = candidate.split(/[\\/]+/, 1)[0]?.toLowerCase() || ''
        return AUTO_PATH_ROOT_SEGMENTS.has(firstSegment) || firstSegment.startsWith('.')
    }
    return /[\\/]/.test(candidate) || hasKnownFileExtension(candidate)
}
