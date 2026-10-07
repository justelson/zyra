import { Children, cloneElement, isValidElement, type ReactNode } from 'react'
import type { Components } from 'react-markdown'

// A link owns its icon, interaction and outline. Code used as its label keeps
// its font without becoming a second clickable file tag or nested code box.
export function renderMarkdownLinkLabel(children: ReactNode, codeRenderer: Components['code']): ReactNode {
    return Children.map(children, child => {
        if (!isValidElement<{ children?: ReactNode }>(child)) return child
        if (child.type === 'code' || child.type === codeRenderer) {
            return <span className="font-mono">{child.props.children}</span>
        }
        if (child.props.children === undefined) return child
        return cloneElement(child, {}, renderMarkdownLinkLabel(child.props.children, codeRenderer))
    })
}
