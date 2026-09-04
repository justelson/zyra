using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using Zyra.ComputerUse.Protocol;
using Zyra.ComputerUse.Security;

namespace Zyra.ComputerUse.Windows;

public sealed class WindowRegistry
{
    private readonly byte[] _secret;
    private readonly Dictionary<string, WindowHandleEntry> _entries = new(StringComparer.Ordinal);

    public WindowRegistry(string secret) => _secret = Encoding.UTF8.GetBytes(secret);

    public WindowCandidate[] ListVisibleWindows()
    {
        _entries.Clear();
        var results = new List<WindowCandidate>();
        NativeMethods.EnumWindows((handle, _) =>
        {
            if (!NativeMethods.IsWindowVisible(handle) || NativeMethods.GetWindowTextLength(handle) <= 0) return true;
            NativeMethods.GetWindowThreadProcessId(handle, out var rawPid);
            if (rawPid == 0 || rawPid == NativeMethods.GetCurrentProcessId()) return true;
            try
            {
                var process = Process.GetProcessById((int)rawPid);
                var title = ReadWindowTitle(handle);
                var windowClass = ReadWindowClass(handle);
                var startTime = process.StartTime.ToUniversalTime().Ticks;
                var executable = SafeExecutablePath(process);
                var identity = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{executable}|{startTime}"))).ToLowerInvariant();
                var token = Token(handle, process.Id, startTime, identity);
                var blockedReason = ControlSecurityPolicy.BlockReason(process, title);
                _entries[token] = new WindowHandleEntry(handle, process.Id, startTime, identity, executable, process.ProcessName, title, blockedReason);
                results.Add(new WindowCandidate(token, title, process.ProcessName, windowClass, identity, process.Id, blockedReason is not null, blockedReason));
            }
            catch { }
            return results.Count < 256;
        }, nint.Zero);
        var visible = CollapseHostedCompanions(results);
        var visibleTokens = visible.Select(candidate => candidate.WindowToken).ToHashSet(StringComparer.Ordinal);
        foreach (var hiddenToken in _entries.Keys.Where(token => !visibleTokens.Contains(token)).ToArray()) _entries.Remove(hiddenToken);
        return visible.OrderBy(entry => entry.ApplicationName).ThenBy(entry => entry.Title).ToArray();
    }

    public static WindowCandidate[] CollapseHostedCompanions(IEnumerable<WindowCandidate> candidates)
    {
        var materialized = candidates.ToArray();
        var hostedTitles = materialized
            .Where(candidate => string.Equals(candidate.ApplicationName, "ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)
                && string.Equals(candidate.WindowClass, "ApplicationFrameWindow", StringComparison.OrdinalIgnoreCase))
            .Select(candidate => candidate.Title)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        return materialized.Where(candidate => !(hostedTitles.Contains(candidate.Title)
            && IsHostedCompanionClass(candidate.WindowClass))).ToArray();
    }

    public WindowHandleEntry Select(string windowToken)
    {
        if (!_entries.TryGetValue(windowToken, out var entry)) throw new InvalidOperationException("The window token is unknown or expired.");
        if (entry.BlockedReason is not null) throw new UnauthorizedAccessException(entry.BlockedReason);
        if (!NativeMethods.IsWindow(entry.Handle)) throw new InvalidOperationException("The selected window closed.");
        var process = Process.GetProcessById(entry.ProcessId);
        if (process.StartTime.ToUniversalTime().Ticks != entry.ProcessStartTime) throw new InvalidOperationException("The process identity changed after selection.");
        var expected = Token(entry.Handle, entry.ProcessId, entry.ProcessStartTime, entry.ExecutableIdentity);
        if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(windowToken), Encoding.UTF8.GetBytes(expected)))
            throw new UnauthorizedAccessException("The window token proof is invalid.");
        var blockReason = ControlSecurityPolicy.BlockReason(process, ReadWindowTitle(entry.Handle));
        if (blockReason is not null) throw new UnauthorizedAccessException(blockReason);
        return entry;
    }

    public static string ReadWindowTitle(nint handle)
    {
        var length = Math.Min(1024, Math.Max(1, NativeMethods.GetWindowTextLength(handle) + 1));
        var text = new StringBuilder(length);
        NativeMethods.GetWindowText(handle, text, length);
        return text.ToString();
    }

    private static string ReadWindowClass(nint handle)
    {
        var text = new StringBuilder(256);
        NativeMethods.GetClassName(handle, text, text.Capacity);
        return text.ToString();
    }

    private static bool IsHostedCompanionClass(string value) => value is "Windows.UI.Core.CoreWindow" or "ApplicationFrameInputSinkWindow";

    private string Token(nint handle, int processId, long startTime, string identity)
    {
        var payload = $"{handle.ToInt64()}:{processId}:{startTime}:{identity}";
        var signature = HMACSHA256.HashData(_secret, Encoding.UTF8.GetBytes(payload));
        return $"window-token:{Convert.ToHexString(signature).ToLowerInvariant()}";
    }

    private static string SafeExecutablePath(Process process)
    {
        try { return process.MainModule?.FileName ?? process.ProcessName; }
        catch { return process.ProcessName; }
    }
}

public sealed record WindowHandleEntry(
    nint Handle,
    int ProcessId,
    long ProcessStartTime,
    string ExecutableIdentity,
    string ExecutablePath,
    string ApplicationName,
    string Title,
    string? BlockedReason);
