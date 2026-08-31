@echo off
chcp 65001 >nul
title 학원 관리 시스템
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Node.js 가 설치되어 있지 않습니다.
  echo     https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)

if not exist "academy\node_modules" (
  echo.
  echo 처음 실행이라 필요한 파일을 설치합니다. 몇 분 걸릴 수 있습니다...
  echo.
  call npm install --prefix academy
  if errorlevel 1 (
    echo.
    echo [!] 설치에 실패했습니다. 인터넷 연결을 확인해 주세요.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo ==============================================
echo  학원 관리 시스템을 시작합니다.
echo  주소 : http://localhost:3100
echo  계정 : admin / 1234
echo.
echo  이 창을 닫으면 프로그램이 종료됩니다.
echo ==============================================
echo.

start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 10; Start-Process 'http://localhost:3100'"
call npm run dev --prefix academy

pause
