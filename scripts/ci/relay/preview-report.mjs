export const PREVIEW_COMMENT_MARKER = '<!-- zyra-ci-relay:windows-preview -->'

export function previewComment(record, run, artifact, repository) {
    const url = `https://github.com/${repository}/actions/runs/${run.id}`
    const download = `${url}/artifacts/${artifact.id}`
    return `${PREVIEW_COMMENT_MARKER}\nWindows **dev channel** preview for \`${record.sha}\`: [download installer ZIP](${download}).\n\nUnsigned. Install **Zyra Preview** beside stable; this is the dev channel. The ZIP includes source provenance and SHA256SUMS; the [build summary](${url}) shows the installer checksum. GitHub login is required. The link expires after seven days; the installed app does not expire. No stable release was published.`
}

// Always discover before writing, including after a lost POST response. Only
// this App's marked comment is editable; a contributor cannot forge ownership.
export async function upsertPreviewComment(api, env, record, body, stillCurrent) {
    let existing
    for (let page = 1; ; page++) {
        const comments = await api.request('source', `/issues/${record.pr}/comments?per_page=100&page=${page}`)
        existing = comments.find(comment => comment.body?.startsWith(PREVIEW_COMMENT_MARKER) &&
            String(comment.performed_via_github_app?.id) === String(env.GITHUB_APP_ID))
        if (existing || comments.length < 100) break
    }
    // Listing comments may be slow. Recheck the head and newest request before
    // publishing a link, rather than relying on eligibility from before lookup.
    if (!await stillCurrent()) return { skipped: true }
    if (existing?.body === body) return { commentId: existing.id }
    const comment = existing
        ? await api.request('source', `/issues/comments/${existing.id}`, 'PATCH', { body })
        : await api.request('source', `/issues/${record.pr}/comments`, 'POST', { body })
    return { commentId: comment.id }
}
