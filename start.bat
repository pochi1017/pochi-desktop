@echo off
cd /d "%~dp0"
rem 포치 데스크톱 앱 실행 (로컬 electron 직접 호출)
start "" "%~dp0node_modules\.bin\electron.cmd" "%~dp0"
exit
