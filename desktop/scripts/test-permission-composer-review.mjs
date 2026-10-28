import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electron from 'electron'

const temporary = await mkdtemp(join(tmpdir(), 'zyra-permission-composer-'))
const output = resolve(import.meta.dirname, '../../docs.local/reviews/permission-composer')
await mkdir(output, { recursive: true })
const inspectCapabilities = async function () {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    const check = (value, message) => { if (!value) throw Error(message) }
    const choose = async id => {
        const select = document.querySelector('[aria-label="Proposed permission type"]')
        select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); await pause(280)
    }
    const read = () => [...document.querySelectorAll('[data-requested-capability]')].map(node => node.dataset.requestedCapability).sort()
    const expected = ['observe.structure', 'observe.screenshot', 'pointer.click', 'keyboard.type', 'keyboard.key', 'navigate', 'scroll', 'form.select', 'tab.manage']
    await choose('grant-windows-window-chat')
    const groups = document.querySelector('[aria-label="Requested capabilities"]')
    check(groups?.tagName === 'DL' && groups.children.length === 3, 'Requested permissions have three compact semantic groups')
    check(groups.querySelector('[title="Observe"] .lucide-scan-line') && !groups.querySelector('.lucide-eye'), 'Observation uses the scan-frame icon instead of an eye')
    check([...groups.querySelectorAll('dt')].map(node => node.textContent).join(',') === 'Observe,Interact,Navigate', 'Groups describe the actual access')
    check(JSON.stringify(read()) === JSON.stringify(expected.sort()), 'Grouping preserves every exact requested capability')
    check(!groups.querySelector('li svg, button, input'), 'No repeated approval ticks, chips or pretend capability toggles')
    check(document.documentElement.scrollWidth <= innerWidth, 'Capability groups never overflow the page')
    check(groups.getBoundingClientRect().height <= (innerWidth > 700 ? 20 : 62), 'Capability strip uses one desktop line and at most three narrow lines')
    check([...groups.querySelectorAll('dt span')].every(node => node.classList.contains('sr-only')), 'Group labels do not add heading rows')
    check([...groups.querySelectorAll('[data-requested-capability]')].every(node => node.getAttribute('aria-label')), 'Short visible labels retain full accessible permission names')
    const individual = [...document.querySelector('[aria-label="Proposed permission type"]').options].filter(option => option.value.startsWith('cap-'))
    check(individual.length === 12, 'All twelve individual capability cases remain available')
    for (const option of individual) {
        await choose(option.value)
        check(JSON.stringify(read()) === JSON.stringify([option.value.slice(4).replaceAll('-', '.')]), 'Single capability never implies unrequested rights: ' + option.value)
        check(document.querySelector('[aria-label="Requested capabilities"]').children.length === 1, 'Single capability omits empty groups')
    }
    await choose('grant-drag-only')
    check(JSON.stringify(read()) === JSON.stringify(['pointer.drag', 'pointer.move']), 'Dragging and moving stay separate from clicking')
    await choose('grant-view-only')
    check(JSON.stringify(read()) === JSON.stringify(['observe.screenshot', 'observe.structure']), 'View-only never implies interaction')
    await choose('grant-windows-window-child')
    check(document.querySelector('.proposal-requester').textContent.includes('Child agent'), 'Grouping preserves the requesting principal')
    check(!document.querySelector('.proposal-model') && !document.querySelector('.proposal-frame').textContent.includes('Preview model'), 'No fake model control or placeholder remains in the footer')
    for (const [id, context] of [['grant-incognito', 'Incognito Browser'], ['grant-chrome-read', 'Read-only Chrome access']]) {
        await choose(id)
        check(document.querySelector('.proposal-requester').textContent.includes(context), 'Session restrictions stay visible in the existing context line')
        check(document.querySelectorAll('.proposal-request-body .proposal-rows > div').length === 2, 'Session metadata does not add another body row')
        check(!document.querySelector('.proposal-model'), 'Grant footer contains only real decision controls')
    }
    check(!document.querySelector('[data-proposal-receipt]'), 'Reading grouped capabilities never decides a request')
    return 'PASS: compact capabilities, exact rights, no placeholder model control and inline session context'
}
const inspectFileHover = async function (captureOnly = false) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    const check = (value, message) => { if (!value) throw Error(message) }
    const choose = async id => {
        const select = document.querySelector('[aria-label="Proposed permission type"]')
        select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); await pause(280)
    }
    const opened = async () => {
        for (let i = 0; i < 200; i++) {
            const popup = document.querySelector('[data-composer-file-diff]')
            if (popup && !popup.textContent.includes('Applying syntax colors')) return popup
            await pause(50)
        }
        throw Error('Hover diff did not load: ' + JSON.stringify({ row: document.querySelector('[data-composer-file-change-row]')?.outerHTML.slice(0, 350), popovers: document.querySelectorAll('[data-anchored-menu-popover]').length, text: document.body.innerText.slice(-1800) }))
    }
    const escape = async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause(80) }
    await choose('file-change')
    check(!document.querySelector('.proposal-detail, .proposal-diff'), 'No separate diff section remains below the file')
    const row = document.querySelector('[data-composer-file-change-row]')
    check(row && row.querySelector('[data-assistant-action-diff-stats]'), 'File row owns its addition/deletion counts')
    const height = document.querySelector('.proposal-tray').getBoundingClientRect().height
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); const popup = await opened()
    const bounds = popup.getBoundingClientRect()
    check(bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight, 'Hover diff fits the viewport')
    check(innerWidth < 700 || bounds.width >= 600, 'Desktop diff preview is readable rather than tooltip-sized')
    check(document.querySelector('.proposal-tray').getBoundingClientRect().height === height, 'Hovering never expands the tray')
    if (captureOnly) return 'Ready: content-sized file hover preview'
    row.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: popup })); popup.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: row })); await pause(240)
    check(popup.isConnected, 'Moving into the diff keeps it open for selection and scrolling')
    popup.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); await pause(240)
    check(!document.querySelector('[data-composer-file-diff]'), 'Leaving both file and popup dismisses it')
    row.focus(); row.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); await opened(); await escape()
    check(!document.querySelector('[data-composer-file-diff]'), 'Escape closes without focus restoration reopening the preview')
    row.click(); await opened(); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await pause(80)
    check(!document.querySelector('[data-composer-file-diff]'), 'Touch/click opening also supports outside dismissal')
    await choose('file-multiple')
    const rows = [...document.querySelectorAll('[data-composer-file-change-row]')]
    rows[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); const firstHeight = (await opened()).getBoundingClientRect().height; await escape()
    rows[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); const shortHeight = (await opened()).getBoundingClientRect().height; await escape()
    check(shortHeight < firstHeight, 'Preview height follows the actual diff content')
    rows[2].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); const longPopup = await opened()
    const scroll = longPopup.querySelector('[tabindex="0"]')
    check(scroll.scrollHeight > scroll.clientHeight, 'Large diffs scroll inside their viewport cap')
    await escape()
    check(!document.querySelector('[data-proposal-receipt]'), 'Inspecting file changes never approves them')
    return 'PASS: per-file hover diff, content-sized height, viewport cap, hover transfer, focus/touch and Escape'
}
const inspectDensity = async function () {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    const check = (value, message) => { if (!value) throw Error(message) }
    const choose = async id => {
        const select = document.querySelector('[aria-label="Proposed permission type"]')
        select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); await pause(280)
    }
    await choose('file-read')
    check(getComputedStyle(document.querySelector('.proposal-files > div')).borderBottomWidth === '0px', 'A single file has no trailing divider')
    await choose('file-multiple')
    const files = [...document.querySelectorAll('.proposal-files > div')]
    check(files.every(row => getComputedStyle(row).borderBottomWidth === '0px') && getComputedStyle(files[1]).borderTopWidth === '1px', 'File separators appear only between rows')
    await choose('command-long')
    const script = document.querySelector('.proposal-script')
    check(script && !script.open && script.querySelector('summary').textContent.includes('5 lines'), 'Multiline command starts as an explicit compact preview')
    check(document.querySelector('.proposal-request-body').getBoundingClientRect().height <= 90, 'Long command and explanation do not expand the default tray')
    check(script.querySelector('pre').textContent.includes('npm run test:fixtures') && script.querySelector('.proposal-description').textContent.includes('This permission applies only to the requested command.'), 'No command or explanation is discarded')
    script.querySelector('summary').click(); await pause(280)
    check(script.open && script.querySelector('.proposal-script-content').getBoundingClientRect().height > 0, 'Disclosure shows the full command and explanation')
    const allow = [...document.querySelectorAll('.proposal-actions button')].find(button => button.textContent.trim() === 'Allow once')
    const bounds = allow.getBoundingClientRect()
    check(allow.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)), 'Expanded details keep the approval action reachable')
    script.querySelector('summary').click(); await pause(280)
    check(!script.open && !document.querySelector('[data-proposal-receipt]'), 'Closing details never decides the request')
    return 'PASS: no trailing file dividers, compact multiline preview and complete expandable details'
}
const inspectCompactCases = async function () {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    const check = (value, message) => { if (!value) throw Error(message) }
    const select = document.querySelector('[aria-label="Proposed permission type"]')
    const choose = async id => { select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); await pause(280) }
    const boundaries = [...select.options].filter(option => option.dataset.kind === 'external')
    check(boundaries.length === 9, 'All external boundaries are retained')
    for (const option of boundaries) {
        await choose(option.value)
        const shell = document.querySelector('[data-proposal-boundary]')
        check(shell?.classList.contains('proposal-shell') && shell.querySelector('.proposal-tray') && shell.querySelector('.proposal-frame'), 'Boundary uses the same attached composer: ' + option.value)
        check(shell.querySelectorAll('.proposal-request-body .proposal-rows > div').length === 1 && !shell.querySelector('.proposal-boundary'), 'Boundary is compact instead of an audit paragraph: ' + option.value)
        check(!shell.querySelector('.proposal-deny, .proposal-primary, input'), 'External boundary never impersonates an authorization: ' + option.value)
        const info = shell.querySelector('[aria-label="About this step"]')
        info.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await pause(50)
        check(document.querySelector('[role="tooltip"]')?.textContent.length > 40, 'Full boundary explanation remains in the tooltip')
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause(20)
        const next = shell.querySelector('.proposal-actions button'), bounds = next.getBoundingClientRect()
        check(next.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)), 'Boundary navigation is reachable')
        next.click(); await pause(40)
        check(select.value !== option.value && !document.querySelector('[data-proposal-receipt]'), 'Next changes only the preview case')
    }
    await choose('device-partial')
    const projects = document.querySelector('.proposal-projects')
    const inputs = [...projects.querySelectorAll('input')]
    check(inputs.length === 3 && inputs[0].checked && !inputs[1].checked && !inputs[2].checked, 'Project selection state stays intact')
    check(getComputedStyle(projects).flexDirection === 'row' && projects.getBoundingClientRect().height <= (innerWidth > 700 ? 24 : 56), 'Project checkboxes use one desktop line and compact narrow wrapping')
    inputs[1].closest('label').click(); await pause(30)
    check(inputs[1].checked && inputs[0].checked && !inputs[2].checked && !document.querySelector('[data-proposal-receipt]'), 'Choosing Projects does not approve access')
    check(document.querySelectorAll('.proposal-request-body .proposal-rows > div').length === 1 && document.querySelector('[aria-label="About this request"]'), 'Attached-folder explanation does not duplicate the scope in another row')
    return 'PASS: all nine boundaries share the composer, compact inline Projects and no fake authorization'
}
const inspectCautions = async function () {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    const check = (value, message) => { if (!value) throw Error(message) }
    const select = document.querySelector('[aria-label="Proposed permission type"]')
    const choose = async id => { select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); await pause(280) }
    const effects = {
        purchase: 'Charges the selected payment method and starts a subscription.',
        'security-change': 'This reduces account protection.',
        'destructive-delete': 'These documents will be permanently deleted.',
        'file-upload': 'This file will leave your device.',
        'sensitive-data-submit': 'Shares personal information with this site. Values stay masked here.',
        'software-install': 'The installer can execute code and change files.',
        'legal-acceptance': 'Creates an agreement on behalf of this account.',
    }
    const notes = ['zyra-browser', 'chrome-tab', 'windows-window'].flatMap(target => Object.entries(effects).map(([effect, text]) => [`action-${target}-${effect}`, text]))
    notes.push(['account-reset', 'This credit is consumed immediately and cannot be restored.'], ['download-trust', 'This file can execute code and change files on your PC. Open it only if you trust its source.'], ['folder-file-trust', 'This file can execute code and change files on your PC. Open it only if you trust its source.'], ['threat', 'Continuing bypasses the protection for this page. Do not enter passwords or payment information.'], ['plugin-unsupported', 'Unsupported contributions will not be activated.'], ['update-install-blocked', 'Updating will stop this work. Nothing stops until you confirm.'], ['update-runtime-blocked', 'Updating will stop this work. Nothing stops until you confirm.'])
    for (const [id, text] of notes) {
        await choose(id)
        const warning = document.querySelector('.proposal-heading [data-tone="warning"]')
        check(warning?.querySelector('svg'), 'Header owns a warning icon: ' + id)
        check(!document.querySelector('.proposal-request-body .proposal-warning'), 'Caution no longer adds a body row: ' + id)
        warning.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await pause(50)
        const tooltip = document.querySelector('[role="tooltip"]')
        check(tooltip?.textContent.includes(text), 'Full caution is retained: ' + id)
        const bounds = tooltip.getBoundingClientRect()
        check(bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight, 'Warning fits the viewport: ' + id)
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause(20)
        check(!document.querySelector('[role="tooltip"]') && !document.querySelector('[data-proposal-receipt]'), 'Reading or dismissing warnings never approves: ' + id)
    }
    await choose('action-chrome-tab-purchase')
    const body = document.querySelector('.proposal-request-body').textContent
    check(body.includes('$24.00 USD') && body.includes('$24.00 each month until cancelled'), 'Price and renewal terms remain inline')
    document.querySelector('.proposal-heading [data-tone="warning"]').click(); await pause(50)
    check(document.querySelector('[role="tooltip"]') && !document.querySelector('[data-proposal-receipt]'), 'Touch/click reads the warning without approving')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await pause(20)
    check(!document.querySelector('[role="tooltip"]'), 'Outside press dismisses the warning')
    for (const [id, text] of [['grant-expired', 'This request has expired'], ['network-unavailable', 'The previous network is unavailable'], ['update-install-error', 'Preflight failed'], ['update-install-unknown', 'Check activity again'], ['threat-error', 'The previous override failed']]) {
        await choose(id)
        check(document.querySelector('.proposal-request-body .proposal-warning')?.textContent.includes(text), 'Blocking state or error stays inline: ' + id)
    }
    return 'PASS: all caution families use header warning tooltips, transaction details and errors stay visible'
}
const inspectTooltip = async function () {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    const check = (value, message) => { if (!value) throw Error(message) }
    const select = document.querySelector('[aria-label="Proposed permission type"]')
    select.value = 'action-windows-window-software-install'; select.dispatchEvent(new Event('change', { bubbles: true })); await pause(280)
    const info = document.querySelector('.proposal-heading [aria-label="About this installer"]')
    check(info, 'Installer info icon is beside the collapse control')
    check(!document.querySelector('.proposal-request-body .proposal-warning'), 'Installer caution is not duplicated inline')
    info.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await pause(50)
    check(document.querySelector('[role="tooltip"]')?.textContent === 'The installer can execute code and change files.', 'Hover shows the unchanged installer caution')
    const bounds = document.querySelector('[role="tooltip"]').getBoundingClientRect()
    check(bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight, 'Tooltip stays inside the viewport')
    info.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); await pause(160)
    check(!document.querySelector('[role="tooltip"]'), 'Tooltip dismisses after leaving')
    // Offscreen WebContents lack OS focus. Emit the focusin event keyboard focus sends.
    info.focus(); info.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); await pause(50)
    check(document.activeElement === info && document.querySelector('[role="tooltip"]') && info.getAttribute('aria-describedby'), 'Focused info control exposes its accessible description')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause(50)
    check(!document.querySelector('[role="tooltip"]'), 'Escape dismisses the tooltip')
    info.blur()
    check(!document.querySelector('[data-proposal-receipt]'), 'Reading the caution never decides the request')
    return 'PASS: installer header tooltip, hover/focus, Escape, pointer dismissal and viewport bounds'
}
const inspect = async function () {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    const check = (value, message) => { if (!value) throw Error(message) }
    const button = text => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text)
    const choose = async id => {
        const select = document.querySelector('[aria-label="Proposed permission type"]')
        select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); await pause(280)
    }
    const outcome = async mode => {
        const select = document.querySelector('[aria-label="Response state"]')
        select.value = mode; select.dispatchEvent(new Event('change', { bubbles: true })); await pause(30)
    }
    const input = (node, text) => {
        Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(node, text)
        node.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await choose('command')
    check(!document.querySelector('[data-proposal-receipt]'), 'Inspection never authorizes')
    check(!document.querySelector('[aria-label="Choose permission scope"]'), 'No split-button or scope dropdown remains')
    const scope = document.querySelector('[aria-label="Allow shell commands for this chat"]')
    check(scope?.type === 'checkbox' && !scope.checked && scope.closest('.proposal-footer'), 'Broader permission is an unchecked checkbox in the footer')
    check(!document.querySelector('.proposal-request-body input[type="checkbox"]'), 'Scope no longer adds a row to the request body')
    check(getComputedStyle(scope).opacity === '0' && scope.closest('label').querySelector('[data-composer-checkbox-mark]'), 'The native input is replaced visually by the app checkbox')
    check(!document.querySelector('.proposal-request-body').textContent.includes('Runs a shell command'), 'Command caution no longer consumes body height')
    const info = document.querySelector('[aria-label="About this request"]')
    info.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await pause(50)
    check(document.querySelector('[role="tooltip"]')?.textContent.includes('Runs a shell command. Files may change.'), 'Command caution is retained in the header tooltip')
    info.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); await pause(160)
    const mark = scope.closest('label').querySelector('[data-composer-checkbox-mark]')
    check(getComputedStyle(mark).borderRadius === '4px' && mark.getBoundingClientRect().width === 14, 'App checkbox uses the compact rounded-square control')
    scope.closest('label').click(); await pause(100)
    check(scope.checked && getComputedStyle(mark.querySelector('svg')).opacity === '1', 'Clicking the label updates the native value and custom checkmark')
    check(button('Allow for this chat'), 'Checking the broader scope updates the decision label')
    check(!document.querySelector('[data-proposal-receipt]'), 'Checking scope alone never approves')
    button('Allow for this chat').click(); await pause(350)
    check(document.querySelector('[data-proposal-receipt]')?.textContent.includes('allow-scoped'), 'Explicit scoped approval resolves synthetically')
    await choose('protected-setting'); check(!document.querySelector('.proposal-scope-option'), 'Exact app operations never offer a broader permission')
    await choose('folder-access'); document.querySelector('.proposal-scope-option input').click(); await pause(50)
    check(button('Allow until reconnect') && !document.querySelector('[data-proposal-receipt]'), 'Folder checkbox keeps its exact reconnect duration without approving')
    await choose('command'); check(!document.querySelector('.proposal-scope-option input').checked, 'New requests do not inherit broader scope')
    await choose('file-read'); button('Deny').click(); await pause(350)
    check(document.querySelector('[data-proposal-receipt]')?.textContent.includes('deny'), 'Deny remains separate')
    await choose('command'); button('Draft off').click(); await pause(50)
    input(document.querySelector('[aria-label="Preserved draft"]'), 'Keep this draft across requests.'); await pause(50)
    document.querySelector('[aria-label="Preserved draft"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    check(!document.querySelector('[data-proposal-receipt]'), 'Draft Enter never approves')
    await choose('project-clone')
    check(document.querySelector('[aria-label="Preserved draft"]').value === 'Keep this draft across requests.', 'Draft survives switching')
    const name = [...document.querySelectorAll('.proposal-field')].find(node => node.textContent.includes('Project name')).querySelector('input')
    input(name, ''); await pause(50); check(button('Clone repository').disabled, 'Missing project name cannot submit')
    await choose('command'); await outcome('error'); button('Allow once').click(); await pause(350)
    check(document.querySelector('[role="alert"]') && !button('Allow once').disabled, 'Failure is inline and retryable')
    await outcome('normal'); button('Allow once').click(); await pause(350)
    check(document.querySelector('[data-proposal-resolved]'), 'Retry succeeds without remounting the request')
    await choose('command'); await outcome('slow'); button('Allow once').click(); await pause(50)
    check(button('Saving choice').disabled && button('Deny').disabled && document.querySelector('[aria-label="Allow shell commands for this chat"]').disabled, 'Decisions and scope checkbox lock during response')
    await choose('file-change'); await pause(1900)
    check(!document.querySelector('[data-proposal-receipt]'), 'A switched-away response cannot resolve the next request')
    await outcome('normal'); await choose('command'); button('Draft on').click(); await pause(50)
    document.querySelector('[aria-label="Minimize request"]').click(); await pause(280)
    check(!document.querySelector('.proposal-command'), 'Minimize folds only the request body')
    document.querySelector('[aria-label="Expand request"]').click(); await pause(280)
    check(document.querySelector('.proposal-command'), 'Expand restores body')
    return 'PASS: explicit scoped approval, deny, draft/Enter isolation, form validation, busy locks, retry, stale-response cancellation and folding'
}
const capture = async function (entry) {
    const select = document.querySelector('[aria-label="Proposed permission type"]')
    select.value = entry.id; select.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 280))
    const external = entry.kind === 'external'
    if (external ? !document.querySelector('[data-proposal-boundary]') : document.querySelector('[data-proposal-case]')?.dataset.proposalCase !== entry.id) throw Error('Missing proposed case: ' + entry.id)
    if (document.querySelector('[data-proposal-receipt]')) throw Error('Implicit decision: ' + entry.id)
    if (document.documentElement.scrollWidth > innerWidth) throw Error('Horizontal overflow: ' + entry.id)
    const frame = document.querySelector('.proposal-frame')
    if (!external) for (const node of frame.querySelectorAll('button:not(:disabled), input[type="checkbox"]:not(:disabled)')) {
        const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (r.bottom > innerHeight || !node.contains(hit)) throw Error('Decision control not reachable: ' + entry.id + ' / ' + node.textContent)
    }
    if (!external) {
        const option = frame.querySelector('input[type="checkbox"]')
        if (entry.id === 'command' && !option) throw Error('Scope checkbox must be in the compact composer footer')
        if (option && (getComputedStyle(option).opacity !== '0' || !option.closest('label').querySelector('[data-composer-checkbox-mark]'))) throw Error('Native checkbox is still visible: ' + entry.id)
        if (entry.id === 'command' && innerWidth < 500) {
            option.closest('label').click(); await new Promise(resolve => setTimeout(resolve, 50))
            if (!option.checked || document.querySelector('[data-proposal-receipt]')) throw Error('Compact scope checkbox must select without approving')
        }
        if (option && document.querySelector('.proposal-footer').getBoundingClientRect().height > 40) throw Error('Footer option adds an extra row: ' + entry.id)
        for (const checkbox of document.querySelectorAll('[data-proposal-case] input[type="checkbox"]')) {
            if (getComputedStyle(checkbox).opacity !== '0' || !checkbox.closest('label').querySelector('[data-composer-checkbox-mark]')) throw Error('Every proposal checkbox must use the app control: ' + entry.id)
        }
    }
    return { id: entry.id, external, text: document.querySelector('[data-proposal-case], [data-proposal-boundary]').textContent.slice(0, 800) }
}
const harness = join(temporary, 'review.cjs')
await writeFile(harness, `const {app,BrowserWindow}=require('electron');const fs=require('node:fs');app.setPath('userData',${JSON.stringify(join(temporary, 'profile'))});const timeout=setTimeout(()=>app.exit(1),150000);
app.whenReady().then(async()=>{const errors=[],rows=[];const win=new BrowserWindow({show:false,width:1100,height:820,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});win.webContents.on('paint',()=>{});win.webContents.setFrameRate(60);win.webContents.startPainting();win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});await win.loadURL('http://127.0.0.1:5187/permission-composer-review.html');const js=source=>win.webContents.executeJavaScript(source).catch(error=>{console.error('Renderer failure:',source.slice(0,250),errors);throw error});await js('new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(document.querySelector("[data-proposal-case]")){clearInterval(t);resolve(true)}else if(++n>100){clearInterval(t);reject(Error("Proposal failed to load"))}},100)})');
const cases=await js(${JSON.stringify('[...document.querySelector(\'[aria-label="Proposed permission type"]\').options].map(o=>({id:o.value,kind:o.dataset.kind}))')});if(cases.length!==109)throw Error('Catalog cases were lost');
if(${process.argv.includes('--compact-only')}){console.log(await js('('+${JSON.stringify(inspectCompactCases.toString())}+')()'));for(const id of ['link-choice','extension-webstore-native','device-partial']){const entry=cases.find(e=>e.id===id);await js('('+${JSON.stringify(capture.toString())}+')('+JSON.stringify(entry)+')');fs.writeFileSync(${JSON.stringify(output)}+'/'+id+'-compact.png',(await win.webContents.capturePage()).toPNG());}win.setContentSize(390,740);await new Promise(r=>setTimeout(r,100));console.log(await js('('+${JSON.stringify(inspectCompactCases.toString())}+')()'));for(const id of ['extension-webstore-native','device-partial']){const entry=cases.find(e=>e.id===id);await js('('+${JSON.stringify(capture.toString())}+')('+JSON.stringify(entry)+')');fs.writeFileSync(${JSON.stringify(output)}+'/'+id+'-compact-narrow.png',(await win.webContents.capturePage()).toPNG());}if(errors.length)throw Error(errors.join('\\n'));clearTimeout(timeout);app.quit();return;}
if(${process.argv.includes('--warnings-only')}){console.log(await js('('+${JSON.stringify(inspectCautions.toString())}+')()'));console.log(await js('('+${JSON.stringify(inspectTooltip.toString())}+')()'));const entry=cases.find(e=>e.id==='action-chrome-tab-purchase');await js('('+${JSON.stringify(capture.toString())}+')('+JSON.stringify(entry)+')');fs.writeFileSync(${JSON.stringify(output)}+'/purchase-compact.png',(await win.webContents.capturePage()).toPNG());await js(${JSON.stringify('document.querySelector(\'.proposal-heading [data-tone="warning"]\').dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))')});await new Promise(r=>setTimeout(r,80));fs.writeFileSync(${JSON.stringify(output)}+'/purchase-warning.png',(await win.webContents.capturePage()).toPNG());win.setContentSize(390,740);await new Promise(r=>setTimeout(r,100));console.log(await js('('+${JSON.stringify(inspectCautions.toString())}+')()'));console.log(await js('('+${JSON.stringify(inspectTooltip.toString())}+')()'));await js('('+${JSON.stringify(capture.toString())}+')('+JSON.stringify(entry)+')');await js(${JSON.stringify('document.querySelector(\'.proposal-heading [data-tone="warning"]\').dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))')});await new Promise(r=>setTimeout(r,80));fs.writeFileSync(${JSON.stringify(output)}+'/purchase-warning-narrow.png',(await win.webContents.capturePage()).toPNG());if(errors.length)throw Error(errors.join('\\n'));clearTimeout(timeout);app.quit();return;}
if(!${process.argv.includes('--hover-only')})console.log(await js('('+${JSON.stringify(inspectCapabilities.toString())}+')()'));
if(${process.argv.includes('--capabilities-only')}){const entry=cases.find(e=>e.id==='grant-windows-window-chat');await js('('+${JSON.stringify(capture.toString())}+')('+JSON.stringify(entry)+')');fs.writeFileSync(${JSON.stringify(output)}+'/capabilities.png',(await win.webContents.capturePage()).toPNG());const privateEntry=cases.find(e=>e.id==='grant-incognito');await js('('+${JSON.stringify(capture.toString())}+')('+JSON.stringify(privateEntry)+')');fs.writeFileSync(${JSON.stringify(output)}+'/incognito.png',(await win.webContents.capturePage()).toPNG());await js('('+${JSON.stringify(capture.toString())}+')('+JSON.stringify(entry)+')');await js('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Light").click()');await new Promise(r=>setTimeout(r,150));fs.writeFileSync(${JSON.stringify(output)}+'/capabilities-light.png',(await win.webContents.capturePage()).toPNG());await js('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Dark").click()');win.setContentSize(390,740);await new Promise(r=>setTimeout(r,100));console.log(await js('('+${JSON.stringify(inspectCapabilities.toString())}+')()'));await js('('+${JSON.stringify(capture.toString())}+')('+JSON.stringify(entry)+')');fs.writeFileSync(${JSON.stringify(output)}+'/capabilities-narrow.png',(await win.webContents.capturePage()).toPNG());await js('('+${JSON.stringify(capture.toString())}+')('+JSON.stringify(privateEntry)+')');fs.writeFileSync(${JSON.stringify(output)}+'/incognito-narrow.png',(await win.webContents.capturePage()).toPNG());if(errors.length)throw Error(errors.join('\\n'));clearTimeout(timeout);app.quit();return;}
console.log(await js('('+${JSON.stringify(inspectFileHover.toString())}+')()'));
if(${process.argv.includes('--hover-only')}){await js('('+${JSON.stringify(inspectFileHover.toString())}+')(true)');fs.writeFileSync(${JSON.stringify(output)}+'/file-hover.png',(await win.webContents.capturePage()).toPNG());win.setContentSize(390,740);await new Promise(r=>setTimeout(r,100));console.log(await js('('+${JSON.stringify(inspectFileHover.toString())}+')()'));await js('('+${JSON.stringify(inspectFileHover.toString())}+')(true)');fs.writeFileSync(${JSON.stringify(output)}+'/file-hover-narrow.png',(await win.webContents.capturePage()).toPNG());if(errors.length)throw Error(errors.join('\\n'));clearTimeout(timeout);app.quit();return;}
console.log(await js('('+${JSON.stringify(inspectDensity.toString())}+')()'));console.log(await js('('+${JSON.stringify(inspectCompactCases.toString())}+')()'));
console.log(await js('('+${JSON.stringify(inspectTooltip.toString())}+')()'));console.log(await js('('+${JSON.stringify(inspectCautions.toString())}+')()'));
const shots=new Set(['command','command-long','file-read','file-multiple','grant-zyra-browser-chat','action-chrome-tab-purchase','terminal','project-clone','plugin-executable','device-partial','update-install-blocked','download-trust']);for(const entry of cases){rows.push(await js('('+${JSON.stringify(capture.toString())}+')('+JSON.stringify(entry)+')'));if(shots.has(entry.id))fs.writeFileSync(${JSON.stringify(output)}+'/'+entry.id+'.png',(await win.webContents.capturePage()).toPNG())}console.log('PASS: all 109 proposed cases, no implicit decisions, no overflow and reachable footer controls');console.log(await js('('+${JSON.stringify(inspect.toString())}+')()'));
await js('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Light").click()');await new Promise(r=>setTimeout(r,150));fs.writeFileSync(${JSON.stringify(output)}+'/light.png',(await win.webContents.capturePage()).toPNG());await js('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Dark").click()');
win.setContentSize(390,740);await new Promise(r=>setTimeout(r,100));for(const id of ['command','command-long','file-read','grant-zyra-browser-chat','project-clone','action-chrome-tab-purchase','update-install-blocked','terminal','folder-access','device-partial']){const entry=cases.find(e=>e.id===id);rows.push({...await js('('+${JSON.stringify(capture.toString())}+')('+JSON.stringify(entry)+')'),narrow:true});fs.writeFileSync(${JSON.stringify(output)}+'/'+id+'-narrow.png',(await win.webContents.capturePage()).toPNG())}console.log(await js('('+${JSON.stringify(inspectCompactCases.toString())}+')()'));console.log(await js('('+${JSON.stringify(inspectCapabilities.toString())}+')()'));console.log(await js('('+${JSON.stringify(inspectFileHover.toString())}+')()'));console.log(await js('('+${JSON.stringify(inspectDensity.toString())}+')()'));console.log(await js('('+${JSON.stringify(inspectTooltip.toString())}+')()'));console.log(await js('('+${JSON.stringify(inspectCautions.toString())}+')()'));await js('('+${JSON.stringify(inspectTooltip.toString())}+')()');await js(${JSON.stringify('document.querySelector(\'[aria-label="About this installer"]\').dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))')});await new Promise(r=>setTimeout(r,80));fs.writeFileSync(${JSON.stringify(output)}+'/installer-tooltip-narrow.png',(await win.webContents.capturePage()).toPNG());console.log('PASS: light theme, ten narrow layouts, compact disclosures, custom-checkbox footer and installer tooltip');fs.writeFileSync(${JSON.stringify(join(output, 'audit.json'))},JSON.stringify({cases:cases.length,errors,rows},null,2));if(errors.length)throw Error(errors.join('\\n'));clearTimeout(timeout);app.quit();}).catch(error=>{console.error(error);app.exit(1)});`)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
try {
    process.exitCode = await new Promise((done, reject) => {
        const child = spawn(electron, [harness], { env, windowsHide: true, stdio: 'inherit' })
        child.once('error', reject); child.once('exit', code => done(code ?? 1))
    })
} finally { await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
