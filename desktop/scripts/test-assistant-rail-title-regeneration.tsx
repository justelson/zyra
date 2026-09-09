import assert from 'node:assert/strict'
import { createSessionActionMenuItems } from '../src/renderer/src/pages/assistant/assistant-sessions-rail-menus'
import { FileActionsMenuSecondaryAction } from '../src/renderer/src/components/ui/FileActionsMenuSecondaryAction'
const calls: string[] = []
const args = {session: {id: 'menu-chat'} as any, onOpenRename: (s: {id: string}) => calls.push(`rename:${s.id}`), onRegenerateTitle: (s: {id: string}) => {calls.push(`regenerate:${s.id}`)}, onArchiveSession: () => {}, onDeleteRequest: () => {}}
const rename = createSessionActionMenuItems(args).find(item => item.id === 'rename')!
assert.equal(rename.secondaryAction?.label, 'Regenerate chat title')
const button = FileActionsMenuSecondaryAction({action: rename.secondaryAction!, onClose: () => {calls.push('close')}})
button.props.onClick({stopPropagation: () => calls.push('stop')})
assert.deepEqual(calls, ['stop', 'close', 'regenerate:menu-chat'], 'the secondary action closes the menu and targets its chat without triggering manual rename')
rename.onSelect()
assert.equal(calls.at(-1), 'rename:menu-chat')
const busy = createSessionActionMenuItems({...args, session: {...args.session, titleGenerating: true}}).find(item => item.id === 'rename')!
assert.equal(FileActionsMenuSecondaryAction({action: busy.secondaryAction!, onClose: () => {}}).props.disabled, true)
assert.equal(createSessionActionMenuItems({...args, archived: true}).some(item => item.secondaryAction), false)
console.log('assistant rail title regeneration passed')
