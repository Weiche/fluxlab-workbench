Target amd64-unicode
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
Name "FluxLab"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\FluxLab"
RequestExecutionLevel user
SetCompressor /FINAL zlib
!define MUI_ICON "${APPICON}"
!define MUI_UNICON "${APPICON}"
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\FluxLab.exe"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK "FluxLab 需要 64 位 Windows。"
    Abort
  ${EndIf}
FunctionEnd
!macro RequireClosedWorkbench
  IfFileExists "$INSTDIR\FluxLab.exe" check_workbench file_ready
  check_workbench:
    System::Call 'kernel32::CreateFileW(w "$INSTDIR\FluxLab.exe", i 0x40000000, i 0, p 0, i 3, i 0, p 0) p.r0'
    ${If} $0 == -1
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "请关闭 FluxLab 后重试。" /SD IDCANCEL IDRETRY check_workbench
      SetErrorLevel 2
      Abort
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r0)'
  file_ready:
!macroend
Section "FluxLab"
  !insertmacro RequireClosedWorkbench
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}/*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortCut "$SMPROGRAMS\FluxLab.lnk" "$INSTDIR\FluxLab.exe" "" "$INSTDIR\FluxLab.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FluxLab" "DisplayName" "FluxLab 电机分析工作台"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FluxLab" "DisplayVersion" "1.0.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FluxLab" "DisplayIcon" "$INSTDIR\FluxLab.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FluxLab" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd
Section "Uninstall"
  !insertmacro RequireClosedWorkbench
  Delete "$SMPROGRAMS\FluxLab.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FluxLab"
  !include "${UNINSTALL_FILES}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "FluxLab"
VIAddVersionKey "FileDescription" "FluxLab 电机稳态分析工作台安装程序"
VIAddVersionKey "FileVersion" "1.0.0"
VIAddVersionKey "LegalCopyright" "FluxLab"
