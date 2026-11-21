@echo off
title دهاليز الرعب والدم - خادم اللعبة
chcp 65001 >nul
cd /d "%~dp0"
set PORT=3000
set HOST=0.0.0.0
echo ========================================================
echo   🩸 دهاليز الرعب والدم - السيرفر يعمل الآن 🩸
echo ========================================================
echo.
echo   [+] من الكمبيوتر:
echo       http://localhost:3000
echo.
echo   [+] من الهاتف (نفس شبكة الواي فاي):
echo       http://192.168.1.10:3000
echo.
echo   [+] لوحة الأدمن:
echo       http://localhost:3000/admin
echo ========================================================
echo.
"C:\Program Files\nodejs\node.exe" server.js
pause
