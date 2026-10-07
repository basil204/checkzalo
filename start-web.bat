@echo off
title Check Zalo Public - Cloudflare
echo ========================================================
echo    DANG KHOI CHAY SERVER VA CLOUDFLARE TUNNEL
echo ========================================================
start "Server Check Zalo" cmd /c "npm run ui"
timeout /t 2 /nobreak >nul
echo.
echo Dang mo duong link HTTPS toan cau qua Cloudflare...
echo.
.\cloudflared.exe tunnel --url http://127.0.0.1:3000
pause
