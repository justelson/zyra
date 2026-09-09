namespace Zyra.ComputerUse.Input;

// Unmodified Escape is a dismiss command for the selected focused control.
// Posting it there avoids synthesizing a global Esc hotkey. Physical Escape
// remains owned by Desktop's emergency-stop shortcut throughout the operation.
public static class TargetedEscapeDispatcher
{
    public static void Dispatch(
        nint selectedWindow, int selectedProcessId,
        Func<nint> focusedWindow, Func<nint, nint> rootWindow, Func<nint, int> processId,
        Func<nint, uint, nuint, nint, bool> post, Action assertCanAct)
    {
        assertCanAct();
        var focused = focusedWindow();
        if (focused == 0 || rootWindow(focused) != selectedWindow || processId(focused) != selectedProcessId)
            throw new InvalidOperationException("Escape requires a focused control belonging to the exact selected window.");
        assertCanAct();
        if (focusedWindow() != focused)
            throw new InvalidOperationException("The selected focused control changed before Escape.");
        if (!post(focused, 0x0100, 0x1B, (nint)0x00010001))
            throw new InvalidOperationException("The selected control rejected Escape key-down.");
        if (!post(focused, 0x0101, 0x1B, unchecked((nint)0xC0010001)))
            throw new InvalidOperationException("The selected control rejected Escape key-up; the command will not be replayed.");
    }
}
