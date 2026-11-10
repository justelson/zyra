import path from 'node:path';
import { fileURLToPath } from 'node:url';

const actions = ['read', 'glob', 'grep', 'list', 'shell', 'edit', 'webfetch', 'websearch', 'external_directory'];
const renamed = name => ({ bash: 'shell', task: 'subagent', write: 'edit', patch: 'edit' })[name] ?? name;

/** Tighten only the owned process configuration; never rewrite the user's files. */
export function managedV2Config(inline = process.env.OPENCODE_CONFIG_CONTENT) {
  const existing = inline?.trim() ? JSON.parse(inline) : {};
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) throw new Error('OpenCode inline config must be an object.');
  const legacyRules = value => Object.entries(typeof value === 'object' && value ? value : { '*': value ?? 'ask' }).flatMap(([action, rule]) =>
    Object.entries(typeof rule === 'object' && rule ? rule : { '*': rule }).map(([resource, effect]) => ({ action: renamed(action), resource, effect: effect === 'deny' ? 'deny' : 'ask' })));
  const tighten = rules => (Array.isArray(rules) ? rules : []).map(rule => ({ ...rule, effect: rule.effect === 'deny' ? 'deny' : 'ask' }));
  const rules = existing.permissions ? tighten(existing.permissions) : legacyRules(existing.permission);
  const agent = existing.agents?.['zyra-managed'] ?? {};
  const denies = [...rules, ...tighten(agent.permissions), ...legacyRules(existing.agent?.['zyra-managed']?.permission)].filter(rule => rule.effect === 'deny');
  const plugin = process.env.ZYRA_STANDALONE === '1' && process.env.ZYRA_ROOT
    ? path.join(process.env.ZYRA_ROOT, 'src', 'harness-v2-plugin') : fileURLToPath(new URL('./harness-v2-plugin', import.meta.url));
  return { ...existing, permissions: [{ action: '*', resource: '*', effect: 'ask' }, ...rules],
    // Zyra owns canonical history and safe-point compaction. A second native
    // summary would add model calls and cannot replace the canonical context.
    compaction: { ...existing.compaction, auto: false },
    plugins: [...(Array.isArray(existing.plugins) ? existing.plugins : []), plugin],
    agents: { ...existing.agents, 'zyra-managed': { ...agent, mode: 'primary',
      permissions: [{ action: '*', resource: '*', effect: 'deny' }, ...actions.map(action => ({ action, resource: '*', effect: 'ask' })), ...denies] } },
  };
}
