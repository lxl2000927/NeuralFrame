; Uninstalling the app does not touch any game folder: Restore originals is
; what puts a game back, from the backup it keeps in that game's own folder.
; People uninstalled first and were left with ReShade in their games (#266),
; so the uninstaller says so before it goes, and offers to stop. It stays
; silent during an update, which runs the old uninstaller on its own.
!macro customUnInit
  ${ifNot} ${isUpdated}
    IfSilent +3
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "卸载管理器不会删除游戏中的插件或原始备份，也会保留组件库、游戏列表和版本锁定记录。$\r$\n$\r$\n如需恢复游戏，请先打开管理器，对对应游戏执行“恢复原始文件”。$\r$\n$\r$\n是否继续卸载管理器？" IDOK +2
    Quit
  ${endIf}
!macroend
