$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$IconRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'desktop\resources\branding\tui'
$Source = [Drawing.Image]::FromFile((Join-Path $IconRoot 'source.png'))
function Render-IconFrame([int]$Size) {
  $Bitmap = New-Object Drawing.Bitmap $Size,$Size
  $Graphics = [Drawing.Graphics]::FromImage($Bitmap)
  try {
    $Graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
    $Graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $Graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $Graphics.DrawImage($Source, 0, 0, $Size, $Size)
    $Stream = New-Object IO.MemoryStream
    try { $Bitmap.Save($Stream, [Drawing.Imaging.ImageFormat]::Png); return ,$Stream.ToArray() }
    finally { $Stream.Dispose() }
  } finally { $Graphics.Dispose(); $Bitmap.Dispose() }
}
try {
  [IO.File]::WriteAllBytes((Join-Path $IconRoot 'icon.png'), (Render-IconFrame 512))
  $Sizes = @(16,24,32,48,64,128,256)
  $Frames = @($Sizes | ForEach-Object { ,(Render-IconFrame $_) })
  $Stream = New-Object IO.MemoryStream
  $Writer = New-Object IO.BinaryWriter $Stream
  try {
    $Writer.Write([uint16]0); $Writer.Write([uint16]1); $Writer.Write([uint16]$Sizes.Count)
    $Offset = 6 + 16 * $Sizes.Count
    for ($Index = 0; $Index -lt $Sizes.Count; $Index++) {
      $Dimension = if ($Sizes[$Index] -eq 256) { 0 } else { $Sizes[$Index] }
      $Writer.Write([byte]$Dimension); $Writer.Write([byte]$Dimension)
      $Writer.Write([byte]0); $Writer.Write([byte]0)
      $Writer.Write([uint16]1); $Writer.Write([uint16]32)
      $Writer.Write([uint32]$Frames[$Index].Length); $Writer.Write([uint32]$Offset)
      $Offset += $Frames[$Index].Length
    }
    foreach ($Frame in $Frames) { $Writer.Write([byte[]]$Frame) }
    $Writer.Flush()
    [IO.File]::WriteAllBytes((Join-Path $IconRoot 'icon.ico'), $Stream.ToArray())
  } finally { $Writer.Dispose(); $Stream.Dispose() }
} finally { $Source.Dispose() }
