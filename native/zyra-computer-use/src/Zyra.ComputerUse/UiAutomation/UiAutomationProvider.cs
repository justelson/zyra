using System.Text.Json;
using System.Windows.Automation;
using Zyra.ComputerUse.Protocol;
using Zyra.ComputerUse.Windows;

namespace Zyra.ComputerUse.UiAutomation;

public sealed class UiAutomationProvider
{
    private const int MaxElements = 1500;
    private readonly Dictionary<string, AutomationElement> _elementRefs = new(StringComparer.Ordinal);

    public WindowObservation Observe(WindowHandleEntry window, int revision)
    {
        _elementRefs.Clear();
        var elements = new List<NormalizedElement>();
        var redactions = new HashSet<string>(StringComparer.Ordinal) { "password-values", "sensitive-control-values" };
        try
        {
            var root = AutomationElement.FromHandle(window.Handle) ?? throw new InvalidOperationException("UI Automation could not bind the selected window.");
            var branchCache = CreateObservationCache(includeChildren: true);
            var leafCache = CreateObservationCache(includeChildren: false);
            var queue = new Queue<(AutomationElement Element, string Path, int Depth)>();
            queue.Enqueue((root, "0", 0));
            while (queue.Count > 0 && elements.Count < MaxElements)
            {
                var (queuedElement, path, depth) = queue.Dequeue();
                // Fetch one bounded parent snapshot instead of making a remote
                // property/pattern call for every field and sibling. Live refs
                // remain available for later revision-checked actions.
                var element = queuedElement.GetUpdatedCache(depth < 24 ? branchCache : leafCache);
                var current = element.Cached;
                var role = ControlTypeName(current.ControlType);
                var name = current.Name?.Trim() ?? string.Empty;
                var automationId = current.AutomationId?.Trim() ?? string.Empty;
                var sensitive = current.IsPassword || ContainsSensitive(name) || ContainsSensitive(automationId);
                var reference = $"window-element:{revision}:{path}";
                _elementRefs[reference] = element;
                elements.Add(new NormalizedElement(
                    reference,
                    role,
                    Limit(name, 512),
                    sensitive ? null : Limit(ReadSafeValue(element), 2048),
                    sensitive ? null : Limit(current.HelpText, 2048),
                    ReadBounds(current.BoundingRectangle),
                    ReadStates(element, current),
                    ReadCachedActions(element),
                    sensitive));
                if (depth >= 24 || elements.Count >= MaxElements) continue;
                var children = element.CachedChildren;
                for (var index = 0; index < Math.Min(children.Count, 256); index++)
                    queue.Enqueue((children[index], $"{path}.{index}", depth + 1));

            }
            return BoundObservation(
                "ready",
                WindowRegistry.ReadWindowTitle(window.Handle),
                elements,
                elements.FirstOrDefault(element => element.States.Contains("focused"))?.ElementRef,
                elements.Count >= MaxElements ? elements.Count + 1 : elements.Count,
                redactions);
        }
        catch (Exception error)
        {
            _elementRefs.Clear();
            elements.Clear();
            redactions.Add($"uia-unavailable:{Limit(error.Message, 120)}");
            return BoundObservation("blocked", WindowRegistry.ReadWindowTitle(window.Handle), elements, null, elements.Count, redactions);
        }
    }

    public bool TryAct(SidecarAction action, int revision)
    {
        if (action.ElementRef is null) return false;
        if (!action.ElementRef.StartsWith($"window-element:{revision}:", StringComparison.Ordinal) || !_elementRefs.TryGetValue(action.ElementRef, out var element))
            throw new InvalidOperationException("The UI Automation element reference is stale.");
        try
        {
            switch (action.Type)
            {
                case "click":
                    if (TryPattern<InvokePattern>(element, InvokePattern.Pattern, out var invoke)) { invoke.Invoke(); return true; }
                    if (TryPattern<TogglePattern>(element, TogglePattern.Pattern, out var toggle)) { toggle.Toggle(); return true; }
                    if (TryPattern<SelectionItemPattern>(element, SelectionItemPattern.Pattern, out var selection)) { selection.Select(); return true; }
                    return false;
                case "type":
                    if (element.Current.IsPassword) throw new UnauthorizedAccessException("Model control cannot type into password fields.");
                    if (action.Replace && TryPattern<ValuePattern>(element, ValuePattern.Pattern, out var value)) { value.SetValue(action.Text ?? string.Empty); return true; }
                    element.SetFocus();
                    if (!element.Current.HasKeyboardFocus) throw new InvalidOperationException("The exact editable control could not receive keyboard focus.");
                    return false;
                case "focus":
                    element.SetFocus();
                    return true;
                case "scroll":
                    if (TryPattern<ScrollPattern>(element, ScrollPattern.Pattern, out var scroll))
                    {
                        scroll.Scroll(ScrollAmount.NoAmount, action.DeltaY >= 0 ? ScrollAmount.SmallIncrement : ScrollAmount.SmallDecrement);
                        return true;
                    }
                    return false;
                case "select":
                    if (TryPattern<SelectionItemPattern>(element, SelectionItemPattern.Pattern, out var item)) { item.Select(); return true; }
                    return false;
                default:
                    return false;
            }
        }
        catch when (action.Type != "type") { return false; }
    }

