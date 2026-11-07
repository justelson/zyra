import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

function resolveExistingAncestor(target) {
  let existing = path.resolve(target);
  while (!existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
  return path.resolve(realpathSync(existing), path.relative(existing, target));
}

export function assertOutsideProfile(target, profile) {
  for (const [candidate, owner] of [[target, profile], [resolveExistingAncestor(target), resolveExistingAncestor(profile)]]) {
    const relative = path.relative(owner, candidate);
    if (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) {
      throw new Error('Benchmark output and synthetic project must be outside the Preview profile.');
    }
  }
}

/** Match SDK instruction ancestry without reading instruction contents. */
export function assertInstructionFreeProject(project) {
  const roots = new Set([path.resolve(project), resolveExistingAncestor(project)]);
  for (const root of roots) {
    let current = root;
    while (true) {
      if (existsSync(path.join(current, 'AGENTS.md')) || existsSync(path.join(current, 'AGENTS.override.md'))) {
        throw new Error('Synthetic project has inherited instructions. Choose --project in an instruction-free scratch location. No model request was sent.');
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
}
