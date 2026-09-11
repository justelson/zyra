import { providerForAppFeature } from '../../shared/assistant/provider-features'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
    AssistantAccountOverview,
    AssistantAccountPlanType,
    AssistantRateLimitResetCredit,
    AssistantRateLimitResetRedemption,
    AssistantRateLimitSnapshot,
    AssistantRateLimitWindow,
    AssistantRedeemAccountResetInput
} from '../../shared/assistant/contracts'
import { getSharedProviderWorkerClient } from '../setup/provider-worker-client'
import { resolveZyraRoot } from '../zyra/zyra-root'

const CHATGPT_ACCOUNT_PROVIDER = providerForAppFeature('subscriptionUsage')
const MAX_RESET_CREDIT_ID_LENGTH = 512

type JsonRecord = Record<string, unknown>

type ChatGptAccountModule = {
    buildChatGptAccountStatus(provider?: string): Promise<unknown>
    fetchCodexResetCredits(): Promise<unknown>
    redeemCodexResetCredit(creditId: string): Promise<unknown>
    isCodexResetCreditAvailable?(credit: unknown): boolean
}

export type ChatGptAccountModuleLoader = () => Promise<ChatGptAccountModule>

export type AssistantRedeemAccountResetResult = {
    redemption: AssistantRateLimitResetRedemption
    overview: AssistantAccountOverview | null
    refreshError: string | null
}

type NormalizedUsageWindow = {
    id: string
    scope: string | null
    label: string | null
    window: AssistantRateLimitWindow
}

let redemptionModulePromise: Promise<ChatGptAccountModule> | null = null

async function redeemResetOnMain(creditId: string): Promise<unknown> {
    // Preserve ownership of the existing external mutation. A worker exit after
    // the POST must not introduce a new ambiguous-redemption failure path.
    if (!redemptionModulePromise) {
        const moduleUrl = pathToFileURL(join(resolveZyraRoot(), 'src', 'chatgpt-account.mjs')).href
        redemptionModulePromise = (import(/* @vite-ignore */ moduleUrl) as Promise<ChatGptAccountModule>).catch(error => {
            redemptionModulePromise = null
            throw error
        })
    }
    return (await redemptionModulePromise).redeemCodexResetCredit(creditId)
}

async function loadChatGptAccountModule(): Promise<ChatGptAccountModule> {
    // Opening/polling Account must not import or create Pi runtimes in main.
    const { account } = getSharedProviderWorkerClient()
    return {
        buildChatGptAccountStatus: account.buildChatGptAccountStatus,
        fetchCodexResetCredits: account.fetchCodexResetCredits,
        redeemCodexResetCredit: redeemResetOnMain
    }
}

export class ZyraAccountService {
    private overviewPromise: Promise<AssistantAccountOverview> | null = null
    private redemptionInFlight = false

    constructor(private readonly loadAccountModule: ChatGptAccountModuleLoader = loadChatGptAccountModule) {}

    async getOverview(forceRefresh = false): Promise<AssistantAccountOverview> {
        if (this.overviewPromise) {
            if (!forceRefresh) return this.overviewPromise
            const pending = this.overviewPromise
            await pending.catch(() => undefined)
            if (this.overviewPromise && this.overviewPromise !== pending) return this.overviewPromise
        }
        const request = this.loadOverview()
        this.overviewPromise = request
        const clearRequest = () => {
            if (this.overviewPromise === request) this.overviewPromise = null
        }
        void request.then(clearRequest, clearRequest)
        return request
    }