    private WindowObservation BoundObservation(string state, string title, List<NormalizedElement> elements, string? focusedElementRef, int totalElements, HashSet<string> redactions)
    {
        while (true)
        {
            var truncated = elements.Count < totalElements;
            var observation = new WindowObservation(
                state,
                title,
                elements.ToArray(),
                focusedElementRef,
                null,
                truncated ? new { totalElements, returnedElements = elements.Count } : null,
                redactions.ToArray());
            if (JsonSerializer.SerializeToUtf8Bytes(observation).Length <= 500 * 1024 || elements.Count == 0) return observation;
            redactions.Add("observation-size-limit");
            var removeCount = Math.Min(50, elements.Count);
            foreach (var removed in elements.GetRange(elements.Count - removeCount, removeCount)) _elementRefs.Remove(removed.ElementRef);
            elements.RemoveRange(elements.Count - removeCount, removeCount);
            if (focusedElementRef is not null && !_elementRefs.ContainsKey(focusedElementRef)) focusedElementRef = null;
        }
    }

    private static bool TryPattern<T>(AutomationElement element, AutomationPattern pattern, out T value) where T : class
    {
        try
        {
            if (element.TryGetCurrentPattern(pattern, out var raw) && raw is T typed) { value = typed; return true; }
        }
        catch (ElementNotAvailableException) { }
        value = null!;
        return false;
    }

    public static CacheRequest CreateObservationCache(bool includeChildren)
    {
        var cache = new CacheRequest
        {
            AutomationElementMode = AutomationElementMode.Full,
            TreeScope = includeChildren ? TreeScope.Element | TreeScope.Children : TreeScope.Element,
            TreeFilter = Automation.ControlViewCondition
        };
        foreach (var property in ObservationProperties) cache.Add(property);
        return cache;
    }

    // Values are deliberately absent: only a non-sensitive ValuePattern control
    // is read after classification and a fresh password check below.
    public static IReadOnlyList<AutomationProperty> ObservationProperties { get; } = Array.AsReadOnly(new[]
    {
        AutomationElement.ControlTypeProperty, AutomationElement.NameProperty,
        AutomationElement.AutomationIdProperty, AutomationElement.IsPasswordProperty,
        AutomationElement.HelpTextProperty, AutomationElement.BoundingRectangleProperty,
        AutomationElement.IsEnabledProperty, AutomationElement.HasKeyboardFocusProperty,
        AutomationElement.IsOffscreenProperty, AutomationElement.IsInvokePatternAvailableProperty,
        AutomationElement.IsTogglePatternAvailableProperty, AutomationElement.IsSelectionItemPatternAvailableProperty,
        AutomationElement.IsValuePatternAvailableProperty, AutomationElement.IsScrollPatternAvailableProperty,
        ValuePattern.IsReadOnlyProperty, AutomationElement.IsExpandCollapsePatternAvailableProperty,
        SelectionItemPattern.IsSelectedProperty, TogglePattern.ToggleStateProperty,
        ExpandCollapsePattern.ExpandCollapseStateProperty
    });

    private static bool CachedTrue(AutomationElement element, AutomationProperty property) =>
        element.GetCachedPropertyValue(property, true) is true;

    private static string ReadSafeValue(AutomationElement element)
    {
        if (!CachedTrue(element, AutomationElement.IsValuePatternAvailableProperty) || element.Current.IsPassword) return string.Empty;
        return element.GetCurrentPropertyValue(ValuePattern.ValueProperty, true) as string ?? string.Empty;
    }

