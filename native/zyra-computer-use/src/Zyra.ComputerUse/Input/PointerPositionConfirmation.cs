using System.Diagnostics;

namespace Zyra.ComputerUse.Input;

public static class PointerPositionConfirmation
{
    public static void Confirm(int x, int y, (int X, int Y) previous,
        Func<(int X, int Y)?> readPosition, Action ensureSafe,
        Func<double>? elapsedMilliseconds = null, Action<int>? sleep = null)
    {
        var started = Stopwatch.GetTimestamp();
        elapsedMilliseconds ??= () => Stopwatch.GetElapsedTime(started).TotalMilliseconds;
        sleep ??= Thread.Sleep;
        (int X, int Y)? actual = null;
        while (true)
        {
            ensureSafe();
            if (elapsedMilliseconds() > 100) throw Failure(actual, x, y);
            actual = readPosition();
            if (actual is { } position && Near(position, (x, y))) return;
            // Observe completion of the single positioning command only. Any
            // third position is unexpected motion, never a reason to resend input.
            if (actual is not { } pending || !Near(pending, previous)) throw Failure(actual, x, y);
            if (elapsedMilliseconds() >= 100) throw Failure(actual, x, y);
            sleep(4);
        }
    }

    private static bool Near((int X, int Y) a, (int X, int Y) b) =>
        Math.Abs((long)a.X - b.X) <= 2 && Math.Abs((long)a.Y - b.Y) <= 2;

    private static InvalidOperationException Failure((int X, int Y)? actual, int x, int y) =>
        new($"Windows did not position the pointer on the selected target ({(actual is { } point ? $"{point.X},{point.Y}" : "unavailable")} instead of {x},{y}).");
}
