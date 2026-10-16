import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZyraCredentialStore } from '../src/zyra-auth-store.mjs';
import { saveChatGptAccount } from '../src/chatgpt-account-pool.mjs';
import { getChatGptAccounts, updateChatGptAccounts } from '../src/chatgpt-pool-service.mjs';

const root = await mkdtemp(join(tmpdir(), 'zyra-account-aliases-'));
const authPath = join(root, 'auth.json');
const store = new ZyraCredentialStore({ authPath });
const options = { credentialStore: store };
const credential = id => ({ type: 'oauth', accountId: id, access: `synthetic.${Buffer.from(JSON.stringify({ 'https://api.openai.com/profile': { email: `${id}@example.test` } })).toString('base64url')}.fixture`, refresh: 'fixture', expires: Date.now() + 3600000 });
try {
  await saveChatGptAccount(store, credential('first'));
  await saveChatGptAccount(store, credential('second'));
  const originalAuth = await readFile(authPath, 'utf8');
  const [first, concurrent] = await Promise.all([getChatGptAccounts(options), getChatGptAccounts(options)]);
  assert.deepEqual(first.accounts.map(account => account.alias), concurrent.accounts.map(account => account.alias), 'Concurrent readers agree on persisted defaults.');
  assert.equal(new Set(first.accounts.map(account => account.alias)).size, 2);
  for (const account of first.accounts) assert.match(account.alias, /^[A-Z][a-z]+ [A-Z][a-z]+ \d{3}$/);
  const [a, b] = first.accounts;
  await Promise.all([
    updateChatGptAccounts({ action: 'alias', accountId: a.id, alias: '  Work account  ' }, options),
    updateChatGptAccounts({ action: 'alias', accountId: b.id, alias: 'Personal account' }, options),
  ]);
  const saved = await getChatGptAccounts(options);
  assert.equal(saved.accounts.find(account => account.id === a.id).alias, 'Work account');
  assert.equal(saved.accounts.find(account => account.id === b.id).alias, 'Personal account');
  assert.equal(await readFile(authPath, 'utf8'), originalAuth, 'Naming never rewrites credentials.');
  const metadata = await readFile(join(root, 'chatgpt-account-aliases.json'), 'utf8');
  assert.doesNotMatch(metadata, /example\.test|access|refresh/);
  for (const alias of ['', 'x'.repeat(41), 'bad\nname', null]) await assert.rejects(updateChatGptAccounts({ action: 'alias', accountId: a.id, alias }, options), /1 and 40/);
  await assert.rejects(updateChatGptAccounts({ action: 'alias', accountId: '0'.repeat(32), alias: 'Unknown' }, options), /no longer connected/);
  assert.equal(await readFile(join(root, 'chatgpt-account-aliases.json'), 'utf8'), metadata, 'Rejected edits preserve names.');
  await updateChatGptAccounts({ action: 'primary', accountId: b.id }, options);
  const promoted = await getChatGptAccounts(options);
  assert.equal(promoted.accounts.find(account => account.primary).alias, 'Personal account', 'Names follow account IDs through primary changes.');
  console.log('ChatGPT aliases passed: random persisted defaults, concurrent edits, validation, no credentials or emails in metadata, primary identity.');
} finally { await rm(root, { recursive: true, force: true }); }
