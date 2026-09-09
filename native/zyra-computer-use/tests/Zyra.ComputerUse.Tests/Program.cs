using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using Zyra.ComputerUse.Protocol;
using Zyra.ComputerUse.Input;
using Zyra.ComputerUse.UiAutomation;
using System.Windows.Automation;
using Zyra.ComputerUse.Security;
using Zyra.ComputerUse.Windows;

const string Secret = "0123456789abcdef0123456789abcdef";
var failures = new List<string>();
var checkCount = 0;

NamedPipeRpcHost Host() => new("zyra-computer-use-test", Secret, Path.Combine(Path.GetTempPath(), "zyra-computer-use-tests", Guid.NewGuid().ToString("N")));
RpcRequest Request(string method, string auth, object? parameters = null, int version = 1)
{
    using var document = JsonDocument.Parse(JsonSerializer.Serialize(parameters ?? new { }));
    return new RpcRequest(Guid.NewGuid().ToString("N"), method, document.RootElement.Clone(), auth, version);
}
async Task Check(string name, Func<Task> body)
{
    checkCount++;
    try { await body(); }
    catch (Exception error) { failures.Add($"{name}: {error.Message}"); }
}
void Equal<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new InvalidOperationException($"Expected {expected}; received {actual}.");
}

await Check("continuous stroke visits every corner and releases on cancellation", () => { PointerStrokePathTests.Run(); return Task.CompletedTask; });
await Check("rejects unauthenticated requests", async () =>
{
    var response = await Host().HandleAsync(Request("health", "wrong-secret"));
    Equal(false, response.Ok);
    Equal("AUTHENTICATION_FAILED", response.Error?.Code);
});
await Check("rejects unsupported protocol versions", async () =>
{
    var response = await Host().HandleAsync(Request("health", Secret, version: 2));
    Equal("PROTOCOL_VERSION", response.Error?.Code);
});
await Check("rejects unknown methods", async () =>
{
    var response = await Host().HandleAsync(Request("raw_uia", Secret));
    Equal(false, response.Ok);
    Equal("UNKNOWN_OPERATION", response.Error?.Code);
});
await Check("protocol is bounded", () =>
{
    Equal(512 * 1024, NamedPipeRpcHost.MaxMessageBytes);
    return Task.CompletedTask;
});
await Check("coalesced pipe requests receive independent responses", async () =>
{
    var pipeName = $"zyra-computer-use-test-{Guid.NewGuid():N}";
    var host = new NamedPipeRpcHost(pipeName, Secret, Path.Combine(Path.GetTempPath(), "zyra-computer-use-tests", Guid.NewGuid().ToString("N")));
    using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    var serving = host.RunAsync(cancellation.Token);
    using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
    await client.ConnectAsync(cancellation.Token);
    var reader = new StreamReader(client, new UTF8Encoding(false), false, 4096, leaveOpen: true);
    var writer = new StreamWriter(client, new UTF8Encoding(false), 4096, leaveOpen: true) { AutoFlush = true };
    var first = Request("health", Secret);
    var second = Request("health", Secret);
    await writer.WriteAsync($"{JsonSerializer.Serialize(first)}\n{JsonSerializer.Serialize(second)}\n");
    var firstLine = await reader.ReadLineAsync(cancellation.Token) ?? throw new InvalidOperationException("First coalesced response is missing.");
    var secondLine = await reader.ReadLineAsync(cancellation.Token) ?? throw new InvalidOperationException("Second coalesced response is missing.");
    Equal(first.Id, JsonSerializer.Deserialize<RpcResponse>(firstLine)?.Id);
    Equal(second.Id, JsonSerializer.Deserialize<RpcResponse>(secondLine)?.Id);
    await writer.DisposeAsync();
    reader.Dispose();
    cancellation.Cancel();
    try { await serving; } catch (OperationCanceledException) { }
    client.Close();
});
await Check("emergency input signal requires a bounded authenticated request", () =>
{
    Equal(true, NamedPipeRpcHost.IsAuthenticatedEmergencyStop(Request("emergency_stop", Secret), Secret));
    Equal(false, NamedPipeRpcHost.IsAuthenticatedEmergencyStop(Request("emergency_stop", "wrong"), Secret));
    Equal(false, NamedPipeRpcHost.IsAuthenticatedEmergencyStop(Request("emergency_stop", Secret, version: 2), Secret));
    Equal(false, NamedPipeRpcHost.IsAuthenticatedEmergencyStop(Request("action", Secret), Secret));
    return Task.CompletedTask;
});
await Check("emergency stop drops queued selections and input on the same pipe", async () =>
{
    var pipeName = $"zyra-computer-use-test-{Guid.NewGuid():N}";
    var host = new NamedPipeRpcHost(pipeName, Secret, Path.Combine(Path.GetTempPath(), "zyra-computer-use-tests", Guid.NewGuid().ToString("N")));
    using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    var serving = host.RunAsync(cancellation.Token);
    using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
    await client.ConnectAsync(cancellation.Token);
    using var reader = new StreamReader(client, new UTF8Encoding(false), false, 4096, leaveOpen: true);
    var stop = Request("emergency_stop", Secret);
    var selection = Request("select_window", Secret, new { windowToken = "must-not-resume" });
    var action = Request("action", Secret, new { windowToken = "must-not-act" });
    await client.WriteAsync(Encoding.UTF8.GetBytes($"{JsonSerializer.Serialize(stop)}\n{JsonSerializer.Serialize(selection)}\n{JsonSerializer.Serialize(action)}\n"), cancellation.Token);
    var line = await reader.ReadLineAsync(cancellation.Token) ?? throw new InvalidOperationException("Stop response missing.");
    var response = JsonSerializer.Deserialize<RpcResponse>(line);
    Equal(stop.Id, response?.Id);
    Equal(true, response?.Ok);
    await serving.WaitAsync(cancellation.Token);
    try { Equal<string?>(null, await reader.ReadLineAsync(cancellation.Token)); }
    catch (IOException) { /* Windows reports a closed pipe as broken after the stop acknowledgement. */ }
});
await Check("stopping an in-flight held button releases before action resumes", async () =>
{
    var events = new List<uint>();
    var input = new InputStopController(flags => events.Add(flags));
    using var entered = new ManualResetEventSlim();
    using var resume = new ManualResetEventSlim();
    var action = Task.Run(() =>
    {
        try
        {
            input.WithButton(2, 4, () =>
            {
                entered.Set();
                if (!resume.Wait(TimeSpan.FromSeconds(3))) throw new TimeoutException("Fixture action was not resumed.");
                input.ThrowIfStopped();
                throw new InvalidOperationException("Stopped action continued.");
            });
        }
        catch (OperationCanceledException) { }
    });
    if (!entered.Wait(TimeSpan.FromSeconds(3))) throw new TimeoutException("Fixture action did not start.");
    input.Stop();
    Equal("2,4", string.Join(",", events));
    resume.Set();
    await action;
    Equal("2,4", string.Join(",", events));
    try { input.WithButton(2, 4, () => { }); }
    catch (OperationCanceledException) { Equal("2,4", string.Join(",", events)); return; }
    throw new InvalidOperationException("Stopped session accepted another button press.");
});
await Check("observation caching is bounded, action-capable and excludes sensitive values", () =>
{
    var branch = UiAutomationProvider.CreateObservationCache(includeChildren: true);
    var leaf = UiAutomationProvider.CreateObservationCache(includeChildren: false);
    Equal(TreeScope.Element | TreeScope.Children, branch.TreeScope);
    Equal(TreeScope.Element, leaf.TreeScope);
    Equal(AutomationElementMode.Full, branch.AutomationElementMode);
    Equal(false, UiAutomationProvider.ObservationProperties.Contains(ValuePattern.ValueProperty));
    Equal(true, UiAutomationProvider.ObservationProperties.Contains(AutomationElement.IsPasswordProperty));
    Equal(true, UiAutomationProvider.ObservationProperties.Contains(AutomationElement.IsInvokePatternAvailableProperty));
    return Task.CompletedTask;
});
await Check("Space and Spacebar use the bounded native virtual key", () =>
{
    Equal((ushort)0x20, InputProvider.ResolveVirtualKey("Space"));
    Equal((ushort)0x20, InputProvider.ResolveVirtualKey("Spacebar"));
    Equal((ushort)0x20, InputProvider.ResolveVirtualKey("space"));
    Equal((ushort)0x0D, InputProvider.ResolveVirtualKey("Enter"));
    try { InputProvider.ResolveVirtualKey("LaunchUnboundedAction"); }
    catch (InvalidOperationException) { return Task.CompletedTask; }
    throw new InvalidOperationException("Unknown key was accepted.");
});
await Check("native input fallback stays bound to an exact editable control or the selected window", () =>
{
    Equal(false, NamedPipeRpcHost.CanUseWindowInputFallback(new SidecarAction("type", "window-element:1:2", "text", true, null, null, 0, 0, null)));
    Equal(true, NamedPipeRpcHost.CanUseWindowInputFallback(new SidecarAction("type", "window-element:1:2", "text", false, null, null, 0, 0, null)));
    Equal(false, NamedPipeRpcHost.CanUseWindowInputFallback(new SidecarAction("click", "window-element:1:2", null, false, null, null, 0, 0, null)));
    Equal(true, NamedPipeRpcHost.CanUseWindowInputFallback(new SidecarAction("move", null, null, false, null, null, 0, 0, null, X: 20, Y: 30)));
    Equal(true, NamedPipeRpcHost.CanUseWindowInputFallback(new SidecarAction("click", null, null, false, null, null, 0, 0, null, X: 20, Y: 30)));
    Equal(true, NamedPipeRpcHost.CanUseWindowInputFallback(new SidecarAction("drag", null, null, false, null, null, 0, 0, null, FromX: 20, FromY: 30, ToX: 40, ToY: 50)));
    Equal(true, NamedPipeRpcHost.CanUseWindowInputFallback(new SidecarAction("key", null, null, false, "ENTER", null, 0, 0, null)));
    return Task.CompletedTask;
});
await Check("sensitive application policy blocks credential, security, and payment targets", () =>
{
    Equal(true, ControlSecurityPolicy.IsSensitiveApplicationText("Windows Credential Manager"));
    Equal(true, ControlSecurityPolicy.IsSensitiveApplicationText("Payment Wallet"));
    Equal(true, ControlSecurityPolicy.IsSensitiveApplicationText("Zyra Control Cursor"));
    Equal(true, ControlSecurityPolicy.IsSensitiveApplicationText("Zyra Control Indicator"));
    Equal(false, ControlSecurityPolicy.IsSensitiveApplicationText("Notepad"));
    return Task.CompletedTask;
});
await Check("window selection rejects stale opaque tokens", async () =>
{
    var response = await Host().HandleAsync(Request("select_window", Secret, new { windowToken = "window-token:unknown" }));
    Equal(false, response.Ok);
    Equal("STALE_TARGET", response.Error?.Code);
});
await Check("hosted app enumeration removes transient CoreWindow companions", () =>
{
    var windows = WindowRegistry.CollapseHostedCompanions([
        new WindowCandidate("frame", "Calculator", "ApplicationFrameHost", "ApplicationFrameWindow", "frame.exe", 1, false, null),
        new WindowCandidate("core", "Calculator", "CalculatorApp", "Windows.UI.Core.CoreWindow", "calculator.exe", 2, false, null),
        new WindowCandidate("other", "Notepad", "Notepad", "Notepad", "notepad.exe", 3, false, null)
    ]);
    Equal(2, windows.Length);
    Equal(false, windows.Any(window => window.WindowToken == "core"));
    return Task.CompletedTask;
});
await Check("registered app resolution prefers an exact display name", () =>
{
    var apps = new[] { new RegisteredApplication("Calculator", "calculator-id"), new RegisteredApplication("Calculator Plus", "calculator-plus-id") };
    Equal("calculator-id", RegisteredAppLauncher.Resolve("Calculator", apps).CatalogId);
    return Task.CompletedTask;
});
await Check("registered app resolution accepts one unambiguous prefix", () =>
{
    var apps = new[] { new RegisteredApplication("Calculator", "calculator-id"), new RegisteredApplication("Notepad", "notepad-id") };
    Equal("calculator-id", RegisteredAppLauncher.Resolve("Calc", apps).CatalogId);
    return Task.CompletedTask;
});
await Check("registered app resolution rejects ambiguous names", () =>
{
    var apps = new[] { new RegisteredApplication("Visual Studio", "vs-id"), new RegisteredApplication("Visual Studio Code", "code-id") };
    try { RegisteredAppLauncher.Resolve("Visual", apps); }
    catch (InvalidDataException) { return Task.CompletedTask; }
    throw new InvalidOperationException("Ambiguous app search was accepted.");
});

