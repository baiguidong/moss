!ifndef BUILD_UNINSTALLER
Function PrepareMossInstallation
  ClearErrors
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --prepare-install' $9
  ${If} ${Errors}
    StrCpy $9 1
  ${EndIf}
FunctionEnd

!macro customInstall
  SetDetailsPrint textonly
  DetailPrint "Preparing Node.js, Python, Git Bash and bundled Apps..."
  SetDetailsPrint none

  moss_prepare_retry:
    StrCpy $9 1
    ${If} ${UAC_IsInnerInstance}
      !insertmacro UAC_AsUser_Call Function PrepareMossInstallation ${UAC_SYNCREGISTERS}|${UAC_SYNCINSTDIR}
    ${Else}
      Call PrepareMossInstallation
    ${EndIf}
    ${If} $9 != 0
      ${IfNot} ${Silent}
        MessageBox MB_RETRYCANCEL|MB_ICONSTOP "Moss setup could not prepare the bundled components. See .moss\logs\moss.log in your user folder." IDRETRY moss_prepare_retry
      ${EndIf}
      SetErrorLevel 1
      Abort
    ${EndIf}
!macroend
!endif
