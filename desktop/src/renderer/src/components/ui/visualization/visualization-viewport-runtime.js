// Natural-height frames have an output height, not a CSS viewport input.
// Keep authored viewport lengths and size media queries on the original height
// hint while width stays live. Ordinary content remains free to grow/shrink.
const nameCharacter = character => character && /[\w\-\u0080-\uffff]/.test(character)
function identifierEnd(text, start) {
    let end = start
    while (end < text.length) {
        if (nameCharacter(text[end])) end++
        else if (text[end] === '\\') {
            end++
            const hexadecimal = text.slice(end).match(/^[\da-f]{1,6}\s?/i)
            end += hexadecimal ? hexadecimal[0].length : Math.min(1, text.length - end)
        } else break
    }
    return end
}
function stringEnd(text, start) {
    const quote = text[start]
    let end = start + 1
    while (end < text.length) {
        if (text[end] === '\\') end += 2
        else if (text[end++] === quote) break
    }
    return end
}
const decodedName = text => text.replace(/\\([\da-f]{1,6})\s?|\\([^\r\n])/gi, (_, hexadecimal, character) => hexadecimal ? String.fromCodePoint(Math.min(0x10ffff, parseInt(hexadecimal, 16)) || 0xfffd) : character).toLowerCase()

// Tokenize dimensions, leaving identifiers, quoted text, comments and URLs
// intact. Custom properties, calc(), keyframes and escaped units all survive.
export function resolveViewportDimensions(text, viewport, mediaFontSize) {
    const factors = { vh: viewport.height, vw: viewport.width,
        vi: viewport.vertical ? viewport.height : viewport.width,
        vb: viewport.vertical ? viewport.width : viewport.height,
        vmin: Math.min(viewport.width, viewport.height), vmax: Math.max(viewport.width, viewport.height) }
    let output = ''
    for (let index = 0; index < text.length;) {
        let end = index + 1
        if (text[index] === '"' || text[index] === "'") end = stringEnd(text, index)
        else if (text.startsWith('/*', index)) {
            const close = text.indexOf('*/', index + 2)
            end = close < 0 ? text.length : close + 2
        } else {
            const number = text.slice(index).match(/^[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?/i)
            if (number) {
                end = index + number[0].length
                const unitEnd = identifierEnd(text, end)
                const unit = decodedName(text.slice(end, unitEnd))
                const baseUnit = unit.replace(/^[sld](?=v)/, '')
                const factor = Object.hasOwn(factors, baseUnit) ? factors[baseUnit] : undefined
                if (factor !== undefined || mediaFontSize && (unit === 'em' || unit === 'rem')) {
                    const pixels = Number(number[0]) * (factor === undefined ? mediaFontSize : factor / 100)
                    if (Number.isFinite(pixels)) { output += `${pixels}px`; index = unitEnd; continue }
                }
                end = unitEnd
            } else if (nameCharacter(text[index]) || text[index] === '\\') {
                end = identifierEnd(text, index)
                if (decodedName(text.slice(index, end)) === 'url' && text[end] === '(') {
                    end++
                    while (end < text.length) {
                        if (text[end] === '"' || text[end] === "'") end = stringEnd(text, end)
                        else if (text[end] === '\\') end += 2
                        else if (text[end++] === ')') break
                    }
                }
            }
        }
        output += text.slice(index, end)
        index = end
    }
    return output
}

function groupEnd(text, start) {
    let depth = 1
    for (let index = start + 1; index < text.length; index++) {
        if (text[index] === '"' || text[index] === "'") index = stringEnd(text, index) - 1
        else if (text[index] === '(') depth++
        else if (text[index] === ')' && --depth === 0) return index
    }
    return text.length - 1
}
function sizeFeature(text) {
    // Only top-level feature names count; boolean combinations are traversed
    // recursively, and native evaluation remains for preferences/media types.
    let top = ''
    for (let index = 0; index < text.length; index++) {
        if (text[index] === '(') { index = groupEnd(text, index); top += ' ' }
        else if (text[index] === '"' || text[index] === "'") index = stringEnd(text, index) - 1
        else top += text[index]
    }
    return /^\s*(?:(?:min|max)-)?(?:width|height|aspect-ratio|orientation)(?:\s*[:<>=]|\s*$)/i.test(top)
        || /[<>=]\s*(?:width|height|aspect-ratio)(?:\s*[<>=]|\s*$)/i.test(top)
}
function resolveSizeMedia(query, matches) {
    let output = ''
    for (let index = 0; index < query.length; index++) {
        if (query[index] === '"' || query[index] === "'") {
            const end = stringEnd(query, index); output += query.slice(index, end); index = end - 1
        } else if (query[index] === '(') {
            const end = groupEnd(query, index)
            const body = query.slice(index + 1, end)
            output += sizeFeature(body) ? matches(`(${body})`) ? '(min-width: 0px)' : '(max-width: -1px)' : `(${resolveSizeMedia(body, matches)})`
            index = end
        } else output += query[index]
    }
    return output
}

export function installStableVisualizationViewport(content, referenceHeight) {
    const doc = content.ownerDocument
    const view = doc.defaultView
    const height = Number.isFinite(referenceHeight) && referenceHeight > 0 ? referenceHeight : 320
    const styles = []
    const inline = []
    const attributes = []
    let lastWidth = -1
    let lastVertical = false
    let probe
    let probeStyle
    let probeResult
    const ensureProbe = width => {
        if (!probe) {
            probe = doc.createElement('div')
            for (const [name, value] of Object.entries({ all: 'initial', position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden', 'pointer-events': 'none', contain: 'strict', 'container-type': 'size', 'container-name': 'zyra-viewport-probe' })) probe.style.setProperty(name, value, 'important')
            const shadow = probe.attachShadow({ mode: 'closed' })
            probeStyle = doc.createElement('style')
            probeResult = doc.createElement('span')
            shadow.append(probeStyle, probeResult)
            doc.body.append(probe)
        }
        probe.style.setProperty('width', `${width}px`, 'important')
        probe.style.setProperty('height', `${height}px`, 'important')
    }
    const normalizeStyle = (source, viewport) => {
        const dimensions = resolveViewportDimensions(source, viewport)
        if (dimensions === source && !/@media[\s\S]*(?:width|height|aspect-ratio|orientation)/i.test(source)) return source
        const sheet = new CSSStyleSheet()
        sheet.replaceSync(dimensions)
        let changed = dimensions !== source
        const cache = new Map()
        const matches = feature => {
            if (cache.has(feature)) return cache.get(feature)
            ensureProbe(viewport.width)
            // MQ em/rem use the initial font, not an authored root font size.
            const condition = resolveViewportDimensions(feature, viewport, parseFloat(view.getComputedStyle(probe).fontSize))
            probeStyle.textContent = `span{--zyra-matches:0}@container zyra-viewport-probe ${condition}{span{--zyra-matches:1}}`
            const result = view.getComputedStyle(probeResult).getPropertyValue('--zyra-matches').trim() === '1'
            cache.set(feature, result)
            return result
        }
        const visit = rules => {
            for (const rule of rules) {
                if (rule instanceof CSSMediaRule) {
                    const query = resolveSizeMedia(rule.conditionText, matches)
                    if (query !== rule.conditionText) { rule.media.mediaText = query; changed = true }
                }
                if ('cssRules' in rule) visit(rule.cssRules)
            }
        }
        visit(sheet.cssRules)
        return changed ? [...sheet.cssRules].map(rule => rule.cssText).join('\n') : source
    }
    const viewport = () => ({ width: view.innerWidth, height, vertical: /^(?:vertical|sideways)/.test(view.getComputedStyle(doc.documentElement).writingMode) })
    const initial = viewport()
    // Snapshot only affected authored inputs. App fonts and ordinary styles
    // stay untouched and aren't retained/reparsed on width updates.
    for (const node of doc.querySelectorAll('style')) {
        const source = node.textContent
        const next = normalizeStyle(source, initial)
        if (next !== source) { styles.push({ node, source }); node.textContent = next }
    }
    for (const node of content.querySelectorAll('[style]')) {
        const source = node.getAttribute('style')
        const next = resolveViewportDimensions(source, initial)
        if (next !== source) { inline.push({ node, source }); node.setAttribute('style', next) }
    }
    for (const node of content.querySelectorAll('svg,svg *')) for (const name of ['width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'font-size', 'stroke-width']) {
        const source = node.getAttribute(name)
        if (!source) continue
        const next = resolveViewportDimensions(source, initial)
        if (next !== source) { attributes.push({ node, name, source }); node.setAttribute(name, next) }
    }
    const apply = nextViewport => {
        for (const { node, source } of styles) node.textContent = normalizeStyle(source, nextViewport)
        for (const { node, source } of inline) node.setAttribute('style', resolveViewportDimensions(source, nextViewport))
        for (const { node, name, source } of attributes) node.setAttribute(name, resolveViewportDimensions(source, nextViewport))
    }
    const refresh = () => {
        const nextViewport = viewport()
        if (nextViewport.width === lastWidth && nextViewport.vertical === lastVertical) return
        lastWidth = nextViewport.width
        lastVertical = nextViewport.vertical
        apply(nextViewport)
        const resolved = viewport()
        if (resolved.vertical !== lastVertical) { lastVertical = resolved.vertical; apply(resolved) }
    }
    lastWidth = initial.width
    lastVertical = initial.vertical
    refresh()
    return refresh
}
