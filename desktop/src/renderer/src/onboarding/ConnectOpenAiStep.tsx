import { useEffect, useState } from 'react'
import { Check, KeyRound, RefreshCw } from 'lucide-react'
import type { OnboardingAuthStatus } from '@shared/onboarding/contracts'
import { OpenAiLogo } from '@/components/ui/OpenAiLogo'
import { ZyraLogoASCII } from '@/components/ui/ZyraLogo'
import { cn } from '@/lib/utils'

const buttonClass = 'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full px-5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]'

export function ConnectOpenAiStep({ status, loading, activity, error, onRefresh, onConnectChatGpt, onConnectApiKey }: {
    status: OnboardingAuthStatus | null
    loading: boolean
    activity: 'checking' | 'chatgpt' | 'api-key' | null
    error: string | null
    onRefresh: () => Promise<void>
    onConnectChatGpt: () => Promise<void>
    onConnectApiKey: (apiKey: string) => Promise<void>
}) {
    const [apiKey, setApiKey] = useState('')
    const [showApiKey, setShowApiKey] = useState(false)
    const [apiKeyOpen, setApiKeyOpen] = useState(false)
    const connected = status?.verified === true
    const chatGptConnected = connected && status?.method === 'chatgpt'
    const apiKeyConnected = connected && status?.method === 'api-key'

    useEffect(() => {
        if (!apiKeyConnected) return
        setApiKey('')
        setShowApiKey(false)
        setApiKeyOpen(false)
    }, [apiKeyConnected])

    const statusCopy = activity === 'checking' ? 'Checking your connection…'
        : activity === 'chatgpt' ? 'Finish signing in in your browser…'
            : activity === 'api-key' ? 'Verifying your API key…'
                : error || (connected ? 'Connected. You can continue.' : status?.detail)

    return (
        <div className="mx-auto w-full max-w-[360px] text-center" data-onboarding-sign-in>
            <div role="img" aria-label="Zyra" className="mb-6 flex justify-center">
                <ZyraLogoASCII size="md" variant="loading" />
            </div>
            <h1 id="onboarding-step-title" className="text-[28px] font-medium tracking-[-0.035em] text-sparkle-text">Connect Zyra</h1>
            <p className="mx-auto mt-3 max-w-[340px] text-[13px] leading-[1.7] text-sparkle-text-secondary">
                Zyra uses OpenAI models to answer questions and carry out tasks. Connect ChatGPT or use an API key to get started.
            </p>

            <div className="mt-8 flex flex-col gap-3">
                <button type="button" disabled={loading} onClick={() => void onConnectChatGpt()} className={cn(buttonClass, 'bg-[var(--color-text)] text-[var(--color-bg)] hover:bg-[color-mix(in_srgb,var(--color-text)_88%,var(--color-bg))]')}>
                    {chatGptConnected ? <Check size={16} /> : <OpenAiLogo className="size-[17px]" />}
                    {chatGptConnected ? 'ChatGPT connected' : 'Continue with ChatGPT'}
                </button>
                <button type="button" disabled={loading} onClick={() => setApiKeyOpen(value => !value)} aria-expanded={apiKeyOpen} aria-controls="onboarding-api-key-form" className={cn(buttonClass, 'border border-[var(--surface-border)] text-sparkle-text hover:bg-[var(--surface-hover)]')}>
                    {apiKeyConnected ? <Check size={16} /> : <KeyRound size={15} />}
                    {apiKeyConnected ? 'API key connected' : 'Use an API key'}
                </button>
            </div>

            <div id="onboarding-api-key-form" inert={!apiKeyOpen} aria-hidden={!apiKeyOpen} className={cn('grid text-left transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none', apiKeyOpen ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0')}>
                <div className="min-h-0 overflow-hidden">
                    <form className="pt-5" onSubmit={event => { event.preventDefault(); if (!loading && apiKey.trim()) void onConnectApiKey(apiKey) }}>
                        <label htmlFor="onboarding-api-key" className="text-[12px] font-medium text-sparkle-text-secondary">OpenAI API key</label>
                        <div className="mt-2 flex items-center overflow-hidden rounded-lg border border-[var(--surface-border)] bg-[var(--color-bg)] focus-within:border-[var(--accent-primary)]">
                            <input id="onboarding-api-key" type={showApiKey ? 'text' : 'password'} value={apiKey} disabled={loading} autoComplete="off" spellCheck={false} placeholder="sk-…" onChange={event => setApiKey(event.target.value)} className="h-11 min-w-0 flex-1 bg-transparent px-3 text-[13px] text-sparkle-text outline-none placeholder:text-sparkle-text-muted" />
                            <button type="button" onClick={() => setShowApiKey(value => !value)} aria-label={showApiKey ? 'Hide API key' : 'Show API key'} className="mr-1 rounded-md px-2 py-2 text-[11px] text-sparkle-text-secondary hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]">{showApiKey ? 'Hide' : 'Show'}</button>
                        </div>
                        <button type="submit" disabled={loading || !apiKey.trim()} className={cn(buttonClass, 'mt-3 h-10 bg-[var(--accent-primary)] text-[var(--accent-on-primary)] hover:opacity-90')}>Connect API key</button>
                    </form>
                </div>
            </div>

            <div className="mt-4 flex min-h-6 items-center justify-center gap-2 text-[11px] leading-5" role={error ? 'alert' : 'status'} aria-live="polite">
                {loading ? <RefreshCw size={12} className="shrink-0 animate-spin motion-reduce:animate-none" /> : null}
                <span className={error ? 'text-[var(--status-danger)]' : connected ? 'text-[var(--status-success)]' : 'text-sparkle-text-muted'}>{statusCopy}</span>
                {!loading && !connected && statusCopy ? <button type="button" onClick={() => void onRefresh()} className="shrink-0 text-sparkle-text-secondary underline underline-offset-2 hover:text-sparkle-text">Check again</button> : null}
            </div>
        </div>
    )
}
