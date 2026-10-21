import { useState } from 'react'
import { useSettings } from '@/lib/settings'
import { SettingsButton, SettingsDialog, SettingsRow, SettingsSection, SettingsSegmented, SettingsSwitch, SettingsTextarea } from './settings-layout'

export function ChatDefaultsSettings() {
    const { settings, updateSettings } = useSettings()
    const [promptTemplateOpen, setPromptTemplateOpen] = useState(false)
    const [promptTemplateDraft, setPromptTemplateDraft] = useState(settings.assistantDefaultPromptTemplate)
    return <>
        <SettingsSection title="New chat setup" searchSection="Assistant defaults">
            <SettingsRow title="Composer choices" description="New chats remember the model, effort and permission mode you last chose in the composer. Existing chats keep their own choices." />
            <SettingsRow title="Fast service tier" description="Request priority processing for new chats." info="Only supported providers can honor the priority tier." control={<SettingsSwitch checked={settings.assistantDefaultFastMode} onCheckedChange={assistantDefaultFastMode => updateSettings({ assistantDefaultFastMode })} label="Fast service tier" />} />
            <SettingsRow title="Default prompt" description="Prefill the composer when you start a new chat." info="The draft is not sent until you submit it." status={settings.assistantDefaultPromptTemplate.trim() ? 'Custom prompt saved' : 'No default prompt'} control={<SettingsButton onClick={() => { setPromptTemplateDraft(settings.assistantDefaultPromptTemplate); setPromptTemplateOpen(true) }}>Edit prompt</SettingsButton>} />
            <SettingsRow title="Busy send behavior" description="Steer updates the current task without stopping it. Send next waits for the turn to finish." control={<SettingsSegmented value={settings.assistantBusyMessageMode} options={[{ value: 'queue', label: 'Send next' }, { value: 'steer', label: 'Steer' }]} onChange={assistantBusyMessageMode => updateSettings({ assistantBusyMessageMode })} label="Busy send behavior" />} />
        </SettingsSection>
        <SettingsDialog open={promptTemplateOpen} title="Edit default prompt" description="This text is placed into the composer when a new chat starts." onClose={() => setPromptTemplateOpen(false)} footer={<>
            <SettingsButton variant="ghost" onClick={() => setPromptTemplateOpen(false)}>Cancel</SettingsButton>
            <SettingsButton variant="accent" onClick={() => { void updateSettings({ assistantDefaultPromptTemplate: promptTemplateDraft }); setPromptTemplateOpen(false) }}>Save prompt</SettingsButton>
        </>}>
            <SettingsTextarea autoFocus value={promptTemplateDraft} maxLength={32000} rows={10} onChange={event => setPromptTemplateDraft(event.target.value)} placeholder="Optional instructions for new chats" aria-label="Default assistant prompt template" />
            <div className="text-right text-[10px] tabular-nums text-[var(--settings-text-muted)]">{promptTemplateDraft.length.toLocaleString()} / 32,000</div>
        </SettingsDialog>
    </>
}
