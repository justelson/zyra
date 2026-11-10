import { installToolMailbox } from './tool-mailbox.js';

/** Owned native services stay isolated; Zyra's tools use the canonical executor. */
export default {
  id: 'zyra.managed-harness',
  async setup(ctx) {
    await ctx.mcp.transform(editor => {
      for (const [name] of editor.list()) editor.update(name, server => { server.disabled = true; });
    });
    return installToolMailbox(ctx);
  },
};
