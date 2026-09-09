using Zyra.ComputerUse.Input;

internal static class PointerPositionConfirmationTests
{
    internal static void Run()
    {
        double elapsed = 0;
        var reads = 0;
        PointerPositionConfirmation.Confirm(845, 631, (911, 631),
            () => { reads++; return elapsed < 68 ? (911, 631) : (845, 631); },
            () => { }, () => elapsed, milliseconds => elapsed += milliseconds);
        if (elapsed != 68 || reads != 18) throw new Exception("Delayed prior-to-requested position was not confirmed through reads only.");

        foreach (var unexpected in new (int X, int Y)?[] { (900, 631), (845, 640), null })
        {
            var slept = false;
            try
            {
                PointerPositionConfirmation.Confirm(845, 631, (911, 631), () => unexpected,
                    () => { }, () => 0, _ => slept = true);
                throw new Exception("Unexpected cursor movement was accepted.");
            }
            catch (InvalidOperationException) { }
            if (slept) throw new Exception("Unexpected cursor movement was retried.");
        }

        elapsed = 0;
        try
        {
            PointerPositionConfirmation.Confirm(845, 631, (911, 631), () => (911, 631),
                () => { }, () => elapsed, milliseconds => elapsed += milliseconds);
            throw new Exception("Stuck pointer did not fail at its deadline.");
        }
        catch (InvalidOperationException) { }
        if (elapsed != 100) throw new Exception("Pointer confirmation exceeded the bounded deadline.");

        var buttons = new List<uint>();
        var stop = new InputStopController(buttons.Add);
        elapsed = 0;
        reads = 0;
        try
        {
            stop.WithButton(2, 4, () => PointerPositionConfirmation.Confirm(845, 631, (911, 631),
                () => { reads++; return (911, 631); }, stop.ThrowIfStopped,
                () => elapsed, milliseconds => { elapsed += milliseconds; if (elapsed >= 12) stop.Stop(); }));
            throw new Exception("Cancelled pointer confirmation continued.");
        }
        catch (OperationCanceledException) { }
        if (reads != 3 || !buttons.SequenceEqual(new uint[] { 2, 4 }))
            throw new Exception("Cancellation did not stop reads and release the held button immediately.");

        buttons.Clear();
        stop = new InputStopController(buttons.Add);
        try
        {
            stop.WithButton(2, 4, () => PointerPositionConfirmation.Confirm(845, 631, (911, 631),
                () => throw new Exception("Position was read after ownership failed."),
                () => throw new UnauthorizedAccessException("Target became obscured.")));
        }
        catch (UnauthorizedAccessException) { }
        if (!buttons.SequenceEqual(new uint[] { 2, 4 })) throw new Exception("Ownership failure did not release held input.");
    }
}
