import type { NavigateFunction } from 'react-router-dom'
import { getAssistantChatNavigationCurrentId, getAssistantChatNavigationSnapshot, selectAssistantChatNavigationTarget } from './assistant-chat-navigation'

export function cycleAssistantChat(direction: 1 | -1, navigate?: NavigateFunction): boolean {
    const ids = getAssistantChatNavigationSnapshot().targetIds
    if (!ids.length) return false
    const current = getAssistantChatNavigationCurrentId()
    const index = current ? ids.indexOf(current) : -1
    if (ids.length === 1 && index === 0) return false
    const nextIndex = index < 0 ? (direction > 0 ? 0 : ids.length - 1) : (index + direction + ids.length) % ids.length
    const next = ids[nextIndex]
    return !!next && selectAssistantChatNavigationTarget(next, navigate)
}

export function selectAssistantChatAt(index: number, navigate?: NavigateFunction): boolean {
    if (!Number.isInteger(index) || index < 0) return false
    const id = getAssistantChatNavigationSnapshot().targetIds[index]
    return !!id && selectAssistantChatNavigationTarget(id, navigate)
}
