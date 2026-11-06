import { useLayoutEffect, useRef } from 'react'

/** Update only the changed suffix so incoming chunks retain text selections. */
export function AssistantTerminalOutputText({ text }: { text: string }) {
    const elementRef = useRef<HTMLSpanElement>(null)
    const initialText = useRef(text)
    useLayoutEffect(() => {
        const element = elementRef.current
        if (!element) return
        const node = element.firstChild
        if (!(node instanceof Text)) {
            element.append(document.createTextNode(text))
            return
        }
        const previous = node.data
        if (previous === text) return
        if (text.startsWith(previous)) {
            node.appendData(text.slice(previous.length))
            return
        }
        let prefix = 0
        while (prefix < previous.length && prefix < text.length && previous[prefix] === text[prefix]) prefix++
        node.replaceData(prefix, previous.length - prefix, text.slice(prefix))
    }, [text])
    // React owns the initial/SSR text; later updates preserve its Text node.
    return <span ref={elementRef}>{initialText.current}</span>
}
