@echo off
title IBVAP Border Surveillance Platform - Master Launcher
color 0b
echo =========================================================================
echo   IBVAP - Intelligent Border Video Analytics Platform (SIH PS 26187)
echo =========================================================================
echo.

echo [1/3] Ensuring PostgreSQL Database service is running...
net start postgresql-x64-18 >nul 2>&1
timeout /t 1 /nobreak >nul

echo [2/3] Starting IBVAP Backend (FastAPI + YOLOv8 + ANPR Engine + Live Streams)...
start "IBVAP Backend [Port 8000]" cmd /k "cd /d "%~dp0backend" && "C:\Users\Arnav\AppData\Local\Programs\Python\Python310\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

timeout /t 5 /nobreak >nul

echo [3/3] Starting Command Center React Frontend Dashboard...
start "IBVAP Frontend [Port 5173]" cmd /k "cd /d "%~dp0frontend" && npm.cmd run dev"

timeout /t 3 /nobreak >nul

echo.
echo Launching IBVAP Command Center in your browser...
start http://localhost:5173

echo.
echo =========================================================================
echo   [SUCCESS] All IBVAP systems launched successfully!
echo   Frontend Dashboard : http://localhost:5173
echo   Backend API & Docs : http://localhost:8000/docs
echo =========================================================================
echo.
echo Keep the backend and frontend terminal windows open.
echo You can close or minimize this launcher window.
timeout /t 5 >nul