    private static string[] ReadStates(AutomationElement element, AutomationElement.AutomationElementInformation current) =>
        ProjectControlStates(current.IsEnabled, current.HasKeyboardFocus, current.IsOffscreen,
            CachedTrue(element, AutomationElement.IsSelectionItemPatternAvailableProperty)
                && element.GetCachedPropertyValue(SelectionItemPattern.IsSelectedProperty, true) is bool selected ? selected : null,
            CachedTrue(element, AutomationElement.IsTogglePatternAvailableProperty)
                && element.GetCachedPropertyValue(TogglePattern.ToggleStateProperty, true) is ToggleState toggle ? toggle : null,
            CachedTrue(element, AutomationElement.IsExpandCollapsePatternAvailableProperty)
                && element.GetCachedPropertyValue(ExpandCollapsePattern.ExpandCollapseStateProperty, true) is ExpandCollapseState expansion ? expansion : null);

    // Missing pattern properties stay unknown. UIA's default values for an
    // unsupported pattern must never look like a real unchecked/unselected item.
    public static string[] ProjectControlStates(bool enabled, bool focused, bool offscreen,
        bool? selected, ToggleState? toggle, ExpandCollapseState? expansion)
    {
        var states = new List<string> { enabled ? "enabled" : "disabled" };
        if (focused) states.Add("focused");
        if (offscreen) states.Add("offscreen");
        if (selected.HasValue) states.Add(selected.Value ? "selected" : "unselected");
        var toggleState = toggle switch {
            ToggleState.On => "checked", ToggleState.Off => "unchecked", ToggleState.Indeterminate => "mixed", _ => null
        };
        if (toggleState is not null) states.Add(toggleState);
        var expansionState = expansion switch {
            ExpandCollapseState.Expanded => "expanded", ExpandCollapseState.Collapsed => "collapsed",
            ExpandCollapseState.PartiallyExpanded => "partially-expanded", ExpandCollapseState.LeafNode => "leaf", _ => null
        };
        if (expansionState is not null) states.Add(expansionState);
        return states.ToArray();
    }

    private static string[] ReadCachedActions(AutomationElement element)
    {
        var actions = new List<string>();
        if (CachedTrue(element, AutomationElement.IsInvokePatternAvailableProperty)
            || CachedTrue(element, AutomationElement.IsTogglePatternAvailableProperty)
            || CachedTrue(element, AutomationElement.IsSelectionItemPatternAvailableProperty)) actions.Add("click");
        if (CachedTrue(element, AutomationElement.IsValuePatternAvailableProperty)
            && element.GetCachedPropertyValue(ValuePattern.IsReadOnlyProperty, true) is false) actions.Add("type");
        if (CachedTrue(element, AutomationElement.IsScrollPatternAvailableProperty)) actions.Add("scroll");
        return actions.ToArray();
    }

    private static Bounds? ReadBounds(System.Windows.Rect rectangle) =>
        rectangle.IsEmpty || rectangle.Width <= 0 || rectangle.Height <= 0 ? null
            : new Bounds(rectangle.X, rectangle.Y, rectangle.Width, rectangle.Height);

    private static string ControlTypeName(ControlType type)
    {
        if (type == ControlType.Button) return "button";
        if (type == ControlType.CheckBox) return "checkbox";
        if (type == ControlType.ComboBox) return "combobox";
        if (type == ControlType.Edit) return "edit";
        if (type == ControlType.Hyperlink) return "hyperlink";
        if (type == ControlType.List) return "list";
        if (type == ControlType.ListItem) return "listitem";
        if (type == ControlType.MenuItem) return "menuitem";
        if (type == ControlType.RadioButton) return "radio";
        if (type == ControlType.ScrollBar) return "scrollbar";
        if (type == ControlType.Tree) return "tree";
        if (type == ControlType.TreeItem) return "treeitem";
        if (type == ControlType.Document) return "document";
        if (type == ControlType.Window) return "window";
        if (type == ControlType.TitleBar) return "titlebar";
        return "control";
    }

    private static bool ContainsSensitive(string value) => System.Text.RegularExpressions.Regex.IsMatch(value, "password|secret|token|credential|one.?time|otp|cvv", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    private static string? Limit(string? value, int max) => string.IsNullOrWhiteSpace(value) ? null : value[..Math.Min(max, value.Length)];
}
