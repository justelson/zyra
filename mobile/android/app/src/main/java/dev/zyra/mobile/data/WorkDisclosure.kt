package dev.zyra.mobile.data

/** Explicit reading/collapse intent survives live updates and completion. */
fun workDisclosureAfterUpdate(wasWorking: Boolean, working: Boolean, expanded: Boolean, explicitIntent: Boolean): Boolean = when {
    explicitIntent -> expanded
    !wasWorking && working -> true
    wasWorking && !working -> false
    else -> expanded
}
