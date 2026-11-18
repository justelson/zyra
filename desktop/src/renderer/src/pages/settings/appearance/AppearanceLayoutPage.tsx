import { DEFAULT_APPEARANCE_ANIMATION_SCALE, type AppearanceAnimationSpeed } from '@/lib/settings'
import { ChatWallpaperSettings } from './ChatWallpaperSettings'
import type { AppearanceSettingsController } from './useAppearanceSettingsController'
import { SettingResetButton, SettingsRow, SettingsSection, SettingsSegmented, SettingsSlider, SettingsSwitch } from '../settings-layout'

export function AppearanceLayoutPage({ controller }: { controller: AppearanceSettingsController }) {
    const { settings } = controller

    return (
        <>
            <SettingsSection title="Preferences">
                <SettingsRow
                    title="Interface density"
                    description="Choose comfortable spacing or fit more information on screen."
                    control={(
                        <SettingsSegmented
                            value={settings.compactMode ? 'compact' : 'comfortable'}
                            options={[
                                { value: 'comfortable', label: 'Comfortable' },
                                { value: 'compact', label: 'Compact' }
                            ]}
                            onChange={(value) => controller.setCompactMode(value === 'compact')}
                            label="Interface density"
                        />
                    )}
                />
                <SettingsRow
                    title="Reduce motion"
                    description="Minimize transitions, animation and smooth scrolling."
                    control={<SettingsSwitch checked={settings.accessibilityReduceMotion} onCheckedChange={controller.setReduceMotion} label="Reduce motion" />}
                />
                <SettingsRow
                    title="Motion feel"
                    description="Choose a default feel for every transition and animation. Reduce motion still overrides it."
                    control={(
                        <SettingsSegmented
                            value={settings.appearanceAnimationSpeed}
                            options={[
                                { value: 'calm' as AppearanceAnimationSpeed, label: 'Calm', hint: '0.65x' },
                                { value: 'normal' as AppearanceAnimationSpeed, label: 'Normal' },
                                { value: 'brisk' as AppearanceAnimationSpeed, label: 'Brisk', hint: '1.5x' },
                                { value: 'custom' as AppearanceAnimationSpeed, label: 'Custom' }
                            ]}
                            onChange={(value) => controller.setAnimationSpeed(value)}
                            label="Motion feel"
                        />
                    )}
                />
                {settings.appearanceAnimationSpeed === 'custom' ? (
                    <SettingsRow
                        title="Custom motion rate"
                        description="Set how quickly the interface moves, from half to double the default rate."
                        resetAction={settings.appearanceAnimationScale !== DEFAULT_APPEARANCE_ANIMATION_SCALE ? (
                            <SettingResetButton label="Custom motion rate" onClick={() => controller.setAnimationScale(DEFAULT_APPEARANCE_ANIMATION_SCALE)} />
                        ) : null}
                        control={<SettingsSlider value={settings.appearanceAnimationScale} min={50} max={200} step={5} unit="%" label="Custom motion rate" onChange={controller.setAnimationScale} />}
                    />
                ) : null}
            </SettingsSection>

            <ChatWallpaperSettings />
            <SettingsSection title="Interface">
                <SettingsRow title="Interface inspector" description="Find a named part or select it on screen." control={<button type="button" onClick={() => window.dispatchEvent(new Event('zyra:inspect-ui'))}>Inspect parts</button>} />
                <SettingsRow
                    title="Chat rail"
                    description="Keep the conversation sidebar collapsed across restarts on this surface."
                    control={<SettingsSwitch checked={settings.sidebarCollapsed} onCheckedChange={controller.setSidebarCollapsed} label="Collapse chat rail" />}
                />
                {settings.sidebarCollapsed ? (<SettingsRow
                    title="Sidebar hover preview"
                    description="Temporarily show a minimized sidebar when the pointer reaches the left edge."
                    control={<SettingsSwitch checked={settings.sidebarHoverPreviewEnabled} onCheckedChange={controller.setSidebarHoverPreviewEnabled} label="Preview minimized sidebar on hover" />}
                />) : null}
                <SettingsRow
                    title="Agent Inbox sidebar"
                    description="Keep chats in creation order with compact completed rows."
                    info="Active work uses expanded cards; turn this off to return to the standard chat list."
                    control={<SettingsSwitch checked={settings.assistantAgentInboxSidebarEnabled} onCheckedChange={controller.setAgentInboxSidebarEnabled} label="Use Agent Inbox sidebar" />}
                />
            </SettingsSection>
        </>
    )
}
