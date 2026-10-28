import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const ReadPreviewSelection = createContext<{ activityId: string | null; select: (id: string | null) => void } | null>(null)

/** One read preview per visible action list; an older lazy reply cannot replace a later selection. */
export function AssistantReadPreviewScope({ children, owner = '' }: { children: ReactNode; owner?: string }) {
    const parent = useContext(ReadPreviewSelection)
    const [selected, setSelected] = useState<{ owner: string; id: string | null }>({ owner, id: null })
    const inherited = Boolean(parent)
    useEffect(() => { if (!inherited) setSelected({ owner, id: null }) }, [owner, inherited])
    const selection = useMemo(() => parent || ({ activityId: selected.owner === owner ? selected.id : null, select: (id: string | null) => setSelected({ owner, id }) }), [parent, selected, owner])
    return <ReadPreviewSelection.Provider value={selection}>{children}</ReadPreviewSelection.Provider>
}

export function useAssistantReadPreviewSelection() {
    const shared = useContext(ReadPreviewSelection)
    const [activityId, select] = useState<string | null>(null)
    return shared || { activityId, select }
}
