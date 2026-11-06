import { appendFileSync } from 'node:fs';

export const catalog = { connected: ['broker-fixture'], all: [{ id: 'broker-fixture', models: {
  discovered: { id: 'discovered', name: 'Discovered fixture', capabilities: { reasoning: true }, limit: { context: 32768, output: 4096 } },
} }] };
if (process.env.ZYRA_BROKER_FIXTURE_LOG) {
  const deniedFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const version2 = process.env.ZYRA_BROKER_FIXTURE_VERSION === '2';
    const parsed = new URL(url);
    if (parsed.origin !== 'http://127.0.0.1:9' || parsed.pathname !== (version2 ? '/api/model' : '/provider') || (options.method || 'GET') !== 'GET') return deniedFetch(url, options);
    if (new Headers(options.headers).get('authorization') !== `Basic ${Buffer.from('opencode:private-broker-fixture').toString('base64')}`) throw Error('Fixture transport authentication missing');
    appendFileSync(process.env.ZYRA_BROKER_FIXTURE_LOG, version2 ? 'model\n' : 'provider\n');
    return Response.json(version2 ? { location: { directory: '/fixture' }, data: [{
      id: 'discovered', providerID: 'broker-fixture', name: 'Discovered fixture', type: 'chat', enabled: true, status: 'active',
      capabilities: { tools: true, output: ['text', 'reasoning'] }, limit: { context: 32768, output: 4096 }, variants: [], cost: [],
    }] } : catalog);
  };
}
