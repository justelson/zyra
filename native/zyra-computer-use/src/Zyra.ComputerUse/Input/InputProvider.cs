using System.Runtime.InteropServices;
using Zyra.ComputerUse.Protocol;
using Zyra.ComputerUse.Windows;

namespace Zyra.ComputerUse.Input;

public sealed class InputProvider
{
    private readonly InputStopController _stop = new(flags => NativeMethods.mouse_event(flags, 0, 0, 0, 0));
    public Action<int, int, string>? PointerProgress { get; set; }
    public void EmergencyStop() => _stop.Stop();

    public void Focus(WindowHandleEntry window)
    {
        ThrowIfStopped();
        AssertSelectedProcess(window);
        if (NativeMethods.GetForegroundWindow() == window.Handle) return;
        if (NativeMethods.IsIconic(window.Handle)) NativeMethods.ShowWindowAsync(window.Handle, 9);
        NativeMethods.SetForegroundWindow(window.Handle);
        if (NativeMethods.GetForegroundWindow() != window.Handle)
        {
            var currentThread = NativeMethods.GetCurrentThreadId();
            var foregroundThread = NativeMethods.GetWindowThreadProcessId(NativeMethods.GetForegroundWindow(), out _);
            var attached = foregroundThread != 0 && foregroundThread != currentThread
                && NativeMethods.AttachThreadInput(currentThread, foregroundThread, true);
            try
            {
                NativeMethods.BringWindowToTop(window.Handle);
                NativeMethods.SetForegroundWindow(window.Handle);
            }
            finally
            {
                if (attached) NativeMethods.AttachThreadInput(currentThread, foregroundThread, false);
            }
        }
        Thread.Sleep(20);
        ThrowIfStopped();
        AssertSelectedProcess(window);
        if (NativeMethods.GetForegroundWindow() != window.Handle)
            throw new InvalidOperationException("The selected window could not be focused.");
    }

    public void PreparePointerFocus(WindowHandleEntry window, Bounds? observedBounds, bool allowWindowFocus) =>
        WindowPointerFocusPolicy.Prepare(allowWindowFocus, observedBounds, () => ReadWindowBounds(window), () => Focus(window), ThrowIfStopped);

    internal static Bounds ReadWindowBounds(WindowHandleEntry window)
    {
        AssertSelectedProcess(window);
        if (!NativeMethods.GetWindowRect(window.Handle, out var rectangle) || rectangle.Right <= rectangle.Left || rectangle.Bottom <= rectangle.Top)
            throw new InvalidOperationException("Selected-window bounds are unavailable.");
        return new Bounds(rectangle.Left, rectangle.Top, rectangle.Right - rectangle.Left, rectangle.Bottom - rectangle.Top);
    }

    private static void AssertSelectedProcess(WindowHandleEntry window)
    {
        NativeMethods.GetWindowThreadProcessId(window.Handle, out var processId);
        if (processId != window.ProcessId) throw new InvalidOperationException("The selected window process changed after selection.");
    }

    public void Move(WindowHandleEntry window, double xValue, double yValue)
    {
        var (x, y) = ValidatePoint(window, xValue, yValue);
        ThrowIfStopped();
        // Animate only inside the selected unobscured window. Entering from
        // another app snaps to the authorized point without crossing its UI.
        if (NativeMethods.GetCursorPos(out var start))
        {
            try { ValidatePoint(window, start.X, start.Y); }
            catch (UnauthorizedAccessException) { PositionPointer(window, x, y); PointerProgress?.Invoke(x, y, "moving"); return; }
            var distance = Math.Sqrt(Math.Pow(x - start.X, 2) + Math.Pow(y - start.Y, 2));
            var steps = Math.Clamp((int)(distance / 35), 1, 8);
            for (var step = 1; step < steps; step++)
            {
                ThrowIfStopped();
                var progress = step / (double)steps;
                progress = progress * progress * (3 - 2 * progress);
                var point = ValidatePoint(window, start.X + (x - start.X) * progress, start.Y + (y - start.Y) * progress);
                PositionPointer(window, point.X, point.Y);
                PointerProgress?.Invoke(point.X, point.Y, "moving");
                Thread.Sleep(12);
            }
        }
        ThrowIfStopped();
        PositionPointer(window, x, y);
        PointerProgress?.Invoke(x, y, "moving");
    }

    public void Click(WindowHandleEntry window, double xValue, double yValue, string? button, int clickCount)
    {
        var (x, y) = ValidatePoint(window, xValue, yValue);
        var (down, up) = MouseButtonFlags(button);
        var count = Math.Clamp(clickCount, 1, 3);
        Move(window, x, y);
        for (var index = 0; index < count; index++)
        {
            ThrowIfStopped();
            ValidatePoint(window, x, y);
            PointerProgress?.Invoke(x, y, "pressing");
            _stop.WithButton(down, up, () => { });
            if (index + 1 < count) Thread.Sleep(40);
        }
    }

