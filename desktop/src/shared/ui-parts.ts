import { UI_SCREENS } from './ui-screens'

// Public IDs describe user-visible objects, never DOM paths or session IDs.
export type UiProperty = { type: 'enum' | 'number' | 'color'; default: string | number; values?: readonly string[]; min?: number; max?: number; writable: boolean }
export type UiPart = { id: string; label: string; parent: string | null; states: readonly string[]; properties: Record<string, UiProperty>; protection: 'normal' | 'protected' | 'native' }
export type UiPartConfig = { version: 1; overrides: Record<string, Record<string, string | number>> }
const part = (id: string, label: string, parent: string | null, states: string[] = [], protection: UiPart['protection'] = 'normal'): UiPart => ({ id, label, parent, states, protection, properties: {} })
const background: UiProperty = { type: 'color', default: 'theme', writable: true }
const radius: UiProperty = { type: 'number', min: 0, max: 24, default: 'theme', writable: true }
const surface = (id: string, label: string, parent: string, corners = true): UiPart => ({ ...part(id,label,parent), properties: corners ? { background, radius } : { background } })
export const UI_PARTS: readonly UiPart[] = [
    part('workspace', 'Workspace', null), part('sidebar', 'Chat sidebar', 'workspace', ['empty','populated']),
    { ...part('sidebar.chatRow', 'Chat row', 'sidebar', ['selected','pinned','settled','ready','working','approval','input','failed','stopped','done']), properties: {
        density: { type: 'enum', values: ['compact','default','comfortable'], default: 'default', writable: true },
        radius: { type: 'number', min: 0, max: 24, default: 'theme', writable: true },
        background: { type: 'color', default: 'theme', writable: true }, motion: { type: 'number', min: 0, max: 400, default: 'theme', writable: true }
    } },
    ...Object.entries({ title:'Chat title', activityIndicator:'Chat activity', actions:'Chat actions', context:'Work context', model:'Model and presence' }).map(([id,label]) => part(`sidebar.chatRow.${id}`, label, 'sidebar.chatRow')),
    surface('chat.header','Conversation header','screen.assistant'),
    surface('chat.composer','Message composer','screen.assistant'),
    surface('chat.userMessage','User message bubble','screen.assistant'),
    surface('chat.assistantMessage','Assistant response','screen.assistant'),
    surface('settings.section','Settings section card','workspace'),
    surface('settings.row','Settings row','settings.section'),
    part('permission.approval','Action approval','workspace',['pending','responding'],'protected'),
    part('connection.recovery','Connection recovery','workspace',[],'protected'),
    ...UI_SCREENS.map(([,id,label]) => surface(id,label,'workspace',false)),
    part('native.filePicker','System file picker',null,[],'native')
]
// Hydration is tolerant of missing/invalid historical settings; new writes remain strict.
export function loadUiPartConfig(input: unknown): UiPartConfig {
    try { return validateUiPartConfig(input) } catch { return { version: 1, overrides: {} } }
}
// Apply only named edits; the stored format stays version 1. A property's catalog
// default removes its override. Validate each change before combining the batch.
export function applyUiPartEdits(current: unknown, request: unknown): UiPartConfig {
    if (!object(request) || Object.keys(request).length !== 1 || !Array.isArray(request.edits) || !request.edits.length || request.edits.length > 64) throw Error('Expected 1–64 UI part edits')
    const config = validateUiPartConfig(current)
    for (const edit of request.edits) {
        if (!object(edit) || Object.keys(edit).length !== 3 || typeof edit.part !== 'string' || typeof edit.property !== 'string' || !Object.hasOwn(edit,'value')) throw Error('Each edit requires part, property and value')
        const {part,property,value} = edit
        const change = validateUiPartConfig({version:1,overrides:{[part]:{[property]:value}}})
        if (change.overrides[part]) Object.assign(config.overrides[part] ??= {}, change.overrides[part])
        else if (config.overrides[part]) { delete config.overrides[part][property]; if (!Object.keys(config.overrides[part]).length) delete config.overrides[part] }
    }
    return config
}
const byId = new Map(UI_PARTS.map(p => [p.id,p]))
const object = (x: unknown): x is Record<string,unknown> => !!x && typeof x === 'object' && !Array.isArray(x) && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null)
export function validateUiPartConfig(input: unknown): UiPartConfig {
    if (!object(input) || input.version !== 1 || !object(input.overrides) || Object.keys(input).some(k => k !== 'version' && k !== 'overrides')) throw Error('Unsupported UI parts configuration')
    const overrides: UiPartConfig['overrides'] = {}
    for (const [id, changes] of Object.entries(input.overrides)) {
        const p = byId.get(id)
        if (!p || p.protection !== 'normal' || !object(changes)) throw Error(`Invalid part: ${id}`)
        for (const [key, value] of Object.entries(changes)) {
            const spec = Object.hasOwn(p.properties,key) ? p.properties[key] : undefined
            if (!spec?.writable) throw Error(`Unknown or protected property: ${id}.${key}`)
            if (value === spec.default) continue
            if (!(spec.type === 'color' && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) || spec.type === 'enum' && typeof value === 'string' && spec.values?.includes(value) || spec.type === 'number' && typeof value === 'number' && Number.isInteger(value) && value >= spec.min! && value <= spec.max!)) throw Error(`Invalid ${id}.${key}`)
            ;(overrides[id] ??= {})[key] = value
        }
    }
    return { version: 1, overrides }
}
