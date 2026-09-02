using System.IO;
using System.Runtime.InteropServices;
using Zyra.ComputerUse.Security;

namespace Zyra.ComputerUse.Windows;

public sealed record RegisteredApplication(string Name, string CatalogId);

public sealed class RegisteredAppLauncher
{
    public RegisteredApplication Open(string query)
    {
        var requested = ValidateQuery(query);
        return RunOnStaThread(() =>
        {
            object? shellObject = null;
            object? folderObject = null;
            object? itemsObject = null;
            object? selectedItemObject = null;
            try
            {
                var shellType = Type.GetTypeFromProgID("Shell.Application")
                    ?? throw new PlatformNotSupportedException("The Windows registered-app catalog is unavailable.");
                shellObject = Activator.CreateInstance(shellType)
                    ?? throw new InvalidOperationException("The Windows registered-app catalog could not start.");
                dynamic shell = shellObject;
                folderObject = shell.NameSpace("shell:AppsFolder")
                    ?? throw new InvalidOperationException("The Windows registered-app catalog could not open.");
                dynamic folder = folderObject;
                itemsObject = folder.Items();
                dynamic items = itemsObject;
                var applications = new List<RegisteredApplication>();
                foreach (var rawItem in items)
                {
                    object? itemObject = rawItem;
                    try
                    {
                        dynamic item = itemObject;
                        var name = Convert.ToString(item.Name)?.Trim() ?? string.Empty;
                        var catalogId = Convert.ToString(item.Path)?.Trim() ?? string.Empty;
                        if (name.Length is > 0 and <= 256 && catalogId.Length is > 0 and <= 512)
                            applications.Add(new RegisteredApplication(name, catalogId));
                    }
                    finally
                    {
                        ReleaseCom(itemObject);
                    }
                }
                var selected = Resolve(requested, applications);
                if (ControlSecurityPolicy.IsSensitiveApplicationText($"{selected.Name} {selected.CatalogId}"))
                    throw new UnauthorizedAccessException("Security, credential, payment, system-policy, and password-manager applications cannot be opened for computer control.");
                selectedItemObject = folder.ParseName(selected.CatalogId)
                    ?? throw new FileNotFoundException("The selected registered application is no longer available.");
                dynamic selectedItem = selectedItemObject;
                selectedItem.InvokeVerb("open");
                return selected;
            }
            finally
            {
                ReleaseCom(selectedItemObject);
                ReleaseCom(itemsObject);
                ReleaseCom(folderObject);
                ReleaseCom(shellObject);
            }
        });
    }

    public static RegisteredApplication Resolve(string query, IReadOnlyCollection<RegisteredApplication> applications)
    {
        var requested = ValidateQuery(query);
        var exact = applications.Where(app => string.Equals(app.Name.Trim(), requested, StringComparison.OrdinalIgnoreCase)).ToArray();
        if (exact.Length == 1) return exact[0];
        if (exact.Length > 1) throw new InvalidDataException("More than one registered application has that exact name.");

        var prefix = applications.Where(app => app.Name.StartsWith(requested, StringComparison.OrdinalIgnoreCase)).ToArray();
        if (prefix.Length == 1) return prefix[0];
        if (prefix.Length > 1) throw new InvalidDataException("The registered application name is ambiguous. Use its full Start menu name.");

        var contains = applications.Where(app => app.Name.Contains(requested, StringComparison.OrdinalIgnoreCase)).ToArray();
        if (contains.Length == 1) return contains[0];
        if (contains.Length > 1) throw new InvalidDataException("The registered application name is ambiguous. Use its full Start menu name.");
        throw new FileNotFoundException("No registered Windows application matched that name.");
    }

    private static string ValidateQuery(string query)
    {
        var value = query?.Trim() ?? string.Empty;
        if (value.Length is < 1 or > 128 || value.Any(character => char.IsControl(character)))
            throw new InvalidDataException("A registered application name between 1 and 128 characters is required.");
        return value;
    }

    private static T RunOnStaThread<T>(Func<T> operation)
    {
        T? result = default;
        Exception? failure = null;
        using var completed = new ManualResetEventSlim(false);
        var thread = new Thread(() =>
        {
            try { result = operation(); }
            catch (Exception error) { failure = error; }
            finally { completed.Set(); }
        }) { IsBackground = true, Name = "Zyra registered app launcher" };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        if (!completed.Wait(TimeSpan.FromSeconds(8))) throw new TimeoutException("Windows did not resolve the registered application in time.");
        if (failure is not null) throw failure;
        return result!;
    }

    private static void ReleaseCom(object? value)
    {
        if (value is not null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value);
    }
}
