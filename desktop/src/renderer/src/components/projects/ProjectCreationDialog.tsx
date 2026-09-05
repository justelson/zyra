import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, Loader2, Plus, X } from 'lucide-react'
import type { AssistantProject } from '@shared/assistant/contracts'
import type { ProjectCreationOptions } from '@/lib/projects/project-creation-draft'
import { useProjectCreationForm } from '@/lib/projects/useProjectCreationForm'
import './project-creation.css'

export function ProjectCreationDialog({ options, onCreated, onClose }: {
    options: ProjectCreationOptions
    onCreated: (project: AssistantProject) => void
    onClose: () => void
}) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    const nameRef = useRef<HTMLInputElement>(null)
    const titleId = useId()
    const nameId = useId()
    const folderId = useId()
    const errorId = useId()
    const form = useProjectCreationForm(options, onCreated)
    const busy = form.busy !== null

    useEffect(() => {
        const dialog = dialogRef.current
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
        dialog?.showModal()
        nameRef.current?.focus()
        nameRef.current?.select()
        return () => {
            dialog?.close()
            if (previous?.isConnected) previous.focus()
        }
    }, [])

    return createPortal(
        <dialog
            ref={dialogRef}
            className="project-creation-dialog"
            aria-labelledby={titleId}
            aria-busy={busy}
            data-zyra-native-view-occluder="true"
            onKeyDown={(event) => event.stopPropagation()}
            onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}
            onClick={(event) => {
                if (event.target !== event.currentTarget || busy) return
                const bounds = event.currentTarget.getBoundingClientRect()
                if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
            }}
        >
            <form onSubmit={(event) => { event.preventDefault(); void form.submit() }}>
                <header className="project-creation-header">
                    <h2 id={titleId}>New project</h2>
                    <button type="button" className="project-creation-icon" onClick={onClose} disabled={busy} aria-label="Close project setup"><X size={18} /></button>
                </header>
                <div className="project-creation-body custom-scrollbar">
                    <label htmlFor={nameId}>Project name</label>
                    <input ref={nameRef} id={nameId} autoFocus value={form.name} onChange={(event) => form.setName(event.target.value)} maxLength={120} disabled={busy} placeholder="Name your project" autoComplete="off" />
                    <div className="project-creation-folder-heading"><h3>Folders involved</h3><span>Optional</span></div>
                    {form.folders.length > 0 ? (
                        <ul className="project-creation-folders custom-scrollbar" aria-label="Included folders">
                            {form.folders.map((path) => (
                                <li key={path}>
                                    <FolderOpen size={16} aria-hidden="true" />
                                    <span title={path}>{path}</span>
                                    <button type="button" className="project-creation-icon" aria-label={`Remove ${path}`} disabled={busy} onClick={() => form.removeFolder(path)}><X size={15} /></button>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    <label htmlFor={folderId} className="sr-only">Folder path</label>
                    <div className="project-creation-folder-input">
                        <input id={folderId} value={form.folderDraft} onChange={(event) => form.setFolderDraft(event.target.value)} disabled={busy} placeholder="Paste a folder path" autoComplete="off" onKeyDown={(event) => {
                            if (event.key === 'Enter') { event.preventDefault(); if (!busy && form.folderDraft.trim()) form.addFolder(form.folderDraft) }
                        }} />
                        <button type="button" className="project-creation-secondary" disabled={busy || !form.folderDraft.trim()} onClick={() => form.addFolder(form.folderDraft)}><Plus size={14} />Add</button>
                        <button type="button" className="project-creation-secondary" disabled={busy} onClick={() => void form.browse()}>{form.busy === 'browse' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}Browse</button>
                    </div>
                    {form.error ? <p id={errorId} role="alert" className="project-creation-error">{form.error}</p> : null}
                </div>
                <footer className="project-creation-footer">
                    <button type="button" className="project-creation-secondary" onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="submit" className="project-creation-primary" disabled={busy || !form.name.trim()} aria-describedby={form.error ? errorId : undefined}>
                        {form.busy === 'create' ? <><Loader2 size={14} className="animate-spin" />Creating...</> : 'Create project'}
                    </button>
                </footer>
            </form>
        </dialog>, document.body
    )
}
