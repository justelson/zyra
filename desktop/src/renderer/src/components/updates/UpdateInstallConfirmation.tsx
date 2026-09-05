import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw } from 'lucide-react'
import { useAppUpdates } from '@/lib/app-updates'
import './update-install-confirmation.css'

function RestartDialog({ version, onCancel, onConfirm }: { version: string; onCancel: () => void; onConfirm: () => void }) {
    const ref = useRef<HTMLDialogElement>(null)
    const titleId = useId()
    const descriptionId = useId()
    useEffect(() => {
        const dialog = ref.current
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const overflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        dialog?.showModal()
        return () => {
            dialog?.close()
            document.body.style.overflow = overflow
            if (previous?.isConnected) previous.focus()
        }
    }, [])
    return createPortal(<dialog ref={ref} className="update-install-confirmation" aria-labelledby={titleId} aria-describedby={descriptionId}
        onCancel={(event) => { event.preventDefault(); onCancel() }}
        onClick={(event) => {
            if (event.target !== event.currentTarget) return
            const bounds = event.currentTarget.getBoundingClientRect()
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onCancel()
        }}>
        <div className="update-install-confirmation-body">
            <h2 id={titleId}>Restart to install?</h2>
            <p id={descriptionId}>Zyra will close and restart to install v{version}. Save any unsent messages or unsaved work before continuing.</p>
        </div>
        <footer>
            <button type="button" onClick={onCancel} autoFocus>Not now</button>
            <button type="button" className="update-install-confirm" onClick={onConfirm}><RefreshCw size={14} aria-hidden="true" />Restart and install</button>
        </footer>
    </dialog>, document.body)
}

export function UpdateInstallConfirmation() {
    const { installConfirmationVersion, cancelInstallUpdate, confirmInstallUpdate } = useAppUpdates()
    return installConfirmationVersion ? <RestartDialog key={installConfirmationVersion} version={installConfirmationVersion} onCancel={cancelInstallUpdate} onConfirm={() => { void confirmInstallUpdate() }} /> : null
}