    async redeemAccountReset(input: AssistantRedeemAccountResetInput): Promise<AssistantRedeemAccountResetResult> {
        if (!input || input.confirmed !== true) {
            throw new Error('Confirm the banked reset before using it.')
        }
        const creditId = normalizeResetCreditId(input.creditId)
        if (this.redemptionInFlight) {
            throw new Error('Another banked reset is already being used.')
        }

        this.redemptionInFlight = true
        try {
            const accountModule = await this.loadAccountModule()
            const freshResetPayload = asRecord(await accountModule.fetchCodexResetCredits())
            const freshCreditValues = freshResetPayload?.['credits']
            const freshCredits = Array.isArray(freshCreditValues) ? freshCreditValues : []
            const freshCredit = freshCredits.find((value) => asString(asRecord(value)?.['id']) === creditId)
            if (!freshCredit || !isResetCreditAvailable(freshCredit, accountModule.isCodexResetCreditAvailable)) {
                throw new Error('That banked reset is no longer available. Nothing was used.')
            }

            const rawRedemption = asRecord(await accountModule.redeemCodexResetCredit(creditId))
            const freshCreditSnapshot = normalizeResetCredit(freshCredit, accountModule.isCodexResetCreditAvailable)
            const redemptionCredit = normalizeResetCredit(rawRedemption?.['credit'], accountModule.isCodexResetCreditAvailable)
                || (freshCreditSnapshot ? { ...freshCreditSnapshot, status: 'redeemed', available: false } : null)
            const redemption: AssistantRateLimitResetRedemption = {
                code: asString(rawRedemption?.['code']),
                windowsReset: finiteNumber(rawRedemption?.['windowsReset'] ?? rawRedemption?.['windows_reset']),
                redeemedAt: normalizeIsoTimestamp(rawRedemption?.['redeemedAt'] ?? rawRedemption?.['redeemed_at']),
                credit: redemptionCredit
            }

            // Do not let an account refresh failure turn a successfully spent reset into a false failure.
            this.overviewPromise = null
            try {
                return {
                    redemption,
                    overview: await this.getOverview(),
                    refreshError: null
                }
            } catch (error) {
                return {
                    redemption,
                    overview: null,
                    refreshError: errorMessage(error, 'The reset was used, but account data could not be refreshed.')
                }
            }
        } finally {
            this.redemptionInFlight = false
        }
    }

    private async loadOverview(): Promise<AssistantAccountOverview> {
        const accountModule = await this.loadAccountModule()
        const accountStatus = await accountModule.buildChatGptAccountStatus(CHATGPT_ACCOUNT_PROVIDER)
        const configured = asRecord(asRecord(accountStatus)?.['status'])?.['configured'] === true
        let resetCredits: unknown = null
        let resetCreditsError: string | null = null

        if (configured) {
            try {
                resetCredits = await accountModule.fetchCodexResetCredits()
            } catch (error) {
                resetCreditsError = errorMessage(error, 'Banked resets could not be loaded.')
            }
        }

        return buildAssistantAccountOverviewFromZyra({
            accountStatus,
            resetCredits,
            resetCreditsError,
            isResetCreditAvailable: accountModule.isCodexResetCreditAvailable
        })
    }
}

export function buildAssistantAccountOverviewFromZyra(input: {
    accountStatus: unknown
    resetCredits?: unknown
    resetCreditsError?: string | null
    isResetCreditAvailable?: (credit: unknown) => boolean
    now?: number
}): AssistantAccountOverview {
    const now = Number.isFinite(input.now) ? Number(input.now) : Date.now()
    const accountStatus = asRecord(input.accountStatus)
    const status = asRecord(accountStatus?.['status'])
    const usage = asRecord(accountStatus?.['usage'])
    const configured = status?.['configured'] === true
    const provider = asString(accountStatus?.['provider']) || (configured ? CHATGPT_ACCOUNT_PROVIDER : null)
    const email = asString(accountStatus?.['email']) || asString(usage?.['account'])
    const planType = normalizePlanType(accountStatus?.['plan'] ?? usage?.['plan'])
    const windows = normalizeUsageWindows(usage)
    const rateLimitsByLimitId = buildRateLimitMap(windows, planType)
    const baseWindows = windows.filter((entry) => !entry.scope)
    const fallbackWindows = baseWindows.length > 0 ? baseWindows : windows
    const rateLimits: AssistantRateLimitSnapshot | null = fallbackWindows.length > 0
        ? {
            limitId: 'codex',
            limitName: 'Codex',
            primary: fallbackWindows[0]?.window || null,
            secondary: fallbackWindows[1]?.window || null,
            credits: null,
            planType
        }
        : null

    const resetPayload = asRecord(input.resetCredits)
    const resetCreditValues = resetPayload?.['credits']
    const resetCredits = (Array.isArray(resetCreditValues) ? resetCreditValues : [])
        .map((credit) => normalizeResetCredit(credit, input.isResetCreditAvailable, now))
        .filter((credit): credit is AssistantRateLimitResetCredit => Boolean(credit))
    const reportedResetCount = finiteNumber(resetPayload?.['availableCount'] ?? resetPayload?.['available_count'])
        ?? finiteNumber(usage?.['availableResetCount'] ?? asRecord(usage?.['rate_limit_reset_credits'])?.['available_count'])
    const availableResetCount = configured
        ? Math.max(0, Math.floor(reportedResetCount ?? resetCredits.filter((credit) => credit.available).length))
        : null

    return {
        provider,
        source: asString(usage?.['source']) || asString(status?.['label']) || asString(status?.['source']),
        account: configured
            ? {
                type: 'chatgpt',
                email,
                planType
            }
            : null,
        accountId: configured ? asString(accountStatus?.['accountId']) : null,
        emailVerified: typeof accountStatus?.['emailVerified'] === 'boolean'
            ? accountStatus['emailVerified']
            : null,
        tokenExpiresAt: normalizeIsoTimestamp(accountStatus?.['tokenExpiresAt']),
        authMode: configured ? 'chatgpt' : null,
        requiresOpenaiAuth: !configured,
        rateLimits,
        rateLimitsByLimitId,
        usageError: asString(accountStatus?.['usageError']),
        availableResetCount,
        resetCredits,
        resetCreditsError: input.resetCreditsError || null,
        fetchedAt: normalizeIsoTimestamp(accountStatus?.['updatedAt'])
            || normalizeIsoTimestamp(usage?.['updatedAt'])
            || new Date(now).toISOString()
    }
}

