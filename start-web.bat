@echo off
title Check Zalo Public - Cloudflare
echo ========================================================
echo    DANG KHOI CHAY SERVER VA CLOUDFLARE TUNNEL
echo ========================================================
echo.
echo Link Cloudflare Pages: https://check-zalo.pages.dev
echo.
start "Server Check Zalo" cmd /c "npm run ui"
timeout /t 2 /nobreak >nul
echo.
echo Dang mo duong link HTTPS qua Cloudflare Tunnel...
echo (Sao chep link https://...trycloudflare.com ben duoi de dan vao muc Server tren web)
echo.
.\cloudflared.exe tunnel --url http://127.0.0.1:3000
pause

