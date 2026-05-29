; installer.nsh — Custom NSIS hooks for CypherShell

; ── Uninstaller: ask user whether to delete app data ─────────────────────────
; This macro runs BEFORE files are removed, so the user gets the choice first.

!macro customRemoveFiles
  ; Show a Yes/No dialog asking about data deletion
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "Delete all CypherShell data?$\r$\n$\r$\nThis will permanently remove:$\r$\n$\t\
• SSH connection profiles$\r$\n$\t\
• Stored SSH keys$\r$\n$\t\
• Audit logs$\r$\n$\t\
• Application settings$\r$\n$\r$\n\
[YES] to delete all data   [NO] to keep data" \
    IDNO keep_data

    ; User chose YES — delete the app's userData folder
    RMDir /r "$APPDATA\cyphershell"
    RMDir /r "$LOCALAPPDATA\cyphershell"

  keep_data:
!macroend