function normalizeUsageWindows(usage: JsonRecord | null): NormalizedUsageWindow[] {
    if (!usage) return []
    const values: Array<{ value: unknown; id: string; scope?: string | null; label?: string | null }> = []
    const canonical = Array.isArray(usage['limitWindows']) ? usage['limitWindows'] : []

    canonical.forEach((value, index) => {
        const record = asRecord(value)
        values.push({
            value,
            id: asString(record?.['id']) || `limit:${index}`,
            scope: asString(record?.['scope']),
            label: asString(record?.['label'])
        })
    })

    if (values.length === 0) {
        const pushLegacy = (value: unknown, id: string, scope?: string | null, label?: string | null) => {
            if (asRecord(value)) values.push({ value, id, scope, label })
        }
        pushLegacy(usage['primary'], 'legacy:primary', null, 'Primary')
        pushLegacy(usage['secondary'], 'legacy:secondary', null, 'Secondary')
        const additional = Array.isArray(usage['additional']) ? usage['additional'] : []
        additional.forEach((item, index) => {
            const record = asRecord(item)
            const scope = asString(record?.['name']) || `Additional ${index + 1}`
            const nestedWindowValues = record?.['windows']
            const nestedWindows = Array.isArray(nestedWindowValues) ? nestedWindowValues : []
            if (nestedWindows.length > 0) {
                nestedWindows.forEach((window, windowIndex) => pushLegacy(window, `legacy:additional:${index}:${windowIndex}`, scope))
            } else {
                pushLegacy(record?.['primary'], `legacy:additional:${index}:primary`, scope, 'Primary')
                pushLegacy(record?.['secondary'], `legacy:additional:${index}:secondary`, scope, 'Secondary')
            }
        })
        const codeReviewWindows = Array.isArray(usage['codeReviewWindows']) ? usage['codeReviewWindows'] : []
        if (codeReviewWindows.length > 0) {
            codeReviewWindows.forEach((window, index) => pushLegacy(window, `legacy:code-review:${index}`, 'Code review'))
        } else {
            pushLegacy(usage['codeReview'], 'legacy:code-review', 'Code review')
        }
    }

    const seen = new Set<string>()
    return values.flatMap((entry, index) => {
        const record = asRecord(entry.value)
        if (!record) return []
        const usedPercent = clampPercent(finiteNumber(record['usedPercent'] ?? record['used_percent']) ?? 0)
        const windowSeconds = finiteNumber(record['windowSeconds'] ?? record['window_seconds'] ?? record['limit_window_seconds'])
        const resetAt = normalizeEpochMilliseconds(record['resetAt'] ?? record['reset_at'])
        const idBase = entry.id || `limit:${index}`
        let id = idBase
        let suffix = 2
        while (seen.has(id)) id = `${idBase}:${suffix++}`
        seen.add(id)
        return [{
            id,
            scope: entry.scope || null,
            label: entry.label || null,
            window: {
                usedPercent,
                remainingPercent: clampPercent(100 - usedPercent),
                windowDurationMins: windowSeconds && windowSeconds > 0 ? windowSeconds / 60 : null,
                resetsAt: resetAt
            }
        }]
    })
}

