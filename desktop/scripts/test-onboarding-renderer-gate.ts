import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OnboardingSnapshot } from '../src/shared/onboarding/contracts'
import { resolveOnboardingGateMode } from '../src/renderer/src/onboarding/onboarding-gate-policy'
import { resolveAppLoadingRoute } from '../src/renderer/src/components/ui/app-loading-route'

const requiredSnapshot: OnboardingSnapshot = {
    hydrated: true,
    accessAllowed: false,
    showOnboarding: true,
    blockedReason: null,
    detectedSchemaVersion: null,
    recovery: null,
    record: null
}
const completedSnapshot: OnboardingSnapshot = {
    ...requiredSnapshot,
    accessAllowed: true,
    showOnboarding: false
}
const reviewSnapshot: OnboardingSnapshot = {
    ...completedSnapshot,
    showOnboarding: true
}

assert.equal(resolveOnboardingGateMode({ desktop: true, preferencesHydrated: false, preferencesError: null, onboardingLoading: false, onboardingError: null, snapshot: completedSnapshot }), 'desktop-loading')
assert.equal(resolveOnboardingGateMode({ desktop: true, preferencesHydrated: true, preferencesError: null, onboardingLoading: false, onboardingError: null, snapshot: requiredSnapshot }), 'desktop-onboarding')
assert.equal(resolveOnboardingGateMode({ desktop: false, preferencesHydrated: true, preferencesError: null, onboardingLoading: false, onboardingError: null, snapshot: requiredSnapshot }), 'browser-required')
assert.equal(resolveOnboardingGateMode({ desktop: false, preferencesHydrated: true, preferencesError: null, onboardingLoading: false, onboardingError: null, snapshot: reviewSnapshot }), 'normal', 'review mode preserves completed browser access')
assert.equal(resolveOnboardingGateMode({ desktop: true, preferencesHydrated: true, preferencesError: null, onboardingLoading: false, onboardingError: null, snapshot: completedSnapshot }), 'normal')
assert.equal(resolveOnboardingGateMode({ desktop: false, preferencesHydrated: true, preferencesError: null, onboardingLoading: false, onboardingError: null, snapshot: completedSnapshot }), 'normal')
assert.equal(resolveOnboardingGateMode({ desktop: true, preferencesHydrated: true, preferencesError: 'newer schema', onboardingLoading: false, onboardingError: null, snapshot: completedSnapshot }), 'desktop-error')
assert.equal(resolveOnboardingGateMode({ desktop: true, preferencesHydrated: true, preferencesError: null, onboardingLoading: false, onboardingError: null, snapshot: { ...requiredSnapshot, blockedReason: 'future-schema', detectedSchemaVersion: 9 } }), 'desktop-future-schema')
assert.equal(resolveAppLoadingRoute('#/assistant/chat/abc'), 'assistant')
assert.equal(resolveAppLoadingRoute('#/assistant/instructor'), 'voice')
assert.equal(resolveAppLoadingRoute('#/settings/browser-control'), 'settings')
assert.equal(resolveAppLoadingRoute('#/explorer/C%3A%5Ccode'), 'assistant', 'retired Explorer links use the Assistant loading shell')
assert.equal(resolveAppLoadingRoute('#/assistant-utility/files'), 'assistant-utility')
assert.equal(resolveAppLoadingRoute('#/browser-popup/window'), 'browser-popup')

