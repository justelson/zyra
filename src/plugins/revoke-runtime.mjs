// Separate from ordinary abort/disconnect: Plugin authority loss retires all work
// which may have consumed the old Skill instructions, including background jobs.
export async function revokePluginRuntime(runtime, reason = 'Chat Plugin authority revoked.') {
  const tasks = [
    () => runtime?.session?.clearQueue?.(),
    () => runtime?.session?.abortCompaction?.(),
    () => runtime?.managedBash?.abortAll?.(reason),
    () => runtime?.session?.abort?.(),
    () => runtime?.fleet?.dispose?.()
  ];
  const results = await Promise.allSettled(tasks.map(async (task) => task()));
  const jobs = [...(runtime?.managedBash?.jobs?.values?.() || [])];
  results.push(...await Promise.allSettled(jobs.map((job) => job.done)));
  const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
  if (errors.length) throw new AggregateError(errors, 'Plugin revocation cleanup failed.');
}
