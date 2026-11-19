// Profile-local raster store. Keep bytes out of synchronized preferences and receipts.
const MAX_INPUT = 12 * 1024 * 1024
async function openAssets(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('zyra-chat-wallpapers', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('images')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}
export async function importChatWallpaper(file: File): Promise<string> {
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || !file.size || file.size > MAX_INPUT) throw Error('Choose a PNG, JPEG or WebP under 12 MB.')
    const bitmap = await createImageBitmap(file)
    let blob: Blob
    try {
        const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        const ctx = canvas.getContext('2d'); if (!ctx) throw Error('Image decoding unavailable.')
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        blob = await new Promise<Blob>((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('Could not save this image.')), 'image/png'))
    } finally { bitmap.close() }
    const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    const id = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
    const db = await openAssets()
    try { await new Promise<void>((resolve,reject) => {
        const tx = db.transaction('images','readwrite'); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.objectStore('images').put(blob, id)
    }) } finally { db.close() }
    return id
}
export async function getChatWallpaper(id: string): Promise<Blob | undefined> {
    if (!/^[a-f0-9]{64}$/.test(id)) return undefined
    const db = await openAssets()
    try { return await new Promise<Blob | undefined>((resolve,reject) => {
        const request = db.transaction('images').objectStore('images').get(id)
        request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : undefined)
    }) } finally { db.close() }
}
