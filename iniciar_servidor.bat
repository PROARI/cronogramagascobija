@echo off
title Servidor de Cronograma GLP - SPC
echo ===================================================
echo   Iniciando el servidor de sincronizacion SPC...
echo ===================================================
echo.
node server.js
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] El servidor ha fallado al iniciar o se ha cerrado inesperadamente.
    echo Por favor, verifique que Node.js este instalado.
)
echo.
pause
