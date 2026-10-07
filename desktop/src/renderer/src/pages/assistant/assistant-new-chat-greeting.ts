export function getAssistantNewChatGreeting(projectLabel: string, hour = new Date().getHours(), choice = Math.random()): string {
    const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
    const prompts = projectLabel ? [
        `${timeGreeting}. What are we shaping in ${projectLabel}?`,
        `Ready to open up ${projectLabel}?`,
        `What needs attention in ${projectLabel}?`,
        `Where should we start in ${projectLabel}?`,
        `What are we making better in ${projectLabel}?`
    ] : [
        `${timeGreeting}. What are we working on?`,
        'What are we opening up first?',
        'Bring me the bug, the idea, or the messy bit.',
        'What are we figuring out today?',
        'Tell me what changed, broke, or needs building.'
    ]
    return prompts[Math.min(prompts.length - 1, Math.max(0, Math.floor(choice * prompts.length)))]
}
