import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

const fixtureProvider = "zyra-offline-fixture";
const fixtureModelId = "bridge-reasoning";
export const fixtureModel = `${fixtureProvider}/${fixtureModelId}`;

// Also loaded by NODE_OPTIONS in every real bridge worker, before SDK imports.
function blockNetwork(logPath) {
  const originalFetch = globalThis.fetch;
  const originalConnect = net.Socket.prototype.connect;
  const deny = () => {
    appendFileSync(logPath, "Unexpected network attempt\n");
    throw new Error("The bridge fixture permits local IPC only, not provider/network calls.");
  };
  globalThis.fetch = deny;
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    // Node normalizes named pipes and Unix sockets to { path }; TCP has a port.
    const ipcPath = typeof first === "string" ? first : first?.path;
    if (typeof ipcPath !== "string" || !ipcPath || /^\d+$/.test(ipcPath)) return deny();
    return originalConnect.apply(this, args);
  };
  syncBuiltinESMExports();
  return () => {
    globalThis.fetch = originalFetch;
    net.Socket.prototype.connect = originalConnect;
    syncBuiltinESMExports();
  };
}

if (process.env.ZYRA_BRIDGE_TEST_NETWORK_LOG) blockNetwork(process.env.ZYRA_BRIDGE_TEST_NETWORK_LOG);

export function isolateBridgeEnvironment(temporary) {
  const previous = { ...process.env };
  const piDirectory = path.join(temporary, "pi-agent");
  const networkLog = path.join(temporary, "network-attempts.log");
  // Allowlist OS plumbing only. Do not inherit provider keys, NODE_OPTIONS,
  // SDK config overrides, extensions, proxy settings, or user session paths.
  for (const name of Object.keys(process.env)) {
    if (!/^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP)$/i.test(name)) delete process.env[name];
  }
  Object.assign(process.env, {
    HOME: temporary,
    USERPROFILE: temporary,
    APPDATA: path.join(temporary, "appdata"),
    LOCALAPPDATA: path.join(temporary, "local"),
    XDG_CONFIG_HOME: path.join(temporary, "config"),
    XDG_DATA_HOME: path.join(temporary, "data"),
    XDG_CACHE_HOME: path.join(temporary, "cache"),
    ZYRA_DATA_ROOT: path.join(temporary, "zyra-data"),
    ZYRA_STATE_DIR: path.join(temporary, "state"),
    ZYRA_CALLER_CWD: path.join(temporary, "project"),
    PI_CODING_AGENT_DIR: piDirectory,
    PI_OFFLINE: "1",
    ZYRA_ANALYTICS_ENABLED: "0",
    ZYRA_ANALYTICS_USE_RELEASE_CONFIG: "0",
    ZYRA_BRIDGE_TEST_NETWORK_LOG: networkLog,
    NODE_OPTIONS: `--import ${JSON.stringify(import.meta.url)}`,
  });
  const restoreNetwork = blockNetwork(networkLog);
  const restore = () => {
    restoreNetwork();
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, previous);
  };
  try {
    mkdirSync(piDirectory, { recursive: true });
    writeFileSync(path.join(piDirectory, "auth.json"), JSON.stringify({
      [fixtureProvider]: { type: "api_key", key: "offline-bridge-fixture-key" },
    }), { mode: 0o600 });
    writeFileSync(path.join(piDirectory, "models.json"), JSON.stringify({
      providers: {
        [fixtureProvider]: {
          api: "openai-completions",
          baseUrl: "https://bridge-fixture.invalid/v1",
          models: [{
            id: fixtureModelId, name: "Offline bridge fixture", reasoning: true,
            input: ["text"], contextWindow: 32768, maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          }],
        },
      },
    }));
    return {
      restore,
      assertOffline() {
        assert.equal(existsSync(networkLog) ? readFileSync(networkLog, "utf8") : "", "", "parent and bridge workers must make no network calls");
      },
    };
  } catch (error) {
    restore();
    throw error;
  }
}
