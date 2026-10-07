import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { OPENAI_CODEX_CALLBACK_SUCCESS_HTML } from "./openai-codex-callback-page.mjs";
import { AUTH_CALLBACK_HEADERS, renderAuthCallbackPage } from './auth-callback-page.mjs';
import {
  resolveOpenAICodexAuthBaseUrl,
  resolveOpenAICodexOAuthClientId,
} from "./openai-codex-oauth.mjs";

const AUTH_REQUEST_TIMEOUT_MS = 15_000;
const DEVICE_CODE_TIMEOUT_MS = 15 * 60_000;
const BROWSER_CALLBACK_TIMEOUT_MS = 15 * 60_000;

export async function loginOpenAICodexAuth(authStorage, options = {}) {
  if (typeof authStorage?.loginOAuth !== "function") {
    throw new TypeError("Zyra OAuth credential storage is unavailable.");
  }
  const clientId = resolveOpenAICodexOAuthClientId({
    clientId: options.clientId ?? options.oauthClientId,
    env: options.env,
  });
  const authBaseUrl = resolveOpenAICodexAuthBaseUrl(options.authBaseUrl);
  const fetchImpl = options.fetchImpl ?? options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw authError("OpenAI sign-in is unavailable in this runtime.", "ZYRA_OAUTH_UNAVAILABLE");

  const signInMethod = options.signInMethod ?? "browser";
  const tokens = signInMethod === "device-code"
    ? await loginWithDeviceCode({ ...options, authBaseUrl, clientId, fetchImpl })
    : signInMethod === "browser"
      ? await loginWithBrowser({ ...options, authBaseUrl, clientId, fetchImpl })
      : (() => { throw new TypeError(`Unsupported OpenAI sign-in method: ${signInMethod}.`); })();
  throwIfAborted(options.signal);
  const credential = createOAuthCredential(tokens, currentTime(options));
  await authStorage.loginOAuth("openai-codex", credential, { signal: options.signal, accountId: options.accountId });
  await options.onProgress?.("ChatGPT sign-in complete.");
  return credential;
}

async function loginWithDeviceCode(options) {
  const endpoint = `${options.authBaseUrl}/api/accounts/deviceauth/usercode`;
  const response = await postJson(options.fetchImpl, endpoint, { client_id: options.clientId }, options);
  if (!response.ok) {
    throw authError(
      response.status === 404
        ? "OpenAI device-code sign-in is unavailable; choose browser sign-in instead."
        : `OpenAI device-code request failed (HTTP ${response.status}).`,
      "ZYRA_OAUTH_DEVICE_CODE_FAILED",
    );
  }
  const details = await readJson(response, "OpenAI returned an invalid device-code response.");
  const deviceAuthId = nonEmptyString(details?.device_auth_id);
  const userCode = nonEmptyString(details?.user_code ?? details?.usercode);
  if (!deviceAuthId || !userCode) {
    throw authError("OpenAI returned an incomplete device-code response.", "ZYRA_OAUTH_DEVICE_CODE_INVALID");
  }

  const intervalSeconds = Math.max(1, Math.floor(Number(details.interval) || 5));
  const expiresAt = currentTime(options) + DEVICE_CODE_TIMEOUT_MS;
  await options.onDeviceCode?.({
    verificationUri: `${options.authBaseUrl}/codex/device`,
    userCode,
    expiresAt: new Date(expiresAt).toISOString(),
  });
  throwIfAborted(options.signal);
  await options.onProgress?.("Waiting for device-code approval.");

  const deadline = currentTime(options) + DEVICE_CODE_TIMEOUT_MS;
  for (;;) {
    throwIfAborted(options.signal);
    if (currentTime(options) >= deadline) {
      throw authError("OpenAI device-code sign-in timed out.", "ZYRA_OAUTH_DEVICE_CODE_TIMEOUT");
    }
    const pollResponse = await postJson(options.fetchImpl, `${options.authBaseUrl}/api/accounts/deviceauth/token`, {
      device_auth_id: deviceAuthId,
      user_code: userCode,
    }, options);
    if (pollResponse.ok) {
      const result = await readJson(pollResponse, "OpenAI returned an invalid device-code token response.");
      const code = nonEmptyString(result?.authorization_code);
      const codeChallenge = nonEmptyString(result?.code_challenge);
      const codeVerifier = nonEmptyString(result?.code_verifier);
      if (!code || !codeChallenge || !codeVerifier) {
        throw authError("OpenAI returned incomplete device-code authorization data.", "ZYRA_OAUTH_DEVICE_CODE_INVALID");
      }
      return exchangeAuthorizationCode(options, {
        code,
        codeChallenge,
        codeVerifier,
        redirectUri: `${options.authBaseUrl}/deviceauth/callback`,
      });
    }
    if (pollResponse.status !== 403 && pollResponse.status !== 404) {
      throw authError(`OpenAI device-code polling failed (HTTP ${pollResponse.status}).`, "ZYRA_OAUTH_DEVICE_CODE_FAILED");
    }
    await wait(intervalSeconds * 1000, options);
  }
}

