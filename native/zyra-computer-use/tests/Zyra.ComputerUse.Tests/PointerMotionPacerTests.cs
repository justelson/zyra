using Zyra.ComputerUse.Input;

internal static class PointerMotionPacerTests
{
    internal static void Run()
    {
        foreach (var duration in new[] { 300, 600 })
        {
            double now = 0;
            var positions = new List<(double Time, double Progress)>();
            PointerMotionPacer.Run(duration, progress => {
                positions.Add((now, progress));
                now += 9; // Guard, positioning and progress serialization cost.
            }, () => { }, () => now, milliseconds => now += Math.Ceiling(milliseconds / 15.625) * 15.625);
            if (now > duration + 35 || positions[^1].Progress != 1d)
                throw new Exception("Frame work or timer rounding accumulated beyond the motion deadline.");
            if (positions.Zip(positions.Skip(1)).Any(pair => pair.Second.Progress <= pair.First.Progress))
                throw new Exception("Motion replayed an overdue frame.");
        }

        var buttons = new List<uint>();
        var stop = new InputStopController(buttons.Add);
        double stoppedAt = 0;
        var applied = 0;
        try
        {
            stop.WithButton(2, 4, () => PointerMotionPacer.Run(600, _ => applied++, stop.ThrowIfStopped,
                () => stoppedAt, milliseconds => { stoppedAt += milliseconds; stop.Stop(); }));
            throw new Exception("Cancelled motion reached the input callback.");
        }
        catch (OperationCanceledException) { }
        if (applied != 0 || !buttons.SequenceEqual(new uint[] { 2, 4 }))
            throw new Exception("Cancellation did not release the held button before further input.");

        buttons.Clear();
        stop = new InputStopController(buttons.Add);
        double obstructedAt = 0;
        try
        {
            stop.WithButton(2, 4, () => PointerMotionPacer.Run(300,
                _ => throw new UnauthorizedAccessException("Owned point became obstructed."), stop.ThrowIfStopped,
                () => obstructedAt, milliseconds => obstructedAt += milliseconds));
        }
        catch (UnauthorizedAccessException) { }
        if (!buttons.SequenceEqual(new uint[] { 2, 4 }))
            throw new Exception("Obstruction did not release the held button.");
    }
}
