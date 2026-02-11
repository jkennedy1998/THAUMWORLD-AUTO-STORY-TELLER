@echo off
REM Start all THAUMWORLD services with phi4-mini model
REM Run this script instead of 'npm run dev' to ensure all services start

echo Starting THAUMWORLD services with phi4-mini model...
echo.

REM Set environment variables for all services
set INTERPRETER_MODEL=phi4-mini
set RENDERER_MODEL=phi4-mini
set NPC_AI_MODEL=phi4-mini
set OLLAMA_HOST=http://localhost:11434

echo Environment variables set:
echo   INTERPRETER_MODEL=%INTERPRETER_MODEL%
echo   RENDERER_MODEL=%RENDERER_MODEL%
echo   NPC_AI_MODEL=%NPC_AI_MODEL%
echo.

REM Start each service in a new window
echo Starting services...

start "Interface Program" cmd /c "npx tsx src/interface_program/main.ts"
timeout /t 1 /nobreak >nul

REM ARCHIVED - interpreter_ai moved to archive/, communication system now in interface_program
REM start "Interpreter AI" cmd /c "npx tsx src/interpreter_ai/main.ts"
REM timeout /t 1 /nobreak >nul

start "Data Broker" cmd /c "npx tsx src/data_broker/main.ts"
timeout /t 1 /nobreak >nul

start "Rules Lawyer" cmd /c "npx tsx src/rules_lawyer/main.ts"
timeout /t 1 /nobreak >nul

start "Renderer AI" cmd /c "npx tsx src/renderer_ai/main.ts"
timeout /t 1 /nobreak >nul

start "Roller" cmd /c "npx tsx src/roller/main.ts"
timeout /t 1 /nobreak >nul

start "State Applier" cmd /c "npx tsx src/state_applier/main.ts"
timeout /t 1 /nobreak >nul

start "NPC AI" cmd /c "npx tsx src/npc_ai/main.ts"
timeout /t 1 /nobreak >nul

echo.
echo All services started! Opening game window...
timeout /t 3 /nobreak >nul

REM Start Vite dev server
start "Vite Dev Server" cmd /c "npx vite"
timeout /t 5 /nobreak >nul

REM Wait for Vite to be ready, then start Electron
:wait_for_vite
curl -s http://localhost:5173 >nul 2>&1
if errorlevel 1 (
    echo Waiting for Vite to start...
    timeout /t 2 /nobreak >nul
    goto wait_for_vite
)

echo Vite is ready! Starting Electron...
npx electron .

echo.
echo All systems running!