using System.Text.Json;
using System.Text.Json.Serialization;

namespace Zyra.ComputerUse.Protocol;

public sealed record RpcRequest(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("method")] string Method,
    [property: JsonPropertyName("params")] JsonElement Parameters,
    [property: JsonPropertyName("auth")] string Auth,
    [property: JsonPropertyName("version")] int Version = 1);

public sealed record RpcResponse(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("result")] object? Result = null,
    [property: JsonPropertyName("error")] RpcError? Error = null,
    [property: JsonPropertyName("version")] int Version = 1);

public sealed record RpcError(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("retryable")] bool Retryable = false);

public sealed record WindowCandidate(
    string WindowToken,
    string Title,
    string ApplicationName,
    string WindowClass,
    string ExecutableIdentity,
    int ProcessId,
    bool Blocked,
    string? BlockedReason);

public sealed record SelectedWindow(
    string WindowToken,
    int ProcessId,
    string ExecutableIdentity,
    string ApplicationName,
    string Title,
    long ProcessStartTime);

public sealed record NormalizedElement(
    string ElementRef,
    string Role,
    string? Name,
    string? Value,
    string? Description,
    Bounds? Bounds,
    string[] States,
    string[] Actions,
    bool Sensitive);

public sealed record Bounds(double X, double Y, double Width, double Height);

public sealed record WindowObservation(
    string TargetState,
    string Title,
    NormalizedElement[] Elements,
    string? FocusedElementRef,
    string? ScreenshotRef,
    object? Truncation,
    string[] Redactions,
    string CaptureProvider = "selected-window-printwindow");

public sealed record SidecarAction(
    string Type,
    string? ElementRef,
    string? Text,
    bool Replace,
    string? Key,
    string[]? Modifiers,
    double DeltaX,
    double DeltaY,
    string[]? Values,
    double X = 0,
    double Y = 0,
    double FromX = 0,
    double FromY = 0,
    double ToX = 0,
    double ToY = 0,
    int DurationMs = 0,
    string? Button = null,
    int ClickCount = 1);
