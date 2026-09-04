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
            var walker = TreeWalker.ControlViewWalker;
            var queue = new Queue<(AutomationElement Element, string Path, int Depth)>();
            queue.Enqueue((root, "0", 0));
            while (queue.Count > 0 && elements.Count < MaxElements)
            {
                var (element, path, depth) = queue.Dequeue();
                var current = element.Current;
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
                    ReadStates(current),
                    ReadActions(element),
                    sensitive));
                if (depth >= 24) continue;
                AutomationElement? child = null;
                try { child = walker.GetFirstChild(element); } catch (ElementNotAvailableException) { }
                var index = 0;
                while (child is not null && index < 256)
                {
                    queue.Enqueue((child, $"{path}.{index}", depth + 1));
                    try { child = walker.GetNextSibling(child); } catch (ElementNotAvailableException) { child = null; }
                    index++;
                }
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

    private static string ReadSafeValue(AutomationElement element)
    {
        if (element.Current.IsPassword) return string.Empty;
        return TryPattern<ValuePattern>(element, ValuePattern.Pattern, out var value) ? value.Current.Value : string.Empty;
    }

    private static string[] ReadStates(AutomationElement.AutomationElementInformation current)
    {
        var states = new List<string> { current.IsEnabled ? "enabled" : "disabled" };
        if (current.HasKeyboardFocus) states.Add("focused");
        if (current.IsOffscreen) states.Add("offscreen");
        return states.ToArray();
    }

    private static string[] ReadActions(AutomationElement element)
    {
        var actions = new List<string>();
        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out _) || element.TryGetCurrentPattern(TogglePattern.Pattern, out _) || element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out _)) actions.Add("click");
        if (TryPattern<ValuePattern>(element, ValuePattern.Pattern, out var value) && !value.Current.IsReadOnly) actions.Add("type");
        if (element.TryGetCurrentPattern(ScrollPattern.Pattern, out _)) actions.Add("scroll");
        return actions.ToArray();
    }

    private static Bounds? ReadBounds(object rectangle)
    {
        var type = rectangle.GetType();
        double Read(string name) => Convert.ToDouble(type.GetProperty(name)?.GetValue(rectangle) ?? 0d);
        var width = Read("Width");
        var height = Read("Height");
        return width <= 0 || height <= 0 ? null : new Bounds(Read("X"), Read("Y"), width, height);
    }

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
