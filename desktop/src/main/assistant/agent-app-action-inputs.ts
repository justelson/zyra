import { Check } from 'typebox/value'

const text = (maxLength = 512) => ({ type: 'string', minLength: 1, maxLength })
const boolean = { type: 'boolean' }
const revision = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
const object = (properties: Record<string, unknown> = {}, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false })
const list = (items: unknown, maxItems = 256) => ({ type: 'array', items, maxItems })
const choice = (...values: string[]) => ({ type: 'string', enum: values })
const account = { accountId: text() }
const plugin = { pluginId: text() }
const schemas: Record<string, Record<string, unknown>> = {
    'providers.disconnect': object({ provider: text(128) }),
    'accounts.routing': object({ policy: object({ strategy: choice('balanced', 'round-robin', 'fill-first'), accountMode: choice('all', 'selected'), accountIds: list(text()), preferredAccountId: { anyOf: [text(), { type: 'null' }] } }) }),
    'accounts.alias': object({ ...account, alias: text(80) }),
    'accounts.enabled': object({ ...account, enabled: boolean }),
    'accounts.primary': object(account), 'accounts.remove': object(account),
    'accounts.redeem_reset': object({ ...account, creditId: text() }),
    'delegation.update': object({ preset: choice('balanced', 'cost', 'quality', 'speed'), notes: { type: 'string', maxLength: 4000 } }, []),
    'memory.model': object({ model: text(256) }),
    'skills.update_sources': object({ settings: object({ version: { const: 1 }, enabledSourceIds: list(text()), priority: list(text()), preferredSourceBySkill: { type: 'object', additionalProperties: text() }, customSources: list(object({ id: text(), label: text(), path: text(2048), enableOnAdd: boolean }, ['id', 'label', 'path'])) }) }),
    'plugins.enable': object({ ...plugin, expectedRevision: revision }),
    'plugins.disable': object({ ...plugin, expectedRevision: revision }),
    'plugins.refresh_chat': object({ expectedRevision: revision }),
    'plugins.connect': object({ ...plugin, server: text() }),
    'plugins.disconnect': object({ ...plugin, server: text() }),
    'projects.associate_folder': object({ path: text(2048), access: choice('read-only', 'read-write') }),
    'projects.remove_folder': object({ folderId: text() }),
    'startup.update': object({ openAtLogin: boolean, openAsHidden: boolean }),
    'browser.inspect_extension': object({ urlOrId: text(2048) }),
    'browser.install_reviewed_extension': object({ reviewId: text() }),
    'browser.enable_extension': object({ id: text(), enabled: boolean }),
    'browser.remove_extension': object({ id: text() }),
    'browser.reload_extension': object({ id: text() }),
}
export function agentAppActionParameters(id: string): Record<string, unknown> { return structuredClone(schemas[id] || object()) }
export function validateAgentAppActionInput(schema: Record<string, unknown> | undefined, input: unknown) {
    if (schema && !Check(schema, input)) throw new Error('Invalid named-operation input. Read its parameters from settings_action list; no coercion or ignored fields are accepted.')
}
