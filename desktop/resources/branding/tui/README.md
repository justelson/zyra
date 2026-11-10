# Terminal icon

The terminal variant uses the Desktop Zyra mark in white on graphite. Its source
artwork is `source.png`; Desktop artwork and colours remain independent.

Run `powershell -NoProfile -File scripts/generate-tui-icon.ps1` from the repository
root to produce `icon.png` and the seven-size `icon.ico` (16–256 px).

Standalone Windows builds embed this ICO into the executable and installer
metadata. Installation copies the same bytes to the owned Windows Terminal
profile and Start menu shortcut. Existing user Terminal settings are preserved.
An arbitrary shell tab keeps its own profile icon; launch the Zyra Terminal
profile to use the branded tab icon.
