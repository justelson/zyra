/** V2 equivalent of the owned V1 MCP config hook. No SDK/package dependency. */
export default {
  id: 'zyra.managed-harness',
  async setup(ctx) {
    await ctx.mcp.transform(editor => {
      for (const [name] of editor.list()) editor.update(name, server => { server.disabled = true; });
    });
  },
};
