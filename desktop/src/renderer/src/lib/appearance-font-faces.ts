import type { AppearanceFontResource } from './appearance-font-data'

/** Programmatic appearance faces are shared with same-origin UI documents, not reloaded. */
export const APPEARANCE_FONT_FACES_CHANGED_EVENT = 'zyra:appearance-font-faces-changed'

const managedFaces = new WeakMap<Document, Set<FontFace>>()
const resources = new WeakMap<Document, Map<string, { resource: AppearanceFontResource; faces: Set<FontFace> }>>()
const emptyFaces: ReadonlySet<FontFace> = new Set()

export function getAppearanceManagedFontFaces(owner: Document): ReadonlySet<FontFace> {
    return managedFaces.get(owner) ?? emptyFaces
}

export function getAppearanceFontResource(owner: Document, fontStack: string): AppearanceFontResource | undefined {
    const current = resources.get(owner)
    if (!current) return undefined
    for (const match of fontStack.matchAll(/\s*(?:"([^"]*)"|'([^']*)'|([^,]+))\s*(?:,|$)/g)) {
        const family = (match[1] ?? match[2] ?? match[3] ?? '').trim().toLowerCase()
        const found = current.get(family)
        if (found) return found.resource
    }
    return undefined
}

export function addAppearanceManagedFontFaces(owner: Document, faces: readonly FontFace[], resource?: AppearanceFontResource): void {
    let current = managedFaces.get(owner)
    if (!current) managedFaces.set(owner, current = new Set())
    for (const face of faces) {
        owner.fonts.add(face)
        current.add(face)
    }
    if (resource) {
        let currentResources = resources.get(owner)
        if (!currentResources) resources.set(owner, currentResources = new Map())
        currentResources.set(resource.family.toLowerCase(), { resource, faces: new Set(faces) })
    }
    owner.defaultView?.dispatchEvent(new Event(APPEARANCE_FONT_FACES_CHANGED_EVENT))
}

export function removeAppearanceManagedFontFaces(owner: Document, faces: readonly FontFace[]): void {
    const current = managedFaces.get(owner)
    for (const face of faces) {
        owner.fonts.delete(face)
        current?.delete(face)
    }
    if (!current?.size) managedFaces.delete(owner)
    const currentResources = resources.get(owner)
    for (const [family, entry] of currentResources ?? []) {
        for (const face of faces) entry.faces.delete(face)
        if (!entry.faces.size) currentResources!.delete(family)
    }
    if (!currentResources?.size) resources.delete(owner)
    owner.defaultView?.dispatchEvent(new Event(APPEARANCE_FONT_FACES_CHANGED_EVENT))
}
