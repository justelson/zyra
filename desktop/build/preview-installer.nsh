; Personal previews intentionally do not register file associations, Explorer
; actions, a global terminal command, or the stable installation locator.
; NSIS still manages the separately identified Preview app and its own shortcut.
; Keep oneClick/perMachine/APP_FILENAME unchanged: existing Preview installs must
; upgrade in place without moving their install directory or profile.
!macro customHeader
  Caption "Zyra Preview - Dev channel ${VERSION}"
!macroend

!macro customInit
  ${IfNot} ${Silent}
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Install Zyra Preview - Dev channel ${VERSION}?$\r$\n$\r$\nThis is an unsigned development build for testing.$\r$\n$\r$\nIt installs beside Zyra stable and keeps separate settings and chat history. Existing Zyra Preview settings and history are preserved.$\r$\n$\r$\nDev updates are installed manually. This build may contain unfinished changes.$\r$\n$\r$\nChoose OK to install or Cancel to stop." IDOK zyraDevContinue
    Abort
    zyraDevContinue:
  ${EndIf}
!macroend

!macro customInstall
!macroend

!macro customUnInstall
!macroend
