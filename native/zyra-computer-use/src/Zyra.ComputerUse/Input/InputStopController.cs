namespace Zyra.ComputerUse.Input;

// Owns only buttons synthesized by this helper, never the user's held input.
public sealed class InputStopController(Action<uint> sendButton)
{
    private readonly object _gate = new();
    private volatile bool _stopped;
    private uint _heldRelease;

    public void ThrowIfStopped()
    {
        if (_stopped) throw new OperationCanceledException("Windows input stopped by emergency stop.");
    }

    public void Stop()
    {
        lock (_gate)
        {
            _stopped = true;
            ReleaseButton();
        }
    }

    public void WithButton(uint down, uint up, Action action)
    {
        try
        {
            lock (_gate)
            {
                ThrowIfStopped();
                _heldRelease = up;
                sendButton(down);
            }
            action();
        }
        finally { lock (_gate) ReleaseButton(); }
    }

    private void ReleaseButton()
    {
        var release = _heldRelease;
        _heldRelease = 0;
        if (release != 0) sendButton(release);
    }
}
