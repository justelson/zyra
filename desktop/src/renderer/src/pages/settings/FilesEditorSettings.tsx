import { useSettings } from '@/lib/settings'
import {
    SettingsInput,
    SettingsPageContainer,
    SettingsRow,
    SettingsSection,
    SettingsSegmented,
    SettingsSwitch
} from './settings-layout'

export default function FilesEditorSettings() {
    const { settings, updateSettings } = useSettings()

    return (
        <SettingsPageContainer title="Files & editor" backTo="/settings/workspace" backLabel="Workspace">
            <SettingsSection title="File preview">
                <SettingsRow title="Open fullscreen" description="Open new file previews in fullscreen mode." control={<SettingsSwitch checked={settings.filePreviewOpenInFullscreen} onCheckedChange={(filePreviewOpenInFullscreen) => updateSettings({ filePreviewOpenInFullscreen })} label="Open file previews fullscreen" />} />
                <SettingsRow title="Default mode" description="Choose the initial mode for newly opened files." control={<SettingsSegmented value={settings.filePreviewDefaultMode} options={[{ value: 'preview', label: 'Preview' }, { value: 'edit', label: 'Edit' }]} onChange={(filePreviewDefaultMode) => updateSettings({ filePreviewDefaultMode })} label="File preview mode" />} />
                <SettingsRow title="Python run target" description="Choose where the preview Play action sends Python output." control={<SettingsSegmented value={settings.filePreviewPythonRunMode} options={[{ value: 'terminal', label: 'Terminal' }, { value: 'output', label: 'Output' }]} onChange={(filePreviewPythonRunMode) => updateSettings({ filePreviewPythonRunMode })} label="Python run target" />} />
                <SettingsRow title="Fullscreen left panel" description="Keep navigation visible in fullscreen previews." control={<SettingsSwitch checked={settings.filePreviewFullscreenShowLeftPanel} onCheckedChange={(filePreviewFullscreenShowLeftPanel) => updateSettings({ filePreviewFullscreenShowLeftPanel })} label="Show fullscreen left panel" />} />
                <SettingsRow title="Fullscreen Edit Inspector" description="Open the Inspector automatically when a fullscreen file starts in Edit mode. Preview mode starts focused." control={<SettingsSwitch checked={settings.filePreviewFullscreenShowRightPanel} onCheckedChange={(filePreviewFullscreenShowRightPanel) => updateSettings({ filePreviewFullscreenShowRightPanel })} label="Show fullscreen Edit Inspector" />} />
                <SettingsRow title="Explorer file names" description="Wrap long file names or keep them on one horizontal line." control={<SettingsSegmented value={settings.filePreviewExplorerNameLayout} options={[{ value: 'wrap', label: 'Wrap' }, { value: 'horizontal', label: 'Horizontal' }]} onChange={(filePreviewExplorerNameLayout) => updateSettings({ filePreviewExplorerNameLayout })} label="Explorer file name layout" />} />
            </SettingsSection>

            <SettingsSection title="Editor defaults">
                <SettingsRow title="Word wrap" description="Wrap long lines when a new editor preview opens." control={<SettingsSegmented value={settings.fileEditorWordWrap} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} onChange={(fileEditorWordWrap) => updateSettings({ fileEditorWordWrap })} label="Editor word wrap" />} />
                <SettingsRow title="Minimap" description="Show the code overview in newly opened editor previews." control={<SettingsSwitch checked={settings.fileEditorMinimapEnabled} onCheckedChange={(fileEditorMinimapEnabled) => updateSettings({ fileEditorMinimapEnabled })} label="Editor minimap" />} />
                <SettingsRow title="Font size" description="Default editor text size, from 10 to 24 pixels." control={<SettingsInput type="number" min={10} max={24} value={settings.fileEditorFontSize} onChange={(event) => updateSettings({ fileEditorFontSize: Math.max(10, Math.min(24, Math.round(Number(event.target.value) || 13))) })} className="sm:w-24" aria-label="Editor font size" />} />
                <SettingsRow title="CSV colors" description="Use distinct column colors when a new CSV preview opens." control={<SettingsSwitch checked={settings.fileCsvDistinctColorsEnabled} onCheckedChange={(fileCsvDistinctColorsEnabled) => updateSettings({ fileCsvDistinctColorsEnabled })} label="Distinct CSV column colors" />} />
                <SettingsRow title="Diff layout" description="Set the default layout for project file diffs." control={<SettingsSegmented value={settings.fileDiffRenderMode} options={[{ value: 'stacked', label: 'Stacked' }, { value: 'split', label: 'Split' }]} onChange={(fileDiffRenderMode) => updateSettings({ fileDiffRenderMode })} label="File diff layout" />} />
            </SettingsSection>
        </SettingsPageContainer>
    )
}
