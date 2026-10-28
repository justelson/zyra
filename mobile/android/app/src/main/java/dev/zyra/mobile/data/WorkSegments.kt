package dev.zyra.mobile.data

/** Mirrors Desktop groupConsecutiveActionRows: narration and questions separate
 * runs; invisible provider call envelopes do not. A run can mix tool families. */
sealed interface WorkSegment {
    data class Actions(val actions: List<WorkAction>) : WorkSegment
    data class Content(val item: TimelineItem) : WorkSegment
}

fun workSegments(group: ChatRailRow.Work): List<WorkSegment> = workSegments(group, true, true)

fun workSegments(group: ChatRailRow.Work, showThoughtProcesses: Boolean, showQuestions: Boolean): List<WorkSegment> {
    val actions = group.actions.associateBy { it.item.id }
    val result = mutableListOf<WorkSegment>()
    for (item in group.entries) {
        val action = actions[item.id]
        if (action != null) {
            val previous = result.lastOrNull() as? WorkSegment.Actions
            if (previous != null && !action.isToolDiscovery && previous.actions.none { it.isToolDiscovery }) result[result.lastIndex] = WorkSegment.Actions(previous.actions + action)
            else result.add(WorkSegment.Actions(listOf(action)))
        } else if (if (item.kind == "user_input_requested") showQuestions
            else item.kind != "resolved" && (item.text.isNotBlank() || showThoughtProcesses && item.reasoning.isNotBlank())) {
            result.add(WorkSegment.Content(item))
        }
    }
    return result
}

fun workSegmentTitle(actions: List<WorkAction>): String = workSegmentTitle(actions, running = true)

fun workSegmentTitle(actions: List<WorkAction>, running: Boolean): String =
    actions.lastOrNull { running && it.item.pending }?.title
        ?: actions.asReversed().firstNotNullOfOrNull { it.batch?.takeIf(String::isNotBlank) }
        ?: actions.lastOrNull()?.title.orEmpty()
