; Input/output: $0. Disk/share roots receive a dedicated product directory.
; Preserve explicitly chosen folders; inputs without a root remain for validation.
Function AurumNormalizeInstallPath
  Push $1
  Push $2
  ${GetRoot} "$0" $1
  ${If} $1 != ""
    ; A bare drive (D:) must mean its root, not its process working directory.
    ${If} $0 == $1
      StrCpy $0 "$1\${PRODUCTNAME}"
    ${Else}
      System::Call 'kernel32::GetFullPathNameW(w r0,i ${NSIS_MAX_STRLEN},w .r1,p0) i .r2'
      ${If} $2 > 0
      ${AndIf} $2 < ${NSIS_MAX_STRLEN}
        StrCpy $0 $1
      ${EndIf}
      ${GetRoot} "$0" $1
      StrCpy $2 $0
      aurum_trim_root_separator:
        StrCpy $1 $2 1 -1
        ${If} $1 == "\"
          StrCpy $2 $2 -1
          Goto aurum_trim_root_separator
        ${EndIf}
      ${GetRoot} "$0" $1
      ${If} $1 != ""
      ${AndIf} $2 == $1
        StrCpy $0 "$1\${PRODUCTNAME}"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $2
  Pop $1
FunctionEnd
