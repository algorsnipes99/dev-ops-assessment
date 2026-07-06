@echo off
echo ========================================
echo  Fleet Health Monitor - Start
echo ========================================
echo.
echo   [1] Start without feeder (production mode)
echo   [2] Start with heartbeat feeder (development)
echo.
choice /c 12 /n /m "Select option (1 or 2): "

if %ERRORLEVEL% equ 1 (
    echo.
    echo Starting database + app only...
    powershell -ExecutionPolicy Bypass -Command "& '.\ops.ps1' start"
) else (
    echo.
    echo Starting database + app + heartbeat feeder...
    powershell -ExecutionPolicy Bypass -Command "& '.\ops.ps1' start -Feeder"
)

if %ERRORLEVEL% equ 0 (
    echo.
    echo Done! Containers are booting.
    echo Open http://localhost:3000/dashboard in your browser.
    echo.
) else (
    echo.
    echo Something went wrong. Check the output above.
)
echo Press any key to exit...
pause >nul