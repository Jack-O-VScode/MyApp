@echo off
REM Serves the app on http://localhost:8080 and opens it in your browser.
REM Requires Node.js (https://nodejs.org). Use Edge or Chrome, then click the
REM install icon in the address bar to keep it as a Windows app.
cd /d "%~dp0"
start "" http://localhost:8080
node tools\serve.js 8080
