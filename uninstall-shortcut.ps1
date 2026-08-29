# 포치 캘린더북 런처 제거 (제어판 "제거"에서 호출됨)
# 바탕화면 바로가기 + 제어판 등록 항목만 삭제한다. 개발 소스 폴더(pochi-desktop)는 그대로 둔다.
$ErrorActionPreference = 'SilentlyContinue'
foreach ($p in @(
  "$env:OneDrive\Desktop\포치 캘린더북.lnk",
  "$env:USERPROFILE\OneDrive\Desktop\포치 캘린더북.lnk",
  "$env:USERPROFILE\Desktop\포치 캘린더북.lnk"
)) { if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force } }
Remove-Item -Path "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PochiCalendarBook" -Recurse -Force
