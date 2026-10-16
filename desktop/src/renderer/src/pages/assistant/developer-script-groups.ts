export const developerScriptGroups = [
    { id: 'tests', label: 'Tests', tone: 'text-emerald-400', pattern: /(^|[:_-])(test|spec|e2e|smoke|benchmark)([:_-]|$)/i },
    { id: 'build', label: 'Build & package', tone: 'text-sky-400', pattern: /(^|[:_-])(build|bundle|package|dist|release)([:_-]|$)/i },
    { id: 'checks', label: 'Checks', tone: 'text-violet-400', pattern: /(^|[:_-])(check|lint|typecheck|format|validate)([:_-]|$)/i },
    { id: 'dev', label: 'Development', tone: 'text-amber-400', pattern: /(^|[:_-])(dev|start|serve|watch|preview)([:_-]|$)/i },
    { id: 'other', label: 'Other scripts', tone: 'text-sparkle-text-muted', pattern: /./ },
] as const

export function groupDeveloperScripts(scripts: Record<string, string>, query = '') {
    const names = Object.keys(scripts).filter(name => `${name} ${scripts[name]}`.toLowerCase().includes(query.trim().toLowerCase()))
    return developerScriptGroups.map(group => ({ ...group, names: names.filter(name => developerScriptGroups.find(entry => entry.pattern.test(name))?.id === group.id)
        .sort((a, b) => Number(a.includes(':')) - Number(b.includes(':')) || a.localeCompare(b)) })).filter(group => group.names.length)
}
