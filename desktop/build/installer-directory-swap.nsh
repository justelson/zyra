!ifndef ZYRA_INSTALLER_DIRECTORY_SWAP
!define ZYRA_INSTALLER_DIRECTORY_SWAP

; electron-builder normally moves each old file into its private rollback
; directory. A same-volume directory rename avoids that per-file move pass.
; Its normal plugin-directory cleanup still removes the retired application.
!macro customRemoveFiles
  ${If} ${isUpdated}
    InitPluginsDir
    SetOutPath "$TEMP"
    ClearErrors
    Rename "$INSTDIR" "$PLUGINSDIR\old-install"
    ${If} ${Errors}
      ; A different TEMP volume or a locked directory may prevent the rename.
      ; Preserve the builder's file-by-file fallback and partial-move recovery.
      DetailPrint "Folder swap unavailable; using file-by-file replacement."
      CreateDirectory "$PLUGINSDIR\old-install"
      Push ""
      Call un.atomicRMDir
      Pop $R0
      ${If} $R0 != 0
        DetailPrint "File is busy, aborting: $R0"
        Push ""
        Call un.restoreFiles
        Pop $R0
        Abort 'Cannot retire the previous application files.'
      ${EndIf}
      SetOutPath "$TEMP"
      RMDir /r "$INSTDIR"
    ${Else}
      DetailPrint "Previous application retired with one folder swap."
    ${EndIf}
  ${Else}
    ; Ordinary uninstallation keeps electron-builder's existing behavior.
    SetOutPath "$TEMP"
    RMDir /r "$INSTDIR"
  ${EndIf}
!macroend
!endif
