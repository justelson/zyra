import type { ReactNode } from 'react'
import { Check, ChevronDown, Globe, ListChecks, LockKeyhole, Plus, Terminal } from 'lucide-react'
import type { ThemeDefinition } from '@/lib/settings-theme-catalog'
import { AppearanceCodePreview } from '@/pages/settings/appearance/AppearancePreviews'
import { AssistantFileAttachmentCard, AssistantPastedTextCard } from '@/pages/assistant/AssistantAttachmentCards'
import { ComposerSendButton } from '@/pages/assistant/ComposerSendButton'
import './OnboardingShowcase.css'

function Specimen({ kind, children }: { kind: string; children: ReactNode }) {
    return <div className={`onboarding-specimen onboarding-specimen-${kind}`}>
        <div className="onboarding-specimen-content" inert>{children}</div>
    </div>
}

/** Read-only specimens: real attachment, send and editor-preview components. */
export function OnboardingShowcase({ theme }: { theme: ThemeDefinition }) {
    return <div className="onboarding-showcase" aria-hidden="true">
        <Specimen kind="composer">
            <div className="onboarding-specimen-surface onboarding-specimen-message">
                <p>Help me bring this idea to life</p>
                <div className="onboarding-specimen-message-tools"><Plus size={18} /><span>Auto<ChevronDown size={12} /></span>
                    <ComposerSendButton disabled={false} isConnected isThinking={false} canSend onSend={() => {}} />
                </div>
            </div>
        </Specimen>
        <Specimen kind="code">
            <AppearanceCodePreview theme={theme} accent={{ name: theme.accentColor, primary: theme.tokens.primary, secondary: theme.tokens.secondary }} compact={false} />
        </Specimen>
        <Specimen kind="files">
            <AssistantPastedTextCard widthClassName="w-[170px]" label="A fresh idea" previewText={`A little curiosity.
A new direction.
Something worth making.`} />
            <AssistantFileAttachmentCard name="design.tsx" category="code" contentType="TSX" widthClassName="w-[170px]" previewText={`export function Idea() {
  return <SomethingNew />
}`} />
        </Specimen>
        <Specimen kind="terminal">
            <div className="onboarding-specimen-surface onboarding-specimen-terminal-content">
                <span><Terminal size={14} />Terminal</span>
                <p><b>~</b> npm run dev</p>
                <p className="onboarding-terminal-ready">Ready on localhost:3000</p>
            </div>
        </Specimen>
        <Specimen kind="browser">
            <div className="onboarding-specimen-surface onboarding-specimen-browser-content">
                <span><Globe size={15} />Browser</span>
                <div><LockKeyhole size={13} /><span>localhost:3000</span></div>
            </div>
        </Specimen>
        <Specimen kind="plan">
            <div className="onboarding-specimen-surface onboarding-specimen-plan-content">
                <div className="onboarding-specimen-plan-title"><ListChecks size={16} />A little plan</div>
                {['Find a direction', 'Make it yours', 'Bring it to life'].map((label, index) => <div key={label} className="onboarding-specimen-plan-row">
                    <span className={index < 2 ? 'is-done' : ''}>{index < 2 && <Check size={12} />}</span>{label}
                </div>)}
            </div>
        </Specimen>
    </div>
}
