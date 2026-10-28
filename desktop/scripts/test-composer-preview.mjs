import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electron from 'electron'
const directory = await mkdtemp(join(tmpdir(), 'zyra-composer-preview-'))
const output = resolve('../docs.local/reviews/question-composer')
await mkdir(output, { recursive: true })
const driver = async function () {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const check = (v, name) => { if (!v) throw new Error(name) }
    const wait = async (fn, name) => { for (let i = 0; i < 120; i++) { if (fn()) return; await sleep(100) } throw new Error(name) }
    const buttons = () => [...document.querySelectorAll('button')]
    const button = name => buttons().find(b => b.textContent.trim() === name || b.getAttribute('aria-label') === name || b.title === name)
    const click = async name => { const b = button(name); check(b && !b.disabled, `Enabled ${name}`); b.click(); await sleep(220) }
    const switchSmoothly = async selector => {
        const measure = () => document.querySelector(selector).getBoundingClientRect().height
        const from = measure(), samples = []
        button('Continue').click()
        for (let i = 0; i < 16; i++) { await sleep(20); samples.push(measure()) }
        const to = samples.at(-1), low = Math.min(from, to), high = Math.max(from, to)
        check(high - low > 3 && samples.some(height => height > low + 1 && height < high - 1), 'Question switches must animate height instead of snapping: ' + JSON.stringify({ selector, from, to, samples }))
    }
    const select = async id => { const el = document.querySelector('select'); el.value = id; el.dispatchEvent(new Event('change', { bubbles: true })); await sleep(350) }
    const input = async (selector, value) => {
        const el = document.querySelector(selector); check(el, `Input ${selector}`)
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true })); await sleep(100)
    }
    await wait(() => document.querySelector('[data-question-composer]'), 'Composer loads').catch(error => { throw new Error(error.message + ': ' + document.body.innerText.slice(0, 1200)) })
    await document.fonts.ready
    button('Reset').click()
    const entranceHeights = []
    let entranceStartedAt = -1
    for (let i = 0; i < 120; i++) {
        await sleep(20)
        const height = document.querySelector('[data-question-shelf]').getBoundingClientRect().height
        entranceHeights.push(height)
        if (height > 0 && entranceStartedAt < 0) entranceStartedAt = i
        if (entranceStartedAt >= 0 && i - entranceStartedAt >= 16) break
    }
    const entranceEnd = entranceHeights.at(-1)
    check(entranceHeights.some(height => height > 1 && height < entranceEnd - 1), 'Tray entrance must move through intermediate heights: ' + JSON.stringify(entranceHeights))
    check([...document.querySelectorAll('[data-guided-animate]')].every(node => node.getAnimations().length === 0 && getComputedStyle(node).filter === 'none'), 'Entrance uses one surface motion, not per-row blur/stagger effects')
    check(!document.body.textContent.includes('Guided Input'), 'No decorative guided badge')
    check(document.body.textContent.includes('Preview model'), 'Original model footer preserved')
    const frame = document.querySelector('[data-question-composer]')
    const drawer = () => document.querySelector('[data-question-shelf] [data-composer-drawer]')
    await wait(() => document.querySelector('[data-question-shelf]')?.getBoundingClientRect().height > 50, 'Attached question drawer opens')
    await sleep(350)
    check(!frame.contains(drawer()), 'Questions are outside the default input frame')
    check(!document.querySelector('nav[aria-label="Questions"]'), 'No custom step rail')
    const frameTop = frame.getBoundingClientRect().top
    const bounds = drawer().getBoundingClientRect()
    check(bounds.top < frameTop && bounds.bottom <= frameTop + 18, 'Question tray extends above the composer with the shared seam: ' + JSON.stringify({ drawer: bounds.toJSON(), frame: frame.getBoundingClientRect().toJSON(), shelf: document.querySelector('[data-question-shelf]').getBoundingClientRect().toJSON() }))
    check(bounds.left > frame.getBoundingClientRect().left, 'Question tray uses the skills drawer inset')
    check(button('Continue').textContent.trim() === 'Continue', 'Labeled Continue action is preserved')
    check(button('Start voice input'), 'Question composer exposes dictation beside Continue')
    document.activeElement?.blur(); await sleep(350)
    const styleKeys = ['borderRadius', 'backgroundColor', 'borderColor', 'boxShadow', 'backdropFilter']
    const frameStyle = styleKeys.map(k => getComputedStyle(frame)[k])
    const inputStyle = ['fontSize', 'lineHeight', 'minHeight'].map(k => getComputedStyle(document.querySelector('textarea'))[k])
    const expandedHeight = drawer().getBoundingClientRect().height
    button('Minimize guided question').click()
    await sleep(60)
    const collapsingHeight = drawer().getBoundingClientRect().height
    await sleep(220)
    const collapsedHeight = drawer().getBoundingClientRect().height
    check(collapsingHeight < expandedHeight && collapsingHeight > collapsedHeight, 'Collapse animates through an intermediate height instead of snapping')
    check(Math.abs(frame.getBoundingClientRect().top - frameTop) < 1, 'Minimizing the tray does not resize or move the input: ' + JSON.stringify({ before: frameTop, after: frame.getBoundingClientRect().toJSON(), transition: [...frame.querySelectorAll('[data-question-transition]')].map(node => ({ box: node.getBoundingClientRect().toJSON(), natural: node.firstElementChild.getBoundingClientRect().toJSON() })) }))
    button('Expand guided question').click()
    await sleep(60)
    const expandingHeight = drawer().getBoundingClientRect().height
    await sleep(220)
    check(expandingHeight > collapsedHeight && expandingHeight < drawer().getBoundingClientRect().height, 'Expand animates smoothly through an intermediate height')
    check(button('Continue').disabled, 'Required choice guarded')
    document.querySelectorAll('[role="radio"]')[1].click(); await sleep(120)
    check(document.body.textContent.includes('Keep the interface dark'), 'Choice description is immediately readable')
    check(document.querySelector('[role="radio"][aria-checked="true"]'), 'Redesigned choice preserves radio semantics')
    await click('Continue')
    document.querySelector('[role="checkbox"]').click(); await sleep(120)
    await input('textarea', 'Custom improvement')
    await switchSmoothly('[data-question-tray]')
    await input('textarea', 'Less clutter and clearer choices')
    await click('Choose question')
    const pickerItems = () => [...document.querySelectorAll('[data-question-picker] [role="menuitemradio"]')]
    check(pickerItems().length === 8 && pickerItems()[0].textContent.includes('Dark'), 'Picker lists question titles and completed answer previews')
    check(pickerItems().every((item, index) => item.querySelector('[data-question-number]')?.textContent === String(index + 1)), 'Each question option has its own visible number')
    check(pickerItems()[2].getAttribute('aria-checked') === 'true' && pickerItems()[3].getAttribute('aria-label').includes('unanswered'), 'Picker highlights the current question and distinguishes unanswered questions')
    const menuBounds = document.querySelector('[data-question-picker]').closest('[data-anchored-menu-popover]').getBoundingClientRect()
    check(menuBounds.width <= 242 && menuBounds.height <= 270 && pickerItems().every(item => item.getBoundingClientRect().height <= 32), 'Picker stays a compact single-line jump menu')
    check(Math.abs(menuBounds.right - button('Choose question').getBoundingClientRect().right) < 1, 'Picker aligns with the counter rather than protruding beyond the tray')
    check(!document.querySelector('[data-question-picker]').textContent.includes('Not answered'), 'Unanswered rows have no repetitive status captions')
    const firstItem = pickerItems()[0], itemBounds = firstItem.getBoundingClientRect()
    check(firstItem.contains(document.elementFromPoint(itemBounds.left + 30, itemBounds.top + 10)), 'Picker is not clipped or obscured by the tray or composer')
    firstItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    check(document.activeElement === pickerItems()[7], 'End focuses the final question')
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    check(document.activeElement === pickerItems()[1], 'Arrow navigation moves through questions')
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(100)
    check(!document.querySelector('[data-question-picker]') && document.activeElement === button('Choose question'), 'Escape dismisses the picker and restores counter focus')
    await click('Choose question'); pickerItems()[0].click(); await sleep(250)
    check(document.querySelector('[role="radio"][aria-checked="true"]')?.textContent.includes('Dark'), 'Jumping to a completed question retains its answer')
    await click('Minimize guided question'); await click('Choose question'); pickerItems()[2].click(); await sleep(300)
    check(button('Minimize guided question') && document.querySelector('textarea').value === 'Less clutter and clearer choices', 'Picking a question expands the minimized tray and preserves unsent text')
    await click('Choose question')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await sleep(100)
    check(!document.querySelector('[data-question-picker]'), 'Clicking outside dismisses the picker')
    await switchSmoothly('[data-question-composer]')
    const ratingSlider = document.querySelector('input[type="range"]')
    check(ratingSlider?.min === '1' && ratingSlider.max === '10' && ratingSlider.step === '1', 'Bounded questions expose the supplied range and step')
    check(document.querySelector('input[type="number"]').value === '' && button('Continue').disabled, 'Slider does not silently answer an untouched required question')
    const fillNode = document.querySelector('[data-number-slider-fill]')
    const handleNode = document.querySelector('[data-number-slider-handle]')
    const startWidth = fillNode.getBoundingClientRect().width
    const startLeft = handleNode.getBoundingClientRect().left
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(ratingSlider, '6')
    ratingSlider.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(35)
    const midwayWidth = fillNode.getBoundingClientRect().width
    const midwayLeft = handleNode.getBoundingClientRect().left
    check(document.querySelector('input[type="number"]').value === '6', 'The exact numeric answer updates without waiting for animation')
    await sleep(140)
    check(startWidth < midwayWidth && midwayWidth < fillNode.getBoundingClientRect().width, 'Slider fill animates through intermediate widths')
    check(startLeft < midwayLeft && midwayLeft < handleNode.getBoundingClientRect().left, 'Slider handle smoothly follows instead of snapping between steps')
    check(document.querySelector('input[type="number"]').value === '6' && !document.querySelector('textarea'), 'Slider updates the editable answer with no duplicate message box')
    check(getComputedStyle(document.querySelector('[data-question-number-range]')).height === '32px' && ratingSlider.classList.contains('zyra-question-slider'), 'Number control uses the compact full-height scrubber')
    await input('input[type="number"]', '11')
    check(button('Continue').disabled, 'Number maximum enforced')
    await input('input[type="number"]', '8')
    check(document.querySelector('input[type="range"]').value === '8', 'Typing an exact value updates the slider')
    await click('Continue')
    document.querySelector('[role="radio"]').click(); await sleep(120)
    await click('Continue')
    await click('Skip')
    await click('Continue')
    document.querySelector('[role="checkbox"]').click(); await sleep(120)
    await click('Continue')
    check(document.body.textContent.includes('Review every answer'), 'Review reached')
    await click('Choose question'); pickerItems()[1].click(); await sleep(250)
    check(document.querySelector('textarea').value === 'Custom improvement', 'Review picker restores a completed custom multi-select answer')
    await click('Continue')
    check(document.body.textContent.includes('Review every answer'), 'Editing from the review picker returns to review')
    const edit = buttons().find(b => b.lastElementChild?.textContent === 'Change')
    check(edit && !edit.disabled, 'Review answer editable'); edit.click(); await sleep(220)
    check(document.querySelector('[role="radio"][aria-checked="true"]')?.textContent.includes('Dark'), 'Back navigation retains answer')
    await click('Continue')
    await click('Submit')
    check(document.querySelector('[data-preview-submitted]'), 'Synthetic submission complete')
    await click('Try again'); await click('Choose question'); pickerItems()[3].click(); await sleep(250)
    await input('input[type="number"]', '9'); await click('Continue')
    await click('Choose question'); pickerItems()[7].click(); await sleep(250)
    await click('Skip')
    check(button('Finish questions') && !button('Finish questions').disabled && !button('Submit'), 'Incomplete review offers Finish questions instead of a disabled Submit')
    check(document.querySelector('[data-question-tray]').textContent.includes('Not answered'), 'Missing answers are not falsely marked as skipped')
    await click('Finish questions')
    check(button('Choose question').textContent.includes('1/8') && button('Continue').disabled, 'Finish questions opens the first unfinished question without bypassing validation')
    document.querySelectorAll('[role="radio"]')[1].click(); await sleep(80); await click('Continue')
    check(button('Choose question').textContent.includes('2/8') && !button('Finish questions'), 'Continue advances directly to the next unfinished question')
    document.querySelector('[role="checkbox"]').click(); await sleep(80); await click('Continue')
    check(button('Choose question').textContent.includes('3/8'), 'Finishing mode continues through remaining unanswered questions')
    await input('textarea', 'Finish the unanswered questions'); await click('Continue')
    check(button('Choose question').textContent.includes('5/8'), 'Finishing mode skips the numeric question already answered earlier')
    document.querySelector('[role="radio"]').click(); await sleep(80); await click('Continue')
    check(button('Choose question').textContent.includes('6/8') && button('Skip'), 'Unvisited optional questions still get an explicit Skip choice')
    await click('Skip'); await click('Continue')
    check(button('Submit') && !button('Submit').disabled && !button('Finish questions') && !document.querySelector('[data-preview-submitted]'), 'Finishing the last gap returns to review without auto-submitting')
    check(document.querySelector('[data-question-tray]').textContent.includes('9'), 'Completed numeric answers are retained while other gaps are finished')
    await click('Choose question'); await select('rating')
    check(!document.querySelector('[data-question-picker]'), 'Replacing a request closes the picker')
    check(!button('Choose question'), 'Single-question requests do not need a navigation menu')
    await input('input[type="number"]', '4'); await click('Submit answer')
    check(document.querySelector('[data-preview-submitted]')?.textContent.includes('4'), 'Scalar submission')
    await select('date')
    const dateTrigger = () => document.querySelector('[data-question-date-picker]')
    const calendarDay = iso => document.querySelector(`[data-calendar-date="${iso}"]`)
    const isoDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    check(dateTrigger() && !document.querySelector('input[type="date"]') && !document.querySelector('textarea'), 'Date questions use the custom calendar without native date input or duplicate composer')
    dateTrigger().click(); await sleep(150)
    check(document.querySelector('[data-question-calendar]') && dateTrigger().getAttribute('data-date-value') === '', 'Opening a calendar does not fabricate an answer')
    const adjacentDay = [...document.querySelectorAll('[data-calendar-date]')].find(day => Number(day.getAttribute('data-calendar-date').slice(5, 7)) !== new Date().getMonth() + 1)
    check(Number(getComputedStyle(adjacentDay).opacity) < .5, 'Adjacent-month days remain visually muted')
    const initialFirstDay = document.querySelector('[data-calendar-date]').getAttribute('data-calendar-date')
    await click('Next month')
    check(document.querySelector('[data-calendar-date]').getAttribute('data-calendar-date') !== initialFirstDay, 'Custom calendar navigates months')
    await click('Previous month')
    check(document.querySelector('[data-calendar-date]').getAttribute('data-calendar-date') === initialFirstDay, 'Previous month restores the view')
    await click('Today')
    const today = new Date(), todayIso = isoDate(today)
    check(dateTrigger().getAttribute('data-date-value') === todayIso && !document.querySelector('[data-question-calendar]'), 'Today selects a local date and closes the calendar')
    dateTrigger().click(); await sleep(150)
    calendarDay(todayIso).focus()
    calendarDay(todayIso).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await sleep(80)
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    check(document.activeElement?.getAttribute('data-calendar-date') === isoDate(tomorrow) && dateTrigger().getAttribute('data-date-value') === todayIso, 'Arrow keys move calendar focus without committing a date')
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(80)
    check(!document.querySelector('[data-question-calendar]') && document.activeElement === dateTrigger(), 'Escape dismisses the custom calendar and returns focus')
    dateTrigger().click(); await sleep(100); await click('Clear date')
    check(dateTrigger().getAttribute('data-date-value') === '' && button('Skip'), 'Clear restores the optional unanswered state')
    dateTrigger().click(); await sleep(100)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await sleep(80)
    check(!document.querySelector('[data-question-calendar]'), 'Outside click dismisses the calendar')
    dateTrigger().click(); await sleep(100)
    await select('rating')
    check(!document.querySelector('[data-question-calendar]'), 'Replacing the request dismisses its calendar')
    await select('date')
    dateTrigger().click(); await sleep(100)
    const targetDate = '2026-10-22'
    for (let i = 0; i < 1200 && !calendarDay(targetDate); i++) {
        const first = document.querySelector('[data-calendar-date]').getAttribute('data-calendar-date')
        await click(targetDate < first ? 'Previous month' : 'Next month')
    }
    check(calendarDay(targetDate), 'Target calendar date is available')
    calendarDay(targetDate).click(); await sleep(100)
    check(dateTrigger().getAttribute('data-date-value') === targetDate && !document.querySelector('[data-question-calendar]'), 'Choosing a custom calendar day commits its ISO date')
    await click('Submit answer')
    check(document.querySelector('[data-preview-submitted]')?.textContent.includes('2026-10-22'), 'Date submission')
    await select('ranking')
    const rankingRows = () => [...document.querySelectorAll('[data-ranking-row]')]
    const rankingOrder = () => rankingRows().map(row => row.getAttribute('data-ranking-row'))
    const row = rankingRows()[0], targetRow = rankingRows()[1]
    check(row.querySelector('svg.lucide-grip-vertical')?.parentElement === row && row.querySelectorAll('button').length === 2, 'Six-dot grip stays visible without a separate button or holder')
    const label = row.children[1], from = label.getBoundingClientRect(), to = targetRow.getBoundingClientRect()
    const x = from.left + 12, y = from.top + from.height / 2, endY = to.top + to.height * .7
    const pointer = (node, type, clientY) => node.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY }))
    pointer(label, 'pointerdown', y)
    pointer(document, 'pointermove', y + 8); await sleep(60)
    check(row.getAttribute('data-ranking-dragging') === 'true', 'Dragging starts from the row label, not only the grip')
    pointer(document, 'pointermove', endY); await sleep(80)
    const liveRanks = { dragged: row.children[0].textContent, displaced: targetRow.children[0].textContent }
    const rankNumberAnimating = Boolean(row.querySelector('[data-ranking-number]')?.getAnimations().length)
    const releaseTop = (document.querySelector('[data-ranking-overlay]') || row).getBoundingClientRect().top
    pointer(document, 'pointerup', endY)
    const dropTops = []
    for (let i = 0; i < 18; i++) { await sleep(16); dropTops.push((document.querySelector('[data-ranking-overlay]') || row).getBoundingClientRect().top) }
    const finalTop = row.getBoundingClientRect().top
    check(dropTops.every(top => top >= Math.min(releaseTop, finalTop) - 2 && top <= Math.max(releaseTop, finalTop) + 2), 'Dropping must not jump away and back: ' + JSON.stringify({ releaseTop, finalTop, dropTops }))
    check(Math.abs(releaseTop - finalTop) > 3 && dropTops.some(top => top > Math.min(releaseTop, finalTop) + .5 && top < Math.max(releaseTop, finalTop) - .5), 'Off-center release must settle smoothly into its slot')
    check(liveRanks.dragged === '2' && liveRanks.displaced === '1', 'Rank numbers must update during the drag, not only after release: ' + JSON.stringify(liveRanks))
    check(rankNumberAnimating, 'Projected rank numbers animate as rows cross during dragging')
    check(rankingOrder().join(',') === 'Speed,Appearance,Clarity', 'Full-row dragging changes the actual priority order')
    const cancelledRow = rankingRows()[2], cancelFrom = cancelledRow.getBoundingClientRect(), cancelTo = rankingRows()[0].getBoundingClientRect()
    pointer(cancelledRow.children[1], 'pointerdown', cancelFrom.top + cancelFrom.height / 2)
    pointer(document, 'pointermove', cancelFrom.top + 8); await sleep(60)
    pointer(document, 'pointermove', cancelTo.top + cancelTo.height / 2); await sleep(80)
    check(cancelledRow.children[0].textContent === '1', 'Live ranking preview follows a move across multiple rows')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); await sleep(250)
    check(!document.querySelector('[data-ranking-overlay]') && rankingOrder().join(',') === 'Speed,Appearance,Clarity', 'Cancelling a drag removes the preview and preserves the committed order')
    pointer(button('Move Appearance up'), 'pointerdown', endY)
    await click('Move Appearance up')
    check(!document.querySelector('[data-ranking-dragging="true"]') && rankingOrder()[0] === 'Appearance', 'Move buttons reorder without starting a drag')
    await click('Move Appearance down'); await click('Continue'); await click('Submit')
    check(document.querySelector('[data-preview-submitted]')?.textContent.includes('Speed, Appearance, Clarity'), 'Ranking reorder submits')
    await select('theme')
    await input('textarea', 'My own theme'); await click('Submit answer')
    check(document.querySelector('[data-preview-submitted]')?.textContent.includes('My own theme'), 'Custom selection submits')
    await select('message')
    await wait(() => document.querySelector('[data-composer-text-input]'), 'Original message composer mounts')
    check(document.body.textContent.includes('Preview model'), 'Message and question composer share footer controls')
    check(!document.body.textContent.includes('Selected effort unavailable'), 'Fixture model supports the original composer settings')
    document.activeElement?.blur(); await sleep(350)
    const normalStyle = styleKeys.map(k => getComputedStyle(document.querySelector('[data-assistant-composer-frame]'))[k])
    check(JSON.stringify(frameStyle) === JSON.stringify(normalStyle), 'Question composer matches the default frame styling exactly')
    const normalInputStyle = ['fontSize', 'lineHeight', 'minHeight'].map(k => getComputedStyle(document.querySelector('[data-composer-text-input]'))[k])
    check(JSON.stringify(inputStyle) === JSON.stringify(normalInputStyle), 'Question input matches default font, line height and minimum height')
    const ordinary = document.querySelector('[data-composer-text-input]')
    ordinary.textContent = 'A normal message'
    ordinary.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'A normal message' }))
    await wait(() => button('Send') && !button('Send').disabled, 'Ordinary composer can send')
    await click('Send')
    check(document.querySelector('main p.mt-6')?.textContent === 'A normal message', 'Ordinary send stays inside the preview')
    await select('all')
    await wait(() => document.querySelector('[role="radio"]'), 'Questions return inside composer')
    document.querySelectorAll('[role="radio"]')[0].click(); await sleep(800)
    return 'Smooth tray entrance and section/composer resizing, question picker, keyboard/dismissal, retained drafts, eight field types and synthetic submission passed'
}
const harness = join(directory, 'preview.cjs')
await writeFile(harness, `const {app,BrowserWindow}=require('electron');const fs=require('node:fs');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
const timeout=setTimeout(()=>{console.error('Preview check timed out');app.exit(1)},120000);
app.whenReady().then(async()=>{const errors=[];const win=new BrowserWindow({title:'Question composer preview',show:false,width:1100,height:820,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
win.webContents.on('paint',()=>{});win.webContents.setFrameRate(60);win.webContents.startPainting();
win.webContents.on('console-message',(_e,level,message)=>{if(level>=3){errors.push(message);console.error(message)}});
await win.loadURL('http://127.0.0.1:5187/composer-review.html');console.log(await win.webContents.executeJavaScript('('+${JSON.stringify(driver.toString())}+')()'));
await new Promise(r=>setTimeout(r,350));fs.writeFileSync(${JSON.stringify(join(output,'dark.png'))},(await win.webContents.capturePage()).toPNG());
await win.webContents.executeJavaScript("document.querySelector('[aria-label=\\\"Choose question\\\"]').click()");await new Promise(r=>setTimeout(r,150));fs.writeFileSync(${JSON.stringify(join(output,'picker.png'))},(await win.webContents.capturePage()).toPNG());await win.webContents.executeJavaScript("document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Light').click()");await new Promise(r=>setTimeout(r,400));fs.writeFileSync(${JSON.stringify(join(output,'light.png'))},(await win.webContents.capturePage()).toPNG());
win.setContentSize(390,740);await new Promise(r=>setTimeout(r,400));const overflow=await win.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth');if(overflow)throw new Error('Narrow layout overflows');fs.writeFileSync(${JSON.stringify(join(output,'narrow.png'))},(await win.webContents.capturePage()).toPNG());
await win.webContents.executeJavaScript("document.querySelector('[aria-label=\\\"Choose question\\\"]').click()");await new Promise(r=>setTimeout(r,150));const pickerFits=await win.webContents.executeJavaScript("(()=>{const r=document.querySelector('[data-question-picker]').closest('[data-anchored-menu-popover]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()");if(!pickerFits)throw new Error('Question picker overflows narrow viewport');fs.writeFileSync(${JSON.stringify(join(output,'picker-narrow.png'))},(await win.webContents.capturePage()).toPNG());await win.webContents.executeJavaScript("document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
await win.webContents.executeJavaScript("(()=>{const s=document.querySelector('select');s.value='rating';s.dispatchEvent(new Event('change',{bubbles:true}))})()");await new Promise(r=>setTimeout(r,400));await win.webContents.executeJavaScript("(()=>{const n=document.querySelector('input[type=number]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'7');n.dispatchEvent(new Event('input',{bubbles:true}))})()");await new Promise(r=>setTimeout(r,100));const rangeFits=await win.webContents.executeJavaScript("(()=>{const r=document.querySelector('[data-question-number-range]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&document.querySelector('input[type=number]').getBoundingClientRect().width<=80})()");if(!rangeFits)throw new Error('Bounded number control overflows narrow viewport');fs.writeFileSync(${JSON.stringify(join(output,'number-range-narrow.png'))},(await win.webContents.capturePage()).toPNG());
win.setContentSize(1100,820);await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Dark').click()");await new Promise(r=>setTimeout(r,350));fs.writeFileSync(${JSON.stringify(join(output,'number-range-dark.png'))},(await win.webContents.capturePage()).toPNG());
await win.webContents.executeJavaScript("(()=>{const s=document.querySelector('select');s.value='date';s.dispatchEvent(new Event('change',{bubbles:true}))})()");await new Promise(r=>setTimeout(r,400));await win.webContents.executeJavaScript("document.querySelector('[data-question-date-picker]').click()");await new Promise(r=>setTimeout(r,160));fs.writeFileSync(${JSON.stringify(join(output,'date-calendar-dark.png'))},(await win.webContents.capturePage()).toPNG());
win.setContentSize(390,740);await new Promise(r=>setTimeout(r,250));const calendarFits=await win.webContents.executeJavaScript("(()=>{const r=document.querySelector('[data-question-calendar]').closest('[data-anchored-menu-popover]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()");if(!calendarFits)throw new Error('Custom calendar overflows the narrow viewport');fs.writeFileSync(${JSON.stringify(join(output,'date-calendar-narrow.png'))},(await win.webContents.capturePage()).toPNG());await win.webContents.executeJavaScript("document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));const s=document.querySelector('select');s.value='rating';s.dispatchEvent(new Event('change',{bubbles:true}))");win.setContentSize(1100,820);await new Promise(r=>setTimeout(r,400));
win.setContentSize(390,740);const finishFits=await win.webContents.executeJavaScript("(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));const s=document.querySelector('select');s.value='all';s.dispatchEvent(new Event('change',{bubbles:true}));await sleep(400);document.querySelector('[aria-label=\\\"Choose question\\\"]').click();await sleep(120);document.querySelectorAll('[data-question-picker] button')[7].click();await sleep(250);[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Skip').click();await sleep(250);const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Finish questions'),r=b.getBoundingClientRect(),f=document.querySelector('[data-question-composer]').getBoundingClientRect();return !b.disabled&&r.left>=f.left&&r.right<=f.right-4})()");if(!finishFits)throw new Error('Finish questions action must fit the narrow review footer');fs.writeFileSync(${JSON.stringify(join(output,'finish-questions-narrow.png'))},(await win.webContents.capturePage()).toPNG());await win.webContents.executeJavaScript("(()=>{const s=document.querySelector('select');s.value='rating';s.dispatchEvent(new Event('change',{bubbles:true}))})()");win.setContentSize(1100,820);await new Promise(r=>setTimeout(r,400));
win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
const reduced=await win.webContents.executeJavaScript("(async()=>{document.querySelector('[aria-label=\\\"Minimize guided question\\\"]').click();await new Promise(r=>setTimeout(r,50));const body=document.querySelector('[data-question-tray] > [data-state]');return matchMedia('(prefers-reduced-motion: reduce)').matches && getComputedStyle(body).transitionProperty==='none' && body.getAttribute('data-state')==='closed' && [...document.querySelectorAll('[data-question-transition],[data-number-slider-fill],[data-number-slider-handle]')].every(node=>getComputedStyle(node).transitionProperty==='none')})()");if(!reduced)throw new Error('Reduced motion must disable tray transitions');
if(errors.length)throw new Error(errors.join('\\n'));console.log('PASS: smooth expand/collapse, reduced motion, dark, light, 390px layout without overflow or console errors');clearTimeout(timeout);
app.quit();
}).catch(e=>{console.error(e);app.exit(1)});`)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
try {
    process.exitCode = await new Promise((done, reject) => {
        const child = spawn(electron, [harness], { env, stdio: 'inherit', windowsHide: true })
        child.once('error', reject); child.once('exit', code => done(code ?? 1))
    })
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
