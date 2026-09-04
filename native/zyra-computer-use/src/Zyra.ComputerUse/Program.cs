using System.IO;
using System.Windows.Forms;
using Zyra.ComputerUse.Protocol;

if (!OperatingSystem.IsWindows())
{
    Console.Error.WriteLine("Zyra computer use is available only on Windows.");
    return 2;
}

if (args.Contains("--test-window", StringComparer.Ordinal))
{
    ApplicationConfiguration.Initialize();
    using var form = new Form { Text = "Zyra Computer Use Smoke Target", Width = 520, Height = 290, StartPosition = FormStartPosition.CenterScreen };
    var input = new TextBox { Name = "SmokeInput", AccessibleName = "Smoke input", Left = 24, Top = 44, Width = 440 };
    var readOnly = new TextBox { Name = "SmokeReadOnly", AccessibleName = "Read-only smoke value", Text = "Locked", ReadOnly = true, Left = 24, Top = 82, Width = 440 };
    var button = new Button { Name = "SmokeButton", AccessibleName = "Apply smoke input", Text = "Apply", Left = 24, Top = 124, Width = 120 };
    var output = new Label { Name = "SmokeOutput", AccessibleName = "Smoke output: Ready", AccessibleDescription = "Ready", Text = "Ready", Left = 24, Top = 170, Width = 440 };
    button.Click += (_, _) =>
    {
        output.Text = input.Text;
        output.AccessibleName = $"Smoke output: {input.Text}";
        output.AccessibleDescription = input.Text;
    };
    form.Controls.AddRange([input, readOnly, button, output]);
    Application.Run(form);
    return 0;
}

var pipeName = ReadArgument(args, "--pipe");
var artifactDirectory = ReadArgument(args, "--artifacts");
if (string.IsNullOrWhiteSpace(pipeName) || !pipeName.StartsWith("zyra-computer-use-", StringComparison.Ordinal))
{
    Console.Error.WriteLine("A bounded Zyra named-pipe identity is required.");
    return 2;
}
if (string.IsNullOrWhiteSpace(artifactDirectory))
{
    Console.Error.WriteLine("A sidecar screenshot artifact directory is required.");
    return 2;
}

// The initial secret arrives over protected stdin and never appears in argv, process listings, or logs.
var authSecret = await Console.In.ReadLineAsync();
if (string.IsNullOrWhiteSpace(authSecret) || authSecret.Length < 32 || authSecret.Length > 256)
{
    Console.Error.WriteLine("The inherited sidecar authentication secret is invalid.");
    return 3;
}

using var shutdown = new CancellationTokenSource();
Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; shutdown.Cancel(); };
var host = new NamedPipeRpcHost(pipeName, authSecret, Path.GetFullPath(artifactDirectory));
try
{
    await host.RunAsync(shutdown.Token);
    return 0;
}
catch (OperationCanceledException)
{
    return 0;
}
catch (Exception error)
{
    Console.Error.WriteLine($"Sidecar failed: {error.GetType().Name}");
    return 1;
}

static string? ReadArgument(string[] args, string name)
{
    var index = Array.IndexOf(args, name);
    return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
}
