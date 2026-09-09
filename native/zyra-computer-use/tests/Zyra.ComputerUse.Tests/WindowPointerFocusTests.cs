using Zyra.ComputerUse.Input;
using Zyra.ComputerUse.Protocol;

public static class WindowPointerFocusTests
{
    public static void Run()
    {
        var observed = new Bounds(-9, -9, 1938, 1098);
        var current = observed;
        var focused = false;
        var input = 0;
        var focusCalls = 0;
        void Focus() { focusCalls++; focused = true; }
        WindowPointerFocusPolicy.Prepare(false, observed, () => current, Focus, () => { });
        Assert(!focused && focusCalls == 0, "Missing focus rights activated the target.");
        WindowPointerFocusPolicy.Prepare(true, observed, () => current, Focus, () => { });
        input++;
        Assert(focused && input == 1 && current == observed, "Granted exact focus changed maximized geometry.");
        foreach (var changedBefore in new[] { false, true })
        {
            current = changedBefore ? observed with { X = 20 } : observed;
            var previousInput = input;
            var previousFocus = focusCalls;
            ExpectStale(() => { WindowPointerFocusPolicy.Prepare(true, observed, () => current,
                () => { Focus(); current = observed with { Width = 800 }; }, () => { }); input++; });
            Assert(input == previousInput, "Stale geometry allowed pointer input.");
            Assert(focusCalls == previousFocus + (changedBefore ? 0 : 1), "Focus was replayed or stale pre-focus geometry was accepted.");
        }
        ExpectStale(() => WindowPointerFocusPolicy.Prepare(true, null, () => observed, Focus, () => { }));
        var checks = 0;
        try { WindowPointerFocusPolicy.Prepare(true, observed, () => observed, Focus,
            () => { if (++checks == 2) throw new OperationCanceledException(); }); input++; }
        catch (OperationCanceledException) { }
        Assert(input == 1, "Cancellation after activation allowed pointer input.");
    }
    private static void ExpectStale(Action action)
    {
        try { action(); } catch (InvalidOperationException error) when (error.Message.Contains("Stale observation")) { return; }
        throw new Exception("Changed bounds were not rejected as stale.");
    }
    private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
}