async function loginWithBrowser(options) {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(32).toString("base64url");
  const callback = await listenForOAuthCallback(state, options);
  try {
    const authorizationUrl = new URL(`${options.authBaseUrl}/oauth/authorize`);
    authorizationUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: options.clientId,
      redirect_uri: callback.redirectUri,
      scope: "openid profile email offline_access",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "zyra",
    }).toString();
    await options.onProgress?.("Waiting for browser sign-in.");
    throwIfAborted(options.signal);
    await options.onAuth?.({
      url: authorizationUrl.href,
      instructions: "Complete sign-in in your browser, then return to Zyra.",
    });
    throwIfAborted(options.signal);
    const { code } = await callback.result;
    return exchangeAuthorizationCode(options, {
      code,
      codeChallenge: challenge,
      codeVerifier: verifier,
      redirectUri: callback.redirectUri,
    });
  } finally {
    await callback.close();
  }
}

async function exchangeAuthorizationCode(options, { code, codeChallenge, codeVerifier, redirectUri }) {
  const response = await request(options.fetchImpl, `${options.authBaseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: options.clientId,
      code_verifier: codeVerifier,
    }),
  }, options);
  if (!response.ok) {
    throw authError(
      response.status === 400 || response.status === 401
        ? "OpenAI sign-in could not be completed. Start sign-in again."
        : `OpenAI token exchange failed (HTTP ${response.status}).`,
      response.status === 400 || response.status === 401 ? "ZYRA_AUTH_REAUTH_REQUIRED" : "ZYRA_OAUTH_TOKEN_EXCHANGE_FAILED",
    );
  }
  const tokens = await readJson(response, "OpenAI returned an invalid token response.");
  if (codeChallenge && tokens?.code_challenge && tokens.code_challenge !== codeChallenge) {
    throw authError("OpenAI returned mismatched PKCE data.", "ZYRA_OAUTH_PKCE_MISMATCH");
  }
  return tokens;
}

function listenForOAuthCallback(expectedState, options) {
  const redirectHost = String(options.redirectHost ?? "localhost").toLowerCase();
  if (redirectHost !== "localhost" && redirectHost !== "127.0.0.1") {
    throw authError("OpenAI sign-in callback must use a local address.", "ZYRA_OAUTH_REDIRECT_HOST_INVALID");
  }
  const requestedPort = options.callbackPort === undefined ? undefined : Number(options.callbackPort);
  if (requestedPort !== undefined && (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535)) {
    throw new TypeError("OpenAI sign-in callback port must be a valid TCP port.");
  }
  let resolveResult;
  let rejectResult;
  let settled = false;
  let timeout;
  let abortHandler;
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  result.catch(() => {});

  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (abortHandler) options.signal?.removeEventListener("abort", abortHandler);
    callback(value);
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method !== "GET" || url.pathname !== "/auth/callback") {
      response.writeHead(404, { "Cache-Control": "no-store" }).end("Not found");
      return;
    }
    if (url.searchParams.get("state") !== expectedState) {
      response.writeHead(400, AUTH_CALLBACK_HEADERS).end(renderAuthCallbackPage({ serviceName: 'ChatGPT', serviceKey: 'chatgpt', failed: true }));
      finish(rejectResult, authError("OpenAI sign-in state did not match.", "ZYRA_OAUTH_STATE_MISMATCH"));
      return;
    }
    const providerError = url.searchParams.get("error");
    if (providerError) {
      response.writeHead(400, AUTH_CALLBACK_HEADERS).end(renderAuthCallbackPage({ serviceName: 'ChatGPT', serviceKey: 'chatgpt', failed: true }));
      finish(rejectResult, authError("OpenAI sign-in was declined or could not be completed.", "ZYRA_OAUTH_PROVIDER_ERROR"));
      return;
    }
    const code = nonEmptyString(url.searchParams.get("code"));
    if (!code) {
      response.writeHead(400, AUTH_CALLBACK_HEADERS).end(renderAuthCallbackPage({ serviceName: 'ChatGPT', serviceKey: 'chatgpt', failed: true }));
      finish(rejectResult, authError("OpenAI returned no authorization code.", "ZYRA_OAUTH_CODE_MISSING"));
      return;
    }
    response.writeHead(200, AUTH_CALLBACK_HEADERS).end(OPENAI_CODEX_CALLBACK_SUCCESS_HTML);
    finish(resolveResult, { code });
  });

  return (async () => {
    let listeningPort;
    try {
      listeningPort = await listen(server, requestedPort ?? 1455);
    } catch (error) {
      if (error?.code === "EADDRINUSE") {
        throw authError("Another sign-in is using OpenAI's local callback port. Finish or close it, then try again.", "ZYRA_OAUTH_CALLBACK_BUSY", error);
      }
      throw error;
    }
    timeout = setTimeout(() => finish(rejectResult, authError("Browser sign-in timed out.", "ZYRA_OAUTH_CALLBACK_TIMEOUT")), options.callbackTimeoutMs ?? BROWSER_CALLBACK_TIMEOUT_MS);
    timeout.unref?.();
    abortHandler = () => finish(rejectResult, abortError(options.signal));
    if (options.signal?.aborted) abortHandler();
    else options.signal?.addEventListener("abort", abortHandler, { once: true });
    return {
      redirectUri: `http://${redirectHost}:${listeningPort}/auth/callback`,
      result,
      close: () => new Promise((resolve) => {
        finish(rejectResult, authError("OpenAI sign-in was cancelled.", "ZYRA_OAUTH_CANCELLED"));
        if (!server.listening) return resolve();
        server.close(() => resolve());
      }),
    };
  })();
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("OAuth callback listener has no TCP port."));
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function postJson(fetchImpl, url, body, options) {
  return request(fetchImpl, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, options);
}

