param([Parameter(Mandatory = $true)][int]$TargetProcessId, [Parameter(Mandatory = $true)][string]$ScreenshotPath)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SidecarDpiQuery {
    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, int id);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
    [DllImport("shcore.dll")] public static extern int GetProcessDpiAwareness(IntPtr process, out int awareness);
    public static int Read(int id) {
        var process = OpenProcess(0x1000, false, id);
        if (process == IntPtr.Zero) throw new InvalidOperationException("The owned sidecar process is unavailable.");
        try {
            int awareness;
            var result = GetProcessDpiAwareness(process, out awareness);
            if (result != 0) Marshal.ThrowExceptionForHR(result);
            return awareness;
        } finally { CloseHandle(process); }
    }
}
"@
Add-Type -AssemblyName System.Drawing
$image = [Drawing.Image]::FromFile($ScreenshotPath)
try {
    @{ awareness = [SidecarDpiQuery]::Read($TargetProcessId); width = $image.Width; height = $image.Height } | ConvertTo-Json -Compress
} finally { $image.Dispose() }
