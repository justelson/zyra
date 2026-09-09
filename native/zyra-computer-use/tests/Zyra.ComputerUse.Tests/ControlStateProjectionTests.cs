using System.Windows.Automation;
using Zyra.ComputerUse.UiAutomation;

internal static class ControlStateProjectionTests
{
    public static void Run()
    {
        Assert("enabled", UiAutomationProvider.ProjectControlStates(true, false, false, null, null, null));
        Assert("disabled,focused,offscreen,selected,checked,expanded", UiAutomationProvider.ProjectControlStates(false, true, true, true, ToggleState.On, ExpandCollapseState.Expanded));
        Assert("enabled,unselected,unchecked,collapsed", UiAutomationProvider.ProjectControlStates(true, false, false, false, ToggleState.Off, ExpandCollapseState.Collapsed));
        Assert("enabled,mixed,partially-expanded", UiAutomationProvider.ProjectControlStates(true, false, false, null, ToggleState.Indeterminate, ExpandCollapseState.PartiallyExpanded));
        Assert("enabled,leaf", UiAutomationProvider.ProjectControlStates(true, false, false, null, null, ExpandCollapseState.LeafNode));
        Assert("enabled", UiAutomationProvider.ProjectControlStates(true, false, false, null, (ToggleState)99, (ExpandCollapseState)99));
        foreach (var property in new[] { SelectionItemPattern.IsSelectedProperty, TogglePattern.ToggleStateProperty,
            ExpandCollapsePattern.ExpandCollapseStateProperty, AutomationElement.IsExpandCollapsePatternAvailableProperty })
            if (!UiAutomationProvider.ObservationProperties.Contains(property))
                throw new InvalidOperationException($"State property was not fetched in the bounded observation cache: {property.ProgrammaticName}");
        if (UiAutomationProvider.ObservationProperties.Contains(ValuePattern.ValueProperty))
            throw new InvalidOperationException("Adding state properties must not fetch sensitive values in the shared cache.");
    }

    private static void Assert(string expected, string[] actual)
    {
        if (string.Join(",", actual) != expected)
            throw new InvalidOperationException($"Expected states {expected}; got {string.Join(",", actual)}.");
    }
}
