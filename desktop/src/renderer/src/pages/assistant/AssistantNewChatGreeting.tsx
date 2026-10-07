export function AssistantNewChatGreeting({ prompt }: { prompt: string | null | undefined }) {
    return <div className="pointer-events-none mb-5 px-2 text-center">
        <p
            className="mx-auto max-w-[680px] text-[30px] font-medium leading-[1.08] tracking-[-0.035em] text-sparkle-text/90"
            data-assistant-new-chat-prompt="true"
            style={{ fontFamily: 'var(--font-ui, "Bricolage Grotesque", "Hanken Grotesk", system-ui, sans-serif)' }}
        >{prompt || ''}</p>
    </div>
}