    public void Drag(WindowHandleEntry window, double fromXValue, double fromYValue, double toXValue, double toYValue, string? button, int durationMs)
    {
        var (fromX, fromY) = ValidatePoint(window, fromXValue, fromYValue);
        var (toX, toY) = ValidatePoint(window, toXValue, toYValue);
        var (down, up) = MouseButtonFlags(button);
        var duration = Math.Clamp(durationMs <= 0 ? 300 : durationMs, 50, 2_000);
        Move(window, fromX, fromY);
        ValidatePoint(window, fromX, fromY);
        ThrowIfStopped();
        _stop.WithButton(down, up, () =>
        {
            PointerMotionPacer.Run(duration, progress =>
            {
                var x = checked((int)Math.Round(fromX + (toX - fromX) * progress));
                var y = checked((int)Math.Round(fromY + (toY - fromY) * progress));
                var validated = ValidatePoint(window, x, y);
                PositionPointer(window, validated.X, validated.Y);
                PointerProgress?.Invoke(validated.X, validated.Y, "dragging");
            }, ThrowIfStopped);
        });
    }

    public void TypeText(WindowHandleEntry window, string text)
    {
        Focus(window);
        if (text.Length > 16_384) throw new InvalidOperationException("Typed text exceeds the sidecar limit.");
        foreach (var character in text)
        {
            ThrowIfStopped();
            var inputs = new[]
            {
                KeyInput(character, 0x0004),
                KeyInput(character, 0x0004 | 0x0002)
            };
            if (NativeMethods.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<NativeMethods.Input>()) != inputs.Length)
                throw new InvalidOperationException("Windows rejected synthesized text input.");
        }
    }

    public void Key(WindowHandleEntry window, string key, string[]? modifiers)
    {
        Focus(window);
        var virtualKey = ResolveVirtualKey(key);
        var modifierKeys = (modifiers ?? []).Select(ModifierVirtualKey).Distinct().Take(4).ToArray();
        if (virtualKey == 0x1B && modifierKeys.Length == 0)
        {
            TargetedEscapeDispatcher.Dispatch(window.Handle, window.ProcessId,
                () => ReadSelectedFocusedWindow(window),
                handle => NativeMethods.GetAncestor(handle, 2),
                handle => { NativeMethods.GetWindowThreadProcessId(handle, out var process); return checked((int)process); },
                NativeMethods.PostMessage,
                () => {
                    ThrowIfStopped();
                    if (NativeMethods.GetForegroundWindow() != window.Handle)
                        throw new InvalidOperationException("The selected window lost focus before Escape.");
                });
            return;
        }
        var inputs = new List<NativeMethods.Input>(modifierKeys.Length * 2 + 2);
        inputs.AddRange(modifierKeys.Select(value => VirtualKeyInput(value, 0)));
        inputs.Add(VirtualKeyInput(virtualKey, 0));
        inputs.Add(VirtualKeyInput(virtualKey, 0x0002));
        inputs.AddRange(modifierKeys.Reverse().Select(value => VirtualKeyInput(value, 0x0002)));
        if (NativeMethods.SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf<NativeMethods.Input>()) != inputs.Count)
            throw new InvalidOperationException("Windows rejected synthesized key input.");
    }

    private static nint ReadSelectedFocusedWindow(WindowHandleEntry window)
    {
        var threadId = NativeMethods.GetWindowThreadProcessId(window.Handle, out var processId);
        if (threadId == 0 || processId != window.ProcessId)
            throw new InvalidOperationException("The selected window identity changed before Escape.");
        var info = new NativeMethods.GuiThreadInfo { Size = (uint)Marshal.SizeOf<NativeMethods.GuiThreadInfo>() };
        if (!NativeMethods.GetGUIThreadInfo(threadId, ref info))
            throw new InvalidOperationException("The selected window's focused control is unavailable.");
        return info.Focus;
    }

    public void Scroll(WindowHandleEntry window, double deltaY)
    {
        Focus(window);
        ThrowIfStopped();
        var amount = (int)Math.Clamp(-deltaY, -10_000, 10_000);
        NativeMethods.mouse_event(0x0800, 0, 0, unchecked((uint)amount), 0);
    }

    private void PositionPointer(WindowHandleEntry window, int x, int y)
    {
        ThrowIfStopped();
        if (!NativeMethods.GetCursorPos(out var previous))
            throw new InvalidOperationException("Windows could not read the pointer before positioning.");
        if (!NativeMethods.SetCursorPos(x, y))
        {
            var left = NativeMethods.GetSystemMetrics(76);
            var top = NativeMethods.GetSystemMetrics(77);
            var width = Math.Max(2, NativeMethods.GetSystemMetrics(78));
            var height = Math.Max(2, NativeMethods.GetSystemMetrics(79));
            var normalizedX = checked((int)Math.Round((x - left) * 65_535d / (width - 1)));
            var normalizedY = checked((int)Math.Round((y - top) * 65_535d / (height - 1)));
            var input = new[]
            {
                new NativeMethods.Input
                {
                    Type = 0,
                    Data = new NativeMethods.InputUnion
                    {
                        Mouse = new NativeMethods.MouseInput { X = normalizedX, Y = normalizedY, Flags = 0x0001 | 0x4000 | 0x8000 }
                    }
                }
            };
            if (NativeMethods.SendInput(1, input, Marshal.SizeOf<NativeMethods.Input>()) != 1)
                throw new InvalidOperationException("Windows rejected pointer positioning.");
            Thread.Sleep(12);
        }
        PointerPositionConfirmation.Confirm(x, y, (previous.X, previous.Y),
            () => NativeMethods.GetCursorPos(out var actual) ? (actual.X, actual.Y) : null,
            () => { ThrowIfStopped(); ValidatePoint(window, x, y); });
    }

    private static (int X, int Y) ValidatePoint(WindowHandleEntry window, double xValue, double yValue)
    {
        if (!double.IsFinite(xValue) || !double.IsFinite(yValue)) throw new InvalidOperationException("Pointer coordinates must be finite.");
        var x = checked((int)Math.Round(xValue));
        var y = checked((int)Math.Round(yValue));
        if (!NativeMethods.GetWindowRect(window.Handle, out var bounds)
            || x < bounds.Left || x >= bounds.Right || y < bounds.Top || y >= bounds.Bottom)
            throw new UnauthorizedAccessException("Pointer coordinates must stay inside the selected window.");
        var pointWindow = NativeMethods.WindowFromPoint(new NativeMethods.Point { X = x, Y = y });
        var pointRoot = pointWindow == nint.Zero ? nint.Zero : NativeMethods.GetAncestor(pointWindow, 2);
        if (pointRoot != window.Handle)
            throw new UnauthorizedAccessException("Pointer coordinates are obscured or no longer belong to the selected window.");
        return (x, y);
    }

    private static (uint Down, uint Up) MouseButtonFlags(string? button) => button?.ToLowerInvariant() switch
    {
        null or "" or "left" => (0x0002, 0x0004),
        "right" => (0x0008, 0x0010),
        "middle" => (0x0020, 0x0040),
        _ => throw new InvalidOperationException("The pointer button is not allowed.")
    };

    public static ushort ResolveVirtualKey(string key) => key.ToUpperInvariant() switch
        {
            "SPACE" or "SPACEBAR" => (ushort)0x20,
            "ENTER" => (ushort)0x0D, "TAB" => (ushort)0x09, "ESCAPE" => (ushort)0x1B,
            "BACKSPACE" => (ushort)0x08, "DELETE" => (ushort)0x2E, "HOME" => (ushort)0x24,
            "END" => (ushort)0x23, "ARROWUP" => (ushort)0x26, "ARROWDOWN" => (ushort)0x28,
            "ARROWLEFT" => (ushort)0x25, "ARROWRIGHT" => (ushort)0x27,
            _ when key.Length == 1 => (ushort)char.ToUpperInvariant(key[0]),
            _ => throw new InvalidOperationException("The requested key is not in the bounded key allowlist.")
        };

    private static ushort ModifierVirtualKey(string value) => value.ToUpperInvariant() switch
    {
        "CTRL" or "CONTROL" => 0x11,
        "SHIFT" => 0x10,
        "ALT" => 0x12,
        "WIN" or "WINDOWS" or "META" => 0x5B,
        _ => throw new InvalidOperationException("The requested key modifier is not in the bounded allowlist.")
    };

    private static NativeMethods.Input KeyInput(char character, uint flags) => new()
    {
        Type = 1,
        Data = new NativeMethods.InputUnion { Keyboard = new NativeMethods.KeyboardInput { VirtualKey = 0, ScanCode = character, Flags = flags } }
    };

    private static NativeMethods.Input VirtualKeyInput(ushort key, uint flags) => new()
    {
        Type = 1,
        Data = new NativeMethods.InputUnion { Keyboard = new NativeMethods.KeyboardInput { VirtualKey = key, ScanCode = 0, Flags = flags } }
    };

    private void ThrowIfStopped()
    {
        _stop.ThrowIfStopped();
    }
}
