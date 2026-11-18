import { UI_SCREENS } from './ui-screens'

// Public IDs describe user-visible objects, never DOM paths or session IDs.
export type UiProperty = { type: 'enum' | 'number' | 'color'; default: string | number; values?: readonly string[]; min?: number; max?: number; writable: boolean }
export type UiPart = { id: string; label: string; parent: string | null; states: readonly string[]; properties: Record<string, UiProperty>; protection: 'normal' | 'protected' | 'native' }
export type UiPartConfig = { version: 1; overrides: Record<string, Record<string, string | number>> }
const part = (id: string, label: string, parent: string | null, states: string[] = [], protection: UiPart['protection'] = 'normal'): UiPart => ({ id, label, parent, states, protection, properties: {} })
export const UI_PARTS: readonly UiPart[] = [
    part('workspace', 'Workspace', null), part('sidebar', 'Chat sidebar', 'workspace', ['empty','populated']),
    { ...part('sidebar.chatRow', 'Chat row', 'sidebar', ['selected','pinned','settled','ready','working','approval','input','failed','stopped','done']), properties: {
        density: { type: 'enum', values: ['compact','default','comfortable'], default: 'default', writable: true },
        radius: { type: 'number', min: 0, max: 24, default: 'theme', writable: true },
        background: { type: 'color', default: 'theme', writable: true }, motion: { type: 'number', min: 0, max: 400, default: 'theme', writable: true }
    } },
    ...Object.entries({ title:'Chat title', activityIndicator:'Chat activity', actions:'Chat actions', context:'Work context', model:'Model and presence' }).map(([id,label]) => part(`sidebar.chatRow.${id}`, label, 'sidebar.chatRow')),
    part('permission.approval','Action approval','workspace',['pending','responding'],'protected'),
    part('connection.recovery','Connection recovery','workspace',[],'protected'),
    ...UI_SCREENS.map(([,id,label]) => part(id,label,'workspace')),
    part('native.filePicker','System file picker',null,[],'native')
]
// Hydration is tolerant of missing/invalid historical settings; new writes remain strict.
export function loadUiPartConfig(input: unknown): UiPartConfig {
    try { return validateUiPartConfig(input) } catch { return { version: 1, overrides: {} } }
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
