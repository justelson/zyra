type MobileListener = { listen(host: string, port: number): Promise<{ port: number }> }

export async function listenForMobile(gateway: MobileListener, host: string, port: number): Promise<{ port: number }> {
    try {
        return await gateway.listen(host, port)
    } catch (error) {
        if (port === 0 || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
        // Another profile owns this port. Keep its listener and our device store separate.
        return gateway.listen(host, 0)
    }
}