function buildRateLimitMap(
    windows: NormalizedUsageWindow[],
    planType: AssistantAccountPlanType | null
): Record<string, AssistantRateLimitSnapshot> {
    return windows.reduce<Record<string, AssistantRateLimitSnapshot>>((result, entry) => {
        const positionalLabel = /^(primary|secondary)(?:\s+window)?$/i.test(entry.label || '')
        result[entry.id] = {
            limitId: entry.id,
            limitName: entry.scope || (!positionalLabel ? entry.label : null) || 'Codex',
            primary: entry.window,
            secondary: null,
            credits: null,
            planType
        }
        return result
    }, {})
}

function normalizeResetCredit(
    value: unknown,
    availability?: (credit: unknown) => boolean,
    now = Date.now()
): AssistantRateLimitResetCredit | null {
    const record = asRecord(value)
    const id = asString(record?.['id'])
    if (!record || !id) return null
    const expiresAt = normalizeIsoTimestamp(record['expiresAt'] ?? record['expires_at'])
    let available: boolean
    try {
        available = availability ? availability(value) : isResetCreditAvailable(value, undefined, now)
    } catch {
        available = isResetCreditAvailable(value, undefined, now)
    }
    return {
        id,
        title: asString(record['title']) || 'Codex rate-limit reset',
        status: (asString(record['status']) || 'unknown').toLowerCase(),
        available,
        resetType: asString(record['resetType'] ?? record['reset_type']),
        grantedAt: normalizeIsoTimestamp(record['grantedAt'] ?? record['granted_at']),
        expiresAt,
        description: asString(record['description'])
    }
}

function isResetCreditAvailable(
    value: unknown,
    availability?: (credit: unknown) => boolean,
    now = Date.now()
): boolean {
    if (availability) {
        try {
            return availability(value)
        } catch {
            // Fall through to the shared status/expiry rule.
        }
    }
    const record = asRecord(value)
    if ((asString(record?.['status']) || '').toLowerCase() !== 'available') return false
    const expiresAt = normalizeIsoTimestamp(record?.['expiresAt'] ?? record?.['expires_at'])
    return !expiresAt || new Date(expiresAt).getTime() > now
}

function normalizeResetCreditId(value: unknown): string {
    const creditId = asString(value)
    if (!creditId || creditId.length > MAX_RESET_CREDIT_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(creditId)) {
        throw new Error('The selected banked reset is invalid.')
    }
    return creditId
}

function normalizePlanType(value: unknown): AssistantAccountPlanType | null {
    const normalized = String(value || '').trim().toLowerCase().replace(/^chatgpt[-_\s]*/, '')
    if (normalized === 'free'
        || normalized === 'go'
        || normalized === 'plus'
        || normalized === 'pro'
        || normalized === 'team'
        || normalized === 'business'
        || normalized === 'enterprise'
        || normalized === 'edu') {
        return normalized
    }
    return normalized ? 'unknown' : null
}

function normalizeEpochMilliseconds(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null
    const numeric = finiteNumber(value)
    if (numeric !== null && (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value)))) {
        return numeric > 10_000_000_000 ? numeric : numeric * 1000
    }
    const parsed = new Date(String(value)).getTime()
    if (!Number.isFinite(parsed)) return null
    return parsed
}

function normalizeIsoTimestamp(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null
    const numeric = finiteNumber(value)
    const date = numeric !== null && (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value)))
        ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
        : new Date(String(value))
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function finiteNumber(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
}

function clampPercent(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.min(100, value))
}

function asRecord(value: unknown): JsonRecord | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : null
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.trim() ? error.message : fallback
}