const here = dirname(fileURLToPath(import.meta.url))
const appSource = readFileSync(resolve(here, '../src/renderer/src/App.tsx'), 'utf8')
const appRouteSkeletonSource = readFileSync(resolve(here, '../src/renderer/src/components/ui/AppRouteSkeleton.tsx'), 'utf8')
const gateSource = readFileSync(resolve(here, '../src/renderer/src/onboarding/OnboardingGate.tsx'), 'utf8')
const flowSource = readFileSync(resolve(here, '../src/renderer/src/onboarding/OnboardingFlow.tsx'), 'utf8')
const stepsSource = readFileSync(resolve(here, '../src/renderer/src/onboarding/OnboardingSteps.tsx'), 'utf8')
const backgroundSource = readFileSync(resolve(here, '../src/renderer/src/onboarding/OnboardingBackground.tsx'), 'utf8')
const cloudFieldSource = readFileSync(resolve(here, '../src/renderer/src/components/ui/CloudField.tsx'), 'utf8')
const motionSource = readFileSync(resolve(here, '../src/renderer/src/onboarding/OnboardingFlow.css'), 'utf8')
const openAiLogoSource = readFileSync(resolve(here, '../src/renderer/src/components/ui/OpenAiLogo.tsx'), 'utf8')
const themeSelectSource = readFileSync(resolve(here, '../src/renderer/src/pages/settings/appearance/AppearanceThemeSelect.tsx'), 'utf8')
const browserSource = readFileSync(resolve(here, '../src/renderer/src/onboarding/BrowserSetupRequired.tsx'), 'utf8')
const mainSource = readFileSync(resolve(here, '../src/main/index.ts'), 'utf8')

