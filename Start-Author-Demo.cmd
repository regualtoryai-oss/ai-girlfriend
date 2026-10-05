@echo off
"%~dp0.venv-voice\Scripts\python.exe" "%~dp0Start-Author-Demo.py" %*
if errorlevel 1 pause
