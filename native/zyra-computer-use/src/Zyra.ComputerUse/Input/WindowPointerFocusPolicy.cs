using Zyra.ComputerUse.Protocol;

namespace Zyra.ComputerUse.Input;

public static class WindowPointerFocusPolicy
{
    public static void Prepare(bool allowWindowFocus, Bounds? observedBounds, Func<Bounds> readBounds, Action focus, Action assertCanAct)
    {
        if (!allowWindowFocus) return;
        assertCanAct();
        if (observedBounds is null || readBounds() != observedBounds) throw StaleBounds();
        focus();
        assertCanAct();
        if (readBounds() != observedBounds) throw StaleBounds();
    }

    private static InvalidOperationException StaleBounds() => new("Stale observation: selected-window bounds changed. Observe the window again before pointer input.");
}
