@echo off
echo ========================================
echo  Fleet Health Monitor - Start
echo ========================================
echo.
echo Building images and starting containers...
echo.
powershell -ExecutionPolicy Bypass -Command "& '.\ops.ps1' start"
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