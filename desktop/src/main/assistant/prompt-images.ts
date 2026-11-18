import { detectPromptImageMimeType as detectAssistantPromptImageMimeType } from '../../../../src/prompt-images.mjs'
export { detectAssistantPromptImageMimeType }
import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import type { AssistantPromptImageInput } from '../../shared/assistant/contracts'

export const MAX_ASSISTANT_PROMPT_IMAGES = 12
export const MAX_ASSISTANT_PROMPT_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_ASSISTANT_PROMPT_IMAGE_TOTAL_BYTES = 40 * 1024 * 1024

export type PreparedAssistantPromptImage = {
    type: 'image'
    data: string
    mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
}

type PrepareAssistantPromptImagesOptions = {
    resolveClipboardAttachment?: (reference: string) => Promise<string | null>
}

function isClipboardReference(value: string): boolean {
    return value.toLowerCase().startsWith('clipboard://')
}

function imageLabel(image: AssistantPromptImageInput, index: number): string {
    const named = String(image.name || '').trim()
    if (named) return named
    const reference = String(image.path || '').trim()
    if (isClipboardReference(reference)) return 'Pasted image'
    return basename(reference) || `Image ${index + 1}`
}

async function resolveImagePath(
    image: AssistantPromptImageInput,
    index: number,
    options: PrepareAssistantPromptImagesOptions
): Promise<string> {
    const reference = String(image.path || '').trim()
    const label = imageLabel(image, index)
    if (!reference) throw new Error(`${label} has no readable file reference. Attach it again.`)

    if (isClipboardReference(reference)) {
        const resolveAttachment = options.resolveClipboardAttachment
            ?? (await import('./clipboard-attachments')).resolveAssistantClipboardAttachment
        const resolved = await resolveAttachment(reference)
        if (!resolved) throw new Error(`${label} is no longer available. Paste it again.`)
        return resolved
    }

    if (!isAbsolute(reference)) {
        throw new Error(`${label} does not have an absolute local path. Attach it again.`)
    }
    return reference
}

export async function prepareAssistantPromptImages(
    images: AssistantPromptImageInput[] | undefined,
    options: PrepareAssistantPromptImagesOptions = {}
): Promise<PreparedAssistantPromptImage[]> {
    if (!images?.length) return []
    if (images.length > MAX_ASSISTANT_PROMPT_IMAGES) {
        throw new Error(`Attach at most ${MAX_ASSISTANT_PROMPT_IMAGES} images per message.`)
    }

    const prepared: PreparedAssistantPromptImage[] = []
    const seenPaths = new Set<string>()
    let totalBytes = 0

    for (let index = 0; index < images.length; index += 1) {
        const image = images[index]
        if (!image) continue
        const label = imageLabel(image, index)
        const imagePath = await resolveImagePath(image, index, options)
        const pathKey = process.platform === 'win32' ? imagePath.toLowerCase() : imagePath
        if (seenPaths.has(pathKey)) continue
        seenPaths.add(pathKey)

        let imageStat
        try {
            imageStat = await stat(imagePath)
        } catch {
            throw new Error(`${label} is no longer available. Attach it again.`)
        }
        if (!imageStat.isFile()) throw new Error(`${label} is not a readable image file.`)
        if (imageStat.size <= 0) throw new Error(`${label} is empty.`)
        if (imageStat.size > MAX_ASSISTANT_PROMPT_IMAGE_BYTES) {
            throw new Error(`${label} is larger than 20 MB. Use a smaller image.`)
        }
        totalBytes += imageStat.size
        if (totalBytes > MAX_ASSISTANT_PROMPT_IMAGE_TOTAL_BYTES) {
            throw new Error('The attached images exceed the 40 MB message limit.')
        }

        let bytes: Buffer
        try {
            bytes = await readFile(imagePath)
        } catch {
            throw new Error(`${label} could not be read. Attach it again.`)
        }
        if (bytes.length > MAX_ASSISTANT_PROMPT_IMAGE_BYTES) {
            throw new Error(`${label} is larger than 20 MB. Use a smaller image.`)
        }
        const mimeType = detectAssistantPromptImageMimeType(bytes)
        if (!mimeType) {
            throw new Error(`${label} is not a supported PNG, JPEG, GIF, or WebP image.`)
        }

        prepared.push({
            type: 'image',
            data: bytes.toString('base64'),
            mimeType
        })
    }

    return prepared
}
