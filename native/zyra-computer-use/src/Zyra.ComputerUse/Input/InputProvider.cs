using System.Runtime.InteropServices;
using Zyra.ComputerUse.Protocol;
using Zyra.ComputerUse.Windows;

namespace Zyra.ComputerUse.Input;

public sealed class InputProvider
{
    private volatile bool _stopped;
    public void Resume() => _stopped = false;
    public void EmergencyStop() => _stopped = true;

    public void Focus(WindowHandleEntry window)
    {
        ThrowIfStopped();
        if (NativeMethods.GetForegroundWindow() == window.Handle) return;
        NativeMethods.ShowWindowAsync(window.Handle, 9);
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
        if (NativeMethods.GetForegroundWindow() != window.Handle)
            throw new InvalidOperationException("The selected window could not be focused.");
    }

    public void Move(WindowHandleEntry window, double xValue, double yValue)
    {
        var (x, y) = ValidatePoint(window, xValue, yValue);
        ThrowIfStopped();
        PositionPointer(x, y);
    }

    public void Click(WindowHandleEntry window, double xValue, double yValue, string? button, int clickCount)
    {
        var (x, y) = ValidatePoint(window, xValue, yValue);
        var (down, up) = MouseButtonFlags(button);
        var count = Math.Clamp(clickCount, 1, 3);
        PositionPointer(x, y);
        for (var index = 0; index < count; index++)
        {
            ThrowIfStopped();
            ValidatePoint(window, x, y);
            NativeMethods.mouse_event(down, 0, 0, 0, 0);
            NativeMethods.mouse_event(up, 0, 0, 0, 0);
            if (index + 1 < count) Thread.Sleep(40);
        }
    }

    public void Drag(WindowHandleEntry window, double fromXValue, double fromYValue, double toXValue, double toYValue, string? button, int durationMs)
    {
        var (fromX, fromY) = ValidatePoint(window, fromXValue, fromYValue);
        var (toX, toY) = ValidatePoint(window, toXValue, toYValue);
        var (down, up) = MouseButtonFlags(button);
        var duration = Math.Clamp(durationMs <= 0 ? 300 : durationMs, 50, 2_000);
        var steps = Math.Clamp(duration / 16, 2, 120);
        PositionPointer(fromX, fromY);
        ValidatePoint(window, fromX, fromY);
        NativeMethods.mouse_event(down, 0, 0, 0, 0);
        try
        {
            for (var step = 1; step <= steps; step++)
            {
                ThrowIfStopped();
                var progress = step / (double)steps;
                var x = checked((int)Math.Round(fromX + (toX - fromX) * progress));
                var y = checked((int)Math.Round(fromY + (toY - fromY) * progress));
                var validated = ValidatePoint(window, x, y);
                PositionPointer(validated.X, validated.Y);
                Thread.Sleep(Math.Max(1, duration / steps));
            }
        }
        finally
        {
            NativeMethods.mouse_event(up, 0, 0, 0, 0);
        }
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
        var virtualKey = key.ToUpperInvariant() switch
        {
            "ENTER" => (ushort)0x0D, "TAB" => (ushort)0x09, "ESCAPE" => (ushort)0x1B,
            "BACKSPACE" => (ushort)0x08, "DELETE" => (ushort)0x2E, "HOME" => (ushort)0x24,
            "END" => (ushort)0x23, "ARROWUP" => (ushort)0x26, "ARROWDOWN" => (ushort)0x28,
            "ARROWLEFT" => (ushort)0x25, "ARROWRIGHT" => (ushort)0x27,
            _ when key.Length == 1 => (ushort)char.ToUpperInvariant(key[0]),
            _ => throw new InvalidOperationException("The requested key is not in the bounded key allowlist.")
        };
        var modifierKeys = (modifiers ?? []).Select(ModifierVirtualKey).Distinct().Take(4).ToArray();
        var inputs = new List<NativeMethods.Input>(modifierKeys.Length * 2 + 2);
        inputs.AddRange(modifierKeys.Select(value => VirtualKeyInput(value, 0)));
        inputs.Add(VirtualKeyInput(virtualKey, 0));
        inputs.Add(VirtualKeyInput(virtualKey, 0x0002));
        inputs.AddRange(modifierKeys.Reverse().Select(value => VirtualKeyInput(value, 0x0002)));
        if (NativeMethods.SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf<NativeMethods.Input>()) != inputs.Count)
            throw new InvalidOperationException("Windows rejected synthesized key input.");
    }

    public void Scroll(WindowHandleEntry window, double deltaY)
    {
        Focus(window);
        ThrowIfStopped();
        var amount = (int)Math.Clamp(-deltaY, -10_000, 10_000);
        NativeMethods.mouse_event(0x0800, 0, 0, unchecked((uint)amount), 0);
    }

    private static void PositionPointer(int x, int y)
    {
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
        if (!NativeMethods.GetCursorPos(out var actual) || Math.Abs(actual.X - x) > 2 || Math.Abs(actual.Y - y) > 2)
            throw new InvalidOperationException($"Windows did not position the pointer on the selected target ({actual.X},{actual.Y} instead of {x},{y}).");
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
        if (_stopped) throw new OperationCanceledException("Windows input stopped by emergency stop.");
    }
}
