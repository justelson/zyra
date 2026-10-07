import type { AssistantActivity } from './contracts'

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const words = (value: string) => value.replace(/^API[-_]/i, '').replace(/[_-]+/g, ' ').trim()
export function isPluginActivity(activity: AssistantActivity): boolean {
    return activity.kind === 'plugin-mcp' || activity.payload?.category === 'plugin-mcp' || /(?:^|[._])plugin_mcp$/i.test(text(activity.payload?.toolName))
}
export function describePluginActivity(activity: AssistantActivity) {
    const data = activity.payload || {}
    const args = record(data.args) || record(data.arguments) || {}
    const action = text(data.action) || text(args.action) || 'call'
    const target = text(data.target) || text(args.tool)
    const server = text(data.server) || text(args.server)
    const slug = text(data.pluginSlug) || server.split(/[._]/)[0] || ''
    const plugin = text(data.pluginName) || (slug ? slug[0].toUpperCase() + slug.slice(1).replace(/-/g, ' ') : 'Plugins')
    const status = text(data.status)
    const running = /running|in_progress|starting/i.test(status)
    const failed = /failed|error/i.test(status)
    let present = 'Running', past = 'Ran', resource = words(target) || 'plugin action'
    if (action === 'servers') { present = 'Finding'; past = 'Found'; resource = 'available plugins' }
    else if (action === 'tools') { present = 'Listing'; past = 'Listed'; resource = 'available tools' }
    else {
        const kind = /page/i.test(target) ? 'pages' : /block/i.test(target) ? 'blocks' : /issue/i.test(target) ? 'issues' : /message|email/i.test(target) ? 'messages' : /file/i.test(target) ? 'files' : 'items'
        if (/search|find/i.test(target)) { present = 'Searching'; past = 'Searched'; resource = kind }
        else if (/retrieve|fetch|(?:^|[_-])get(?:[_-]|$)|read/i.test(target)) { present = 'Reading'; past = 'Read'; resource = kind === 'items' ? words(target) : kind }
        else if (/create|post.*(?:page|issue|block)/i.test(target)) { present = 'Creating'; past = 'Created'; resource = kind }
        else if (/update|edit|patch/i.test(target)) { present = 'Updating'; past = 'Updated'; resource = kind }
        else if (/delete|remove/i.test(target)) { present = 'Deleting'; past = 'Deleted'; resource = kind }
    }
    const verb = ({ Running: 'run', Finding: 'find', Listing: 'list', Searching: 'search', Reading: 'read', Creating: 'create', Updating: 'update', Deleting: 'delete' } as Record<string, string>)[present]
    const title = failed ? `Could not ${verb} ${resource}` : `${running ? present : past} ${resource}`
    const input = record(args.arguments) || record(data.toolArguments) || {}
    const fields = Object.entries(input).filter(([,value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean').slice(0, 6).map(([key,value]) => ({label:words(key),value:String(value)}))
    return {title, plugin, slug, target, server, action, running, failed, fields, arguments: input}
}

export type PluginResultItem = { title: string; type: string; url: string | null }
export function readPluginResult(value: unknown, rawOutput = ''): {items:PluginResultItem[]; count:number | null; text:string | null} {
    let candidate: unknown = value
    if (!candidate || (record(candidate) && !Object.keys(record(candidate)!).length)) { try {candidate=JSON.parse(rawOutput)} catch {candidate=null} }
    for (let depth = 0; depth < 6; depth++) {
    const result = record(candidate)
    if (!result) break
    if (result.details !== undefined) { candidate = result.details; continue }
    if (result.result !== undefined) { candidate = result.result; continue }
    if (result.structuredContent !== undefined) { candidate = result.structuredContent; continue }
    if (Array.isArray(result.content)) {
        const chunks = result.content.map(entry => text(record(entry)?.text)).filter(Boolean)
        const json = chunks.find(chunk => /^[{[]/.test(chunk))
        if (json) { try {candidate=JSON.parse(json); continue} catch {} }
        else if (chunks.length) return {items:[],count:null,text:chunks.join('\n')}
    }
    break
    }
    const data = record(candidate)
    const list = Array.isArray(candidate) ? candidate : [data?.results,data?.items,data?.pages,data?.tools,data?.servers].find(Array.isArray)
    const entries: unknown[] = list || (data?.metadata ? [data.metadata] : data && (data.title || data.url || data.name || data.properties) ? [data] : [])
    const items = entries.slice(0, 6).map(entry => {
        const item = record(entry) || {}
        const titleProperty = Object.values(record(item.properties) || {}).map(record).find(property => Array.isArray(property?.title))
        const richTitle = Array.isArray(item.title) ? item.title : titleProperty?.title
        const title = text(item.title) || text(item.name) || (Array.isArray(richTitle) ? richTitle.map(part => {
            const value = record(part)?.plain_text ?? record(record(part)?.text)?.content
            return typeof value === 'string' ? value : ''
        }).join('').trim() : '') || text(item.id) || 'Untitled result'
        const url = text(item.url) || text(item.web_url) || text(item.html_url)
        return {title,type:text(item.type) || text(item.object),url:/^https?:\/\//i.test(url)?url:null}
    })
    return {items,count:list ? list.length : items.length || null,text:!items.length ? text(candidate) || text(data?.message) || text(data?.error) || text(record(data?.error)?.message) || null : null}
}