assert.match(appSource, /<SettingsProvider>[\s\S]*<OnboardingProvider>[\s\S]*<OnboardingGate[^>]*>[\s\S]*<NormalDesktopApp/)
assert.doesNotMatch(appSource.split('function NormalDesktopApp')[1]?.split('function App')[0] || '', /OnboardingFlow/, 'normal routes must only mount behind the gate')
assert.match(gateSource, /resolveOnboardingGateMode/, 'gate rendering must use the main-owned completion policy')
assert.doesNotMatch(gateSource, /Preparing setup/, 'hydration must use the destination route skeleton instead of flashing setup UI')
assert.match(appSource, /<OnboardingGate loadingFallback=\{<AppBootSkeleton \/>\}>/, 'the setup gate must preserve the destination-shaped app shell while state hydrates')
assert.match(appSource, /function PageLoader\(\)[\s\S]*<AppRouteSkeleton pathname=\{location\.pathname\}/, 'lazy top-level routes must use a destination-shaped skeleton')
assert.match(appRouteSkeletonSource, /data-app-route-skeleton="settings"/, 'settings loading keeps its navigation and content geometry')
assert.doesNotMatch(appRouteSkeletonSource, /data-app-route-skeleton="explorer"|ExplorerRouteSkeleton/, 'the retired Explorer has no loading surface')
assert.match(appRouteSkeletonSource, /data-app-route-skeleton="voice"/, 'Voice loading keeps its stage and composer geometry')
assert.match(appRouteSkeletonSource, /data-app-route-skeleton="assistant-utility"/, 'utility windows have a workspace-shaped loading shell')
assert.match(appRouteSkeletonSource, /data-app-route-skeleton="browser-popup"/, 'browser popup windows have a browser-shaped loading shell')
assert.match(browserSource, /Finish setup in Zyra Desktop/)
assert.match(browserSource, /browser will unlock as soon as Desktop setup is complete/)
assert.doesNotMatch(flowSource, /Escape|onMouseDown|backdrop/, 'mandatory onboarding must not expose Escape or backdrop bypasses')
assert.doesNotMatch(flowSource, /<aside|Progress saves after each step/, 'centered onboarding must not restore the old sidebar or helper copy')
assert.match(flowSource, /Setup step \$\{currentIndex \+ 1\} of \$\{ONBOARDING_STEPS\.length\}/, 'compact progress must describe the current numbered step')
assert.match(flowSource, /onboarding-fixed-heading/, 'non-welcome step titles must use the stable upper viewport anchor')
assert.match(flowSource, /onboarding-action-dock/, 'Back and Continue must share a stable viewport dock')
assert.match(flowSource, /onboarding-dock-progress/, 'numbered progress must stay centered between the fixed actions')
assert.match(flowSource, /onboarding\.updateAppearance\(\{[\s\S]*selection: nextAppearance/, 'appearance choices must save immediately through the constrained setup API')
assert.doesNotMatch(flowSource, /previewAppearance|clearAppearancePreview/, 'saved setup themes must not fall back to a renderer-only preview')
assert.doesNotMatch(flowSource, /web-access|WebAccessStep/, 'web defaults must not add setup friction')
assert.match(flowSource, /stepScrollRef\.current\.scrollTop = 0/, 'each fixed-title step must open at the top of its own scroll region')
assert.match(motionSource, /\.onboarding-fixed-heading\s*\{[\s\S]*?position: fixed;/)
assert.match(motionSource, /\.onboarding-action-dock\s*\{[\s\S]*?position: fixed;/)
assert.match(motionSource, /\.onboarding-step-content\s*\{[\s\S]*?padding-top: 4px;/, 'hover motion needs headroom inside the clipped step scroller')
assert.doesNotMatch(flowSource, /document\.startViewTransition/, 'step animations must not snapshot the WebGL background or delay persistence')
assert.match(motionSource, /translate3d/, 'step changes must stay on lightweight compositor transforms')
assert.match(motionSource, /prefers-reduced-motion/)
assert.match(stepsSource, /Welcome to/)
assert.match(stepsSource, /Start setup/)
assert.match(stepsSource, /Continue with ChatGPT/)
assert.match(stepsSource, /<OpenAiLogo/, 'the primary ChatGPT action must use the theme-aware OpenAI mark')
assert.match(openAiLogoSource, /fill="currentColor"/, 'the OpenAI mark must follow the active Zyra theme')
assert.match(stepsSource, /role="separator" aria-label="Alternative OpenAI connection"[\s\S]*<span>or<\/span>/, 'ChatGPT and API-key flows need a visible or divider')
assert.match(stepsSource, /Use an API key instead/)
assert.match(stepsSource, /onboarding-review-ready[\s\S]*onboarding-review-grid/, 'the final review must provide an inviting, scannable setup summary')
assert.match(flowSource, /getDesktopAnalyticsStatus\(\)/, 'the review step must resume a saved analytics decision from main-owned state')
assert.match(flowSource, /setDesktopAnalyticsEnabled\(enabled\)/, 'analytics consent must persist through the constrained main-owned API')
assert.match(flowSource, /analyticsChoice === null[\s\S]{0,180}analyticsPreferenceSaved = await setAnalyticsChoice\(false\)[\s\S]{0,180}if \(!analyticsPreferenceSaved\) throw/, 'finishing setup with the final toggle untouched must persist analytics off before committing review')
const welcomeStepSource = stepsSource.split('export function WelcomeStep')[1]?.split('export function ConnectOpenAiStep')[0] || ''
const reviewStepSource = stepsSource.split('export function ReviewStep')[1]?.split('export function createAppearanceSelection')[0] || ''
assert.doesNotMatch(welcomeStepSource, /OnboardingAnalyticsChoice|analyticsChoice|diagnostics/, 'the first setup page must not show or gate on diagnostics')
assert.match(reviewStepSource, /<OnboardingAnalyticsChoice/, 'the diagnostics preference must appear only on the final review step')
assert.match(stepsSource, /<SettingsSwitch[\s\S]{0,220}label="Share product usage and diagnostics"/, 'the final diagnostics choice must be one proper toggle with accurate consent language')
assert.match(stepsSource, /aria-label="About product usage and diagnostics"[\s\S]{0,1200}role=\{analyticsError \? 'alert' : 'tooltip'\}/, 'the privacy detail must live behind an accessible information affordance')
assert.doesNotMatch(stepsSource, /anonymous diagnostics|anonymous events/, 'stable installation telemetry must not be described as anonymous')
assert.doesNotMatch(stepsSource, /min-h-\[62px\][^\n]*border-y|role="radiogroup" aria-label="Product analytics preference"/, 'the final diagnostics choice must not use the former divided radio-card treatment')
assert.match(stepsSource, /allowlisted diagnostic codes[\s\S]{0,180}stable random installation ID[\s\S]{0,100}across sessions[\s\S]{0,220}local queue after 7 days/, 'the information popover must disclose transmitted diagnostics, persistent pseudonymous identity, and local retention')
assert.match(stepsSource, /Never prompts, responses, transcripts, files, paths, URLs, account identity, or terminal content/, 'the information popover must preserve the sensitive-data boundary')
assert.match(motionSource, /\.onboarding-review-grid\s*\{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
assert.match(stepsSource, /AppearanceThemeSelector[\s\S]*appearance=\{activeAppearance\}/, 'setup must show one catalog selector for the currently resolved appearance')
assert.match(stepsSource, /createAppearanceSelection[\s\S]{0,420}appearanceThemeMode: settings\.appearanceThemeMode/, 'the main-owned saved appearance must win when setup resumes')
assert.match(themeSelectSource, /LIGHT_THEMES[\s\S]*DARK_THEMES/, 'the shared selector must keep light and dark catalogs separate')
assert.match(themeSelectSource, /role="listbox"[\s\S]*role="option"/, 'theme dropdowns must expose accessible listbox semantics')
assert.match(themeSelectSource, /PALETTE_ROLES\.map/, 'every dropdown row must render the complete Zyra theme token palette')
assert.match(themeSelectSource, /createPortal\(popover, document\.body\)/, 'theme menus must escape clipped onboarding and Settings scroll regions')
assert.match(themeSelectSource, /option\.offsetTop/, 'opening a theme menu must center its active theme rather than start at the first row')
assert.match(themeSelectSource, /MAX_LIST_HEIGHT = 168/, 'theme menus must use the shortened frame')
assert.match(backgroundSource, /<CloudField[\s\S]*backgroundColor=\{palette\.background\}[\s\S]*accentColor=\{palette\.accent\}[\s\S]*inkColor=\{palette\.ink\}/, 'onboarding Cloud Field follows the resolved Zyra theme palette')
assert.match(backgroundSource, /maxFps=\{24\}/)
assert.match(backgroundSource, /reducedMotion=\{settings\.accessibilityReduceMotion\}/, 'onboarding background honors the saved motion preference')
assert.match(cloudFieldSource, /threeui\.com\/backgrounds\/portal-field\/cloud-field/, 'the retrieved Cloud Field source remains attributable at its local implementation boundary')
assert.match(cloudFieldSource, /document\.hidden[\s\S]*frameInterval/, 'the ambient WebGL field is visibility-aware and frame-capped')
assert.match(cloudFieldSource, /u_background[\s\S]*u_accent[\s\S]*u_ink/, 'the raw shader uses semantic Zyra theme colors instead of a fixed violet palette')
assert.match(mainSource, /const launchHidden = launchAsBackgroundHost \|\| \(setupComplete && initialShellLaunchTarget\?\.kind === 'file'\)/, 'shell file launches and explicit background hosting must not hide mandatory setup')
assert.match(mainSource, /pendingShellLaunchTargets\.push\(initialShellLaunchTarget\)/, 'pending launch intent must be retained')
assert.match(mainSource, /app\.on\('open-file'/, 'macOS Finder launches must enter the onboarding-aware shell target queue')
assert.match(mainSource, /getAssistantService: \(\) => setupServices\.onboarding\.isAccessAllowed\(\) \? getAssistantService\(\) : null/, 'browser runtime must defer Assistant construction until setup completes')
assert.match(mainSource, /configureApplicationMenu\(setupServices\.onboarding\.isAccessAllowed\(\)\)/, 'native menus must use setup-aware platform policy')
assert.match(mainSource, /if \(!setupComplete\)[\s\S]*\{ role: 'editMenu' \}[\s\S]*\{ role: 'windowMenu' \}/, 'macOS setup keeps only safe native editing/window affordances')
assert.match(mainSource, /setupServices\.onboarding\.subscribe\([\s\S]*configureApplicationMenu\(snapshot\.accessAllowed\)/, 'completing setup must restore the normal platform menu')

console.log('onboarding renderer gate: ok')
