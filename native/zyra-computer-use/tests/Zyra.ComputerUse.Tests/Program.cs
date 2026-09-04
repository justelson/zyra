using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using Zyra.ComputerUse.Protocol;
using Zyra.ComputerUse.Security;
using Zyra.ComputerUse.Windows;

const string Secret = "0123456789abcdef0123456789abcdef";
var failures = new List<string>();

NamedPipeRpcHost Host() => new("zyra-computer-use-test", Secret, Path.Combine(Path.GetTempPath(), "zyra-computer-use-tests", Guid.NewGuid().ToString("N")));
RpcRequest Request(string method, string auth, object? parameters = null, int version = 1)
{
    using var document = JsonDocument.Parse(JsonSerializer.Serialize(parameters ?? new { }));
    return new RpcRequest(Guid.NewGuid().ToString("N"), method, document.RootElement.Clone(), auth, version);
}
async Task Check(string name, Func<Task> body)
{
    try { await body(); }
    catch (Exception error) { failures.Add($"{name}: {error.Message}"); }
}
void Equal<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new InvalidOperationException($"Expected {expected}; received {actual}.");
}

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

if (failures.Count > 0)
{
    foreach (var failure in failures) Console.Error.WriteLine($"FAIL: {failure}");
    return 1;
}
Console.WriteLine("Zyra computer-use deterministic tests passed (12 checks).");
return 0;
