import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const profileArgument = process.argv.find((argument) => argument.startsWith('--profile='))
const profileName = profileArgument?.slice('--profile='.length).trim() || 'Zyra-dev'
if (!/^zyra-dev(?:$|[-.][a-z0-9._-]+$)/i.test(profileName)) {
    throw new Error('Development Chat fixtures can only target a Zyra-dev profile name.')
}

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
const descriptorPath = path.join(appData, profileName, 'browser-assistant-bridge.json')
const timeoutAt = Date.now() + 30_000

function candidateOrigins(bridgePort) {
    const ports = [bridgePort - 10, ...Array.from({ length: 10 }, (_value, index) => 47_821 + index)]
    const uniquePorts = [...new Set(ports.filter((port) => Number.isInteger(port) && port > 0))]
    return uniquePorts.flatMap((port) => [
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`
    ])
}

async function readDescriptor() {
    const raw = await readFile(descriptorPath, 'utf8')
    const descriptor = JSON.parse(raw)
    if (
        descriptor?.host !== '127.0.0.1'
        || !Number.isInteger(descriptor?.port)
        || typeof descriptor?.capability !== 'string'
        || descriptor.capability.length < 32
    ) throw new Error('The Zyra-dev browser bridge descriptor is invalid.')
    return descriptor
}

async function invoke(descriptor, origin) {
    const response = await fetch(`http://${descriptor.host}:${descriptor.port}/v1/assistant/invoke`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            origin,
            'x-zyra-browser-client': 'assistant-v1',
            'x-zyra-browser-capability': descriptor.capability
        },
        body: JSON.stringify({ method: 'seedDevelopmentChatFixtures', args: [] }),
        signal: AbortSignal.timeout(5_000)
    })
    return response.json()
}

let lastError = null
while (Date.now() < timeoutAt) {
    try {
        const descriptor = await readDescriptor()
        for (const origin of candidateOrigins(descriptor.port)) {
            const result = await invoke(descriptor, origin)
            if (result?.error === 'Browser origin is not authorized.') continue
            if (!result?.ok) throw new Error(result?.error || 'The Zyra-dev bridge rejected fixture seeding.')
            if (!result.value?.success) throw new Error(result.value?.error || 'Zyra-dev could not seed Chat fixtures.')
            console.log('Development Chat fixtures seeded:')
            for (const fixture of result.value.fixtures || []) {
                console.log(`- ${fixture.title}: ${fixture.turns} turns, ${fixture.messages} messages, ${fixture.activities} actions`)
            }
            process.exit(0)
        }
        lastError = new Error('The active Zyra-dev client origin was not found.')
    } catch (error) {
        lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
}

throw new Error(`Could not seed the running ${profileName} instance within 30 seconds: ${lastError instanceof Error ? lastError.message : String(lastError || 'unknown error')}`)
