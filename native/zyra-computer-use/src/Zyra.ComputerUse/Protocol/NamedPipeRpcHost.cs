using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Zyra.ComputerUse.Capture;
using Zyra.ComputerUse.Input;
using Zyra.ComputerUse.UiAutomation;
using Zyra.ComputerUse.Windows;

namespace Zyra.ComputerUse.Protocol;

public sealed class NamedPipeRpcHost
{
    public const int MaxMessageBytes = 512 * 1024;
    private readonly string _pipeName;
    private readonly string _authSecret;
    private readonly WindowRegistry _windows;
    private readonly RegisteredAppLauncher _appLauncher = new();
    private readonly UiAutomationProvider _uia = new();
    private readonly InputProvider _input = new();
    private readonly WindowsGraphicsCaptureProvider _capture;
    private readonly Dictionary<string, int> _revisions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, WindowObservation> _observations = new(StringComparer.Ordinal);
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web) { PropertyNameCaseInsensitive = true };

    public NamedPipeRpcHost(string pipeName, string authSecret, string artifactDirectory)
    {
        _pipeName = pipeName;
        _authSecret = authSecret;
        _windows = new WindowRegistry(authSecret);
        _capture = new WindowsGraphicsCaptureProvider(artifactDirectory);
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        using var pipe = new NamedPipeServerStream(
            _pipeName,
            PipeDirection.InOut,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly,
            MaxMessageBytes,
            MaxMessageBytes);
        await pipe.WaitForConnectionAsync(cancellationToken);
        ValidatePeer(pipe);
        using var reader = new StreamReader(pipe, new UTF8Encoding(false), false, 4096, leaveOpen: true);
        using var writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, leaveOpen: true) { AutoFlush = true };
        var boundedReader = new BoundedLineReader(reader);
        try
        {
            while (!cancellationToken.IsCancellationRequested && pipe.IsConnected)
            {
                var line = await boundedReader.ReadLineAsync(cancellationToken);
                if (line is null) break;
                RpcResponse response;
                try
                {
                    var request = JsonSerializer.Deserialize<RpcRequest>(line, _json) ?? throw new InvalidDataException("JSON-RPC request is missing.");
                    response = await HandleAsync(request, cancellationToken);
                }
                catch (Exception error)
                {
                    response = new RpcResponse("unknown", false, Error: new RpcError(ErrorCode(error), Limit(error.Message, 512), error is IOException or TimeoutException));
                }
                await writer.WriteLineAsync(JsonSerializer.Serialize(response, _json));
            }
        }
        catch (IOException)
        {
            // A client closing its end of the pipe is a normal transport shutdown.
        }
    }

    public async Task<RpcResponse> HandleAsync(RpcRequest request, CancellationToken cancellationToken = default)
    {
        if (request.Version != 1) return Error(request.Id, "PROTOCOL_VERSION", "Unsupported sidecar protocol version.");
        if (!FixedEquals(request.Auth, _authSecret)) return Error(request.Id, "AUTHENTICATION_FAILED", "Sidecar authentication failed.");
        if (request.Id.Length is < 1 or > 192 || request.Method.Length is < 1 or > 96) return Error(request.Id, "INVALID_REQUEST", "Request identifiers exceed protocol bounds.");
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            object result = request.Method switch
            {
                "health" => new { state = "ready", processId = Environment.ProcessId, protocolVersion = 1 },
                "open_app" => OpenApp(ReadString(request.Parameters, "application")),
                "list_windows" => new { windows = _windows.ListVisibleWindows() },
                "select_window" => SelectWindow(ReadString(request.Parameters, "windowToken")),
                "observe" => Observe(request.Parameters),
                "action" => Act(request.Parameters),
                "emergency_stop" => Stop(),
                _ => throw new NotSupportedException("Unknown sidecar operation.")
            };
            return new RpcResponse(request.Id, true, result);
        }
        catch (Exception error)
        {
            return new RpcResponse(request.Id, false, Error: new RpcError(ErrorCode(error), Limit(error.Message, 512), error is IOException or TimeoutException));
        }
    }

    private object OpenApp(string application)
    {
        var opened = _appLauncher.Open(application);
        return new { applicationName = opened.Name };
    }

    private object SelectWindow(string token)
    {
        var window = _windows.Select(token);
        _input.Resume();
        return new SelectedWindow(token, window.ProcessId, window.ExecutableIdentity, window.ApplicationName, window.Title, window.ProcessStartTime);
    }

    private object Observe(JsonElement parameters)
    {
        var token = ReadString(parameters, "windowToken");
        var revision = ReadInt(parameters, "revision", 1, int.MaxValue);
        var includeScreenshot = ReadBool(parameters, "includeScreenshot");
        var window = _windows.Select(token);
        var observation = _uia.Observe(window, revision);
        if (includeScreenshot)
        {
            var screenshotRef = _capture.CaptureSelectedWindow(window);
            observation = observation with { ScreenshotRef = screenshotRef };
        }
        _revisions[token] = revision;
        _observations[token] = observation;
        return observation;
    }

    private object Act(JsonElement parameters)
    {
        var token = ReadString(parameters, "windowToken");
        var revision = ReadInt(parameters, "revision", 1, int.MaxValue);
        if (!_revisions.TryGetValue(token, out var current) || current != revision) throw new InvalidOperationException($"Stale observation revision. Current revision is {current}.");
        var window = _windows.Select(token);
        var actionElement = parameters.GetProperty("action");
        var action = JsonSerializer.Deserialize<SidecarAction>(actionElement.GetRawText(), _json) ?? throw new InvalidDataException("Action is invalid.");
        var semantic = _uia.TryAct(action, revision);
        if (!semantic)
        {
            if (!CanUseWindowInputFallback(action))
                throw new InvalidOperationException("The exact semantic action could not be completed. Observe the target again before acting.");
            switch (action.Type)
            {
                case "focus": _input.Focus(window); break;
                case "key": _input.Key(window, action.Key ?? string.Empty); break;
                case "scroll": _input.Scroll(window, action.DeltaY); break;
                case "wait": Thread.Sleep(100); break;
                default: throw new NotSupportedException("The sidecar action is not allowed.");
            }
        }
        return new { changed = action.Type != "wait", semantic };
    }

    public static bool CanUseWindowInputFallback(SidecarAction action) =>
        action.ElementRef is null && action.Type is "focus" or "key" or "scroll" or "wait";

    private object Stop()
    {
        _input.EmergencyStop();
        _revisions.Clear();
        _observations.Clear();
        _capture.Clear();
        return new { stopped = true };
    }

    private static void ValidatePeer(NamedPipeServerStream pipe)
    {
        if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle.DangerousGetHandle(), out var processId)) throw new UnauthorizedAccessException("Could not identify the named-pipe peer.");
        var process = Process.GetProcessById((int)processId);
        if (process.SessionId != Process.GetCurrentProcess().SessionId) throw new UnauthorizedAccessException("Named-pipe peer belongs to another user session.");
    }

    private sealed class BoundedLineReader(StreamReader reader)
    {
        private readonly char[] _buffer = new char[4096];
        private readonly StringBuilder _pending = new();

        public async Task<string?> ReadLineAsync(CancellationToken cancellationToken)
        {
            while (true)
            {
                var buffered = _pending.ToString();
                var newline = buffered.IndexOf('\n');
                if (newline >= 0)
                {
                    var line = buffered[..newline].TrimEnd('\r');
                    _pending.Remove(0, newline + 1);
                    EnsureBounded(line);
                    return line;
                }
                EnsureBounded(buffered);
                var read = await reader.ReadAsync(_buffer.AsMemory(0, _buffer.Length), cancellationToken);
                if (read == 0)
                {
                    if (_pending.Length == 0) return null;
                    var finalLine = _pending.ToString().TrimEnd('\r');
                    _pending.Clear();
                    EnsureBounded(finalLine);
                    return finalLine;
                }
                _pending.Append(_buffer, 0, read);
            }
        }

        private static void EnsureBounded(string value)
        {
            if (Encoding.UTF8.GetByteCount(value) > MaxMessageBytes)
                throw new InvalidDataException("Sidecar message exceeds 512 KiB.");
        }
    }

    private static bool FixedEquals(string left, string right)
    {
        var leftBytes = Encoding.UTF8.GetBytes(left ?? string.Empty);
        var rightBytes = Encoding.UTF8.GetBytes(right ?? string.Empty);
        return leftBytes.Length == rightBytes.Length && CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }

    private static string ReadString(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String) throw new InvalidDataException($"{name} is required.");
        var text = property.GetString() ?? string.Empty;
        if (text.Length is < 1 or > 512) throw new InvalidDataException($"{name} exceeds protocol bounds.");
        return text;
    }

    private static int ReadInt(JsonElement value, string name, int minimum, int maximum)
    {
        if (!value.TryGetProperty(name, out var property) || !property.TryGetInt32(out var number) || number < minimum || number > maximum) throw new InvalidDataException($"{name} is invalid.");
        return number;
    }

    private static bool ReadBool(JsonElement value, string name) => value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.True;
    private static RpcResponse Error(string id, string code, string message) => new(id, false, Error: new RpcError(code, message));
    private static string ErrorCode(Exception error) => error switch
    {
        UnauthorizedAccessException => "POLICY_DENIED",
        OperationCanceledException => "CANCELLED",
        InvalidDataException => "INVALID_REQUEST",
        InvalidOperationException when error.Message.Contains("Stale observation", StringComparison.OrdinalIgnoreCase) => "STALE_OBSERVATION",
        InvalidOperationException => "STALE_TARGET",
        NotSupportedException => "UNKNOWN_OPERATION",
        _ => "SIDECAR_ERROR"
    };
    private static string Limit(string value, int maximum) => value[..Math.Min(maximum, value.Length)];

    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetNamedPipeClientProcessId(nint pipe, out uint processId);
}
