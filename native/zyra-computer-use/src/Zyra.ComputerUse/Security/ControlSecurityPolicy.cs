using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Zyra.ComputerUse.Security;

public static class ControlSecurityPolicy
{
    private static readonly string[] BlockedNames =
    [
        "credential", "password", "keepass", "1password", "bitwarden", "wallet", "payment",
        "securityhealth", "windowsdefender", "regedit", "taskmgr", "logonui", "consent", "lsass",
        "zyra control cursor", "zyra control indicator"
    ];

    public static bool IsSensitiveApplicationText(string value) =>
        BlockedNames.Any(name => value.Contains(name, StringComparison.OrdinalIgnoreCase));

    public static string? BlockReason(Process process, string title)
    {
        var combined = $"{process.ProcessName} {process.MainModule?.FileName ?? string.Empty} {title}";
        if (IsSensitiveApplicationText(combined))
            return "Security, credential, payment, system-policy, and password-manager windows are blocked.";
        if (process.SessionId != Process.GetCurrentProcess().SessionId)
            return "The window belongs to another user session.";
        if (GetIntegrityLevel(process.Id) > GetIntegrityLevel(Environment.ProcessId))
            return "Zyra cannot inject input into a higher-integrity process.";
        return null;
    }

    public static int GetIntegrityLevel(int processId)
    {
        var processHandle = OpenProcess(0x1000, false, processId);
        if (processHandle == nint.Zero) return int.MaxValue;
        try
        {
            if (!OpenProcessToken(processHandle, 0x0008, out var token)) return int.MaxValue;
            try
            {
                GetTokenInformation(token, 25, nint.Zero, 0, out var length);
                var buffer = Marshal.AllocHGlobal(length);
                try
                {
                    if (!GetTokenInformation(token, 25, buffer, length, out _)) return int.MaxValue;
                    var sid = Marshal.ReadIntPtr(buffer);
                    var count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
                    return Marshal.ReadInt32(GetSidSubAuthority(sid, count - 1));
                }
                finally { Marshal.FreeHGlobal(buffer); }
            }
            finally { CloseHandle(token); }
        }
        finally { CloseHandle(processHandle); }
    }

    [DllImport("kernel32.dll")] private static extern nint OpenProcess(uint access, bool inherit, int processId);
    [DllImport("advapi32.dll")] private static extern bool OpenProcessToken(nint process, uint access, out nint token);
    [DllImport("advapi32.dll")] private static extern bool GetTokenInformation(nint token, int tokenInfoClass, nint tokenInfo, int length, out int returnLength);
    [DllImport("advapi32.dll")] private static extern nint GetSidSubAuthorityCount(nint sid);
    [DllImport("advapi32.dll")] private static extern nint GetSidSubAuthority(nint sid, int index);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(nint handle);
}
