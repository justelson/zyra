using System.Diagnostics;

namespace Zyra.ComputerUse.Input;

public static class PointerMotionPacer
{
    public static void Run(int durationMs, Action<double> applyProgress, Action ensureRunning,
        Func<double>? elapsedMilliseconds = null, Action<int>? sleep = null)
    {
        if (durationMs is < 50 or > 12000) throw new ArgumentOutOfRangeException(nameof(durationMs));
        var started = Stopwatch.GetTimestamp();
        elapsedMilliseconds ??= () => Stopwatch.GetElapsedTime(started).TotalMilliseconds;
        sleep ??= Thread.Sleep;
        var deadline = Math.Min(16d, durationMs);
        while (true)
        {
            ensureRunning();
            var remaining = deadline - elapsedMilliseconds();
            if (remaining > 0) sleep(Math.Max(1, (int)Math.Ceiling(remaining)));
            ensureRunning();
            var progress = Math.Clamp(elapsedMilliseconds() / durationMs, 0d, 1d);
            applyProgress(progress);
            if (progress >= 1d) return;
            // Work and timer overshoot count toward the duration. Skip missed
            // frames rather than replaying them or accumulating one sleep per point.
            deadline = Math.Min(durationMs, (Math.Floor(elapsedMilliseconds() / 16d) + 1d) * 16d);
        }
    }
}