async function request(fetchImpl, url, init, options) {
  throwIfAborted(options.signal);
  let response;
  try {
    const timeoutSignal = AbortSignal.timeout(options.requestTimeoutMs ?? AUTH_REQUEST_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
    response = await fetchImpl(url, { ...init, redirect: "error", signal });
  } catch (error) {
    if (options.signal?.aborted) throw abortError(options.signal);
    throw authError("Could not reach OpenAI sign-in.", "ZYRA_OAUTH_NETWORK_ERROR", error);
  }
  return response;
}

async function readJson(response, message) {
  try {
    return await response.json();
  } catch (error) {
    throw authError(message, "ZYRA_OAUTH_INVALID_RESPONSE", error);
  }
}

async function wait(ms, options) {
  if (typeof options.sleepImpl === "function") return options.sleepImpl(ms, options.signal);
  try {
    await delay(ms, undefined, { signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) throw abortError(options.signal);
    throw error;
  }
}

function createOAuthCredential(tokens, now) {
  const access = nonEmptyString(tokens?.access_token);
  const refresh = nonEmptyString(tokens?.refresh_token);
  const idToken = nonEmptyString(tokens?.id_token);
  if (!access || !refresh || !idToken) {
    throw authError("OpenAI returned incomplete sign-in credentials.", "ZYRA_OAUTH_INVALID_RESPONSE");
  }
  const claims = decodeJwtClaims(idToken);
  const expiresIn = Number(tokens.expires_in);
  const jwtExpiry = Number(claims?.exp);
  const expires = Number.isFinite(expiresIn) && expiresIn > 0
    ? now + expiresIn * 1000
    : Number.isFinite(jwtExpiry) && jwtExpiry > 0 ? jwtExpiry * 1000 : now;
  const accountId = nonEmptyString(claims?.chatgpt_account_id)
    ?? nonEmptyString(claims?.["https://api.openai.com/auth"]?.chatgpt_account_id);
  return {
    type: "oauth",
    access,
    refresh,
    expires,
    idToken,
    ...(accountId ? { accountId } : {}),
  };
}

function decodeJwtClaims(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims && typeof claims === "object" && !Array.isArray(claims) ? claims : undefined;
  } catch {
    return undefined;
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function currentTime(options) {
  const value = typeof options.now === "function" ? options.now() : options.now ?? Date.now();
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) throw new TypeError("OpenAI sign-in clock must return a valid timestamp.");
  return timestamp;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function abortError(signal) {
  if (signal?.reason instanceof Error && signal.reason.code === "ZYRA_OAUTH_CANCELLED") return signal.reason;
  return authError("OpenAI sign-in was cancelled.", "ZYRA_OAUTH_CANCELLED", signal?.reason instanceof Error ? signal.reason : undefined);
}

function authError(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}