await Check("targeted Escape posts one dismiss pair only to the exact focused child", () =>
{
    var posts = new List<(nint, uint, nuint)>();
    TargetedEscapeDispatcher.Dispatch(10, 42, () => 11, _ => 10, _ => 42,
        (window, message, key, _) => { posts.Add((window, message, key)); return true; }, () => { });
    Equal("(11, 256, 27),(11, 257, 27)", string.Join(",", posts));
    return Task.CompletedTask;
});
await Check("targeted Escape rejects unrelated focus and never posts after emergency stop", () =>
{
    var posts = 0;
    foreach (var outside in new[] { true, false })
    {
        try {
            TargetedEscapeDispatcher.Dispatch(10, 42, () => 11, _ => outside ? 20 : 10, _ => 42,
                (_, _, _, _) => { posts++; return true; }, () => { if (!outside) throw new OperationCanceledException(); });
            throw new Exception("Unsafe Escape was dispatched.");
        } catch (InvalidOperationException) { }
          catch (OperationCanceledException) { }
    }
    Equal(0, posts);
    return Task.CompletedTask;
});
await Check("targeted Escape rejects a different process or changed focused child", () =>
{
    var posts = 0;
    foreach (var changedFocus in new[] { false, true })
    {
        var reads = 0;
        try {
            TargetedEscapeDispatcher.Dispatch(10, 42, () => changedFocus && ++reads > 1 ? 12 : 11, _ => 10, _ => changedFocus ? 42 : 43,
                (_, _, _, _) => { posts++; return true; }, () => { });
            throw new Exception("Stale Escape focus was accepted.");
        } catch (InvalidOperationException) { }
    }
    Equal(0, posts);
    return Task.CompletedTask;
});
await Check("targeted Escape never replays after a partial post failure", () =>
{
    var posts = 0;
    try {
        TargetedEscapeDispatcher.Dispatch(10, 42, () => 11, _ => 10, _ => 42,
            (_, _, _, _) => ++posts == 1, () => { });
        throw new Exception("Failed post was accepted.");
    } catch (InvalidOperationException) { }
    Equal(2, posts);
    return Task.CompletedTask;
});

await Check("pointer motion follows deadlines and stops with held-button release", () => { PointerMotionPacerTests.Run(); return Task.CompletedTask; });

await Check("cached control states distinguish active, inactive, mixed and unsupported patterns", () =>
{
    ControlStateProjectionTests.Run();
    return Task.CompletedTask;
});

await Check("pointer focus requires authority and stops on changed bounds or cancellation", () => { WindowPointerFocusTests.Run(); return Task.CompletedTask; });

await Check("pointer confirmation waits without replay and rejects interference", () => { PointerPositionConfirmationTests.Run(); return Task.CompletedTask; });

if (failures.Count > 0)
{
    foreach (var failure in failures) Console.Error.WriteLine($"FAIL: {failure}");
    return 1;
}
Console.WriteLine($"Zyra computer-use deterministic tests passed ({checkCount} checks).");
return 0;
