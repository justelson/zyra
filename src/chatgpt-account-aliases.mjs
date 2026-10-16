import { randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { withProviderStoreLock, writeProviderJson } from './provider-transactions.mjs';

const adjectives = ['Amber', 'Quiet', 'Silver', 'Cobalt', 'Lunar', 'Misty', 'Coral', 'Golden', 'Indigo', 'Velvet', 'Jade', 'Azure'];
const nouns = ['Comet', 'Otter', 'Pine', 'Orchid', 'Finch', 'Cedar', 'Orbit', 'River', 'Fox', 'Willow', 'Kite', 'Harbor'];
const validId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const aliasPath = authPath => path.join(path.dirname(authPath), 'chatgpt-account-aliases.json');

export function validateChatGptAccountAlias(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('Use an account name between 1 and 40 characters.');
  }
  return value.trim();
}

async function readAliases(file) {
  try {
    const document = JSON.parse(await readFile(file, 'utf8'));
    if (document.version !== 1 || !document.aliases || typeof document.aliases !== 'object' || Array.isArray(document.aliases) || Object.keys(document.aliases).length > 1000) throw new Error('Invalid account names.');
    return Object.fromEntries(Object.entries(document.aliases).map(([id, alias]) => {
      if (!validId(id)) throw new Error('Invalid account identity.');
      return [id, validateChatGptAccountAlias(alias)];
    }));
  } catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('Saved account names could not be read.', { cause: error }); }
}

// Display metadata only. Never store emails or rewrite account credentials.
export async function getChatGptAccountAliases(authPath, ids) {
  const file = aliasPath(authPath);
  const existing = await readAliases(file);
  if (ids.every(id => existing[id])) return existing;
  return withProviderStoreLock(file, async () => {
    const aliases = await readAliases(file);
    const taken = new Set(Object.values(aliases));
    for (const id of ids) {
      if (!validId(id)) throw new TypeError('Choose a connected account.');
      if (aliases[id]) continue;
      let name;
      do { name = `${adjectives[randomInt(adjectives.length)]} ${nouns[randomInt(nouns.length)]} ${randomInt(100, 1000)}`; } while (taken.has(name));
      aliases[id] = name;
      taken.add(name);
    }
    await writeProviderJson(file, { version: 1, aliases });
    return aliases;
  });
}

export async function saveChatGptAccountAlias(authPath, id, value) {
  if (!validId(id)) throw new TypeError('Choose a connected account.');
  const alias = validateChatGptAccountAlias(value);
  const file = aliasPath(authPath);
  await withProviderStoreLock(file, async () => {
    const aliases = await readAliases(file);
    aliases[id] = alias;
    await writeProviderJson(file, { version: 1, aliases });
  });
}
