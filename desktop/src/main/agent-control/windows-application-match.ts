// Registered application display names differ from their process names. Keep these
// exact aliases narrow: document titles containing an app name are not identity.
const processAliases: Record<string, string> = {
    'paint': 'mspaint',
    'microsoft paint': 'mspaint',
    'google chrome': 'chrome',
    'microsoft edge': 'msedge',
    'mozilla firefox': 'firefox'
}

export function matchesWindowsApplication(candidate: { applicationName: string; title: string }, application: string): boolean {
    const query = application.trim().toLocaleLowerCase('en-US')
    const process = candidate.applicationName.trim().toLocaleLowerCase('en-US')
    return process === query || process === processAliases[query]
        || (process === 'applicationframehost' && candidate.title.trim().toLocaleLowerCase('en-US') === query)
}
