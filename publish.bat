@echo off
chcp 65001>nul 2>&1
setlocal enabledelayedexpansion

REM ==========================================================
REM  pdf2zh-desktop 一键打包发布脚本
REM  用法:
REM    publish.bat              -> 同步代码 + 打包 + 上传到最新 tag 的 Release
REM    publish.bat 2.3.20       -> 指定版本号（tag 须为 v2.3.20）
REM    publish.bat --local      -> 只同步 + 打包，不上传（本地验证用）
REM  前置条件: 已安装 GitHub CLI (gh) 并登录
REM ==========================================================

set "REPO=%~dp0"
set "TARGET=%USERPROFILE%\Desktop\pdf2zh-desktop-win"
set "RELEASE_DIR=%REPO%.release"
set "UPLOAD=1"

REM ---- 解析参数 ----
set "VER=%~1"
if /i "%VER%"=="--local" (
    set "UPLOAD=0"
    set "VER="
)
if "%VER%"=="" (
    for /f %%v in ('git -C "%REPO%" describe --tags --abbrev=0 2^>nul') do set "VER=%%v"
)
if "%VER%"=="" set "VER=2.3.19"
set "VER=%VER:v=%"
set "TAG=v%VER%"
set "ZIP=%RELEASE_DIR%\pdf2zh-desktop-win-v%VER%.zip"

echo ============================================
echo  pdf2zh-desktop 发布工具  v%VER%
echo ============================================

REM ---- 0. 校验 ----
where gh >nul 2>&1 || (echo [错误] 未找到 GitHub CLI，请先安装: winget install GitHub.cli && pause && exit /b 1)
if not exist "%TARGET%" (echo [错误] 桌面副本不存在: %TARGET% && pause && exit /b 1)

REM ---- 1. 同步代码到桌面副本（打包源）----
echo [1/4] 同步代码到桌面副本...
robocopy "%REPO%ui" "%TARGET%ui" /E /XD __pycache__ /NFL /NDL /NJH /NJS
if %errorlevel% GEQ 8 (echo [错误] 同步 ui 代码失败 && pause && exit /b 1)
robocopy "%REPO%core\site-packages\pdf2zh" "%TARGET%core\site-packages\pdf2zh" /E /XD __pycache__ /NFL /NDL /NJH /NJS
if %errorlevel% GEQ 8 (echo [错误] 同步 pdf2zh 代码失败 && pause && exit /b 1)
copy /Y "%REPO%_launcher.py" "%TARGET%_launcher.py" >nul
copy /Y "%REPO%install.bat" "%TARGET%install.bat" >nul
copy /Y "%REPO%pdf2zh.bat" "%TARGET%pdf2zh.bat" >nul
copy /Y "%REPO%README.md" "%TARGET%README.md" >nul
copy /Y "%REPO%README_EN.md" "%TARGET%README_EN.md" >nul
copy /Y "%REPO%updates.json" "%TARGET%updates.json" >nul
echo        完成

REM ---- 2. 打包 zip ----
echo [2/4] 打包 zip（首次约 1-2 分钟）...
if not exist "%RELEASE_DIR%" mkdir "%RELEASE_DIR%"
if not exist "%RELEASE_DIR%\pdf2zh-desktop-win-v%VER%" (
    mklink /J "%RELEASE_DIR%\pdf2zh-desktop-win-v%VER%" "%TARGET%" >nul || (echo [错误] 创建 junction 失败 && pause && exit /b 1)
)
if exist "%ZIP%" del /Q "%ZIP%"
tar -a -c -f "%ZIP%" ^
    --exclude="logs" --exclude="pdf2zh_files" --exclude="__pycache__" ^
    --exclude="*.pyc" --exclude="*.sqlite" --exclude="*.db" --exclude=".vs" ^
    -C "%RELEASE_DIR%" pdf2zh-desktop-win-v%VER%
if errorlevel 1 (echo [错误] 打包失败 && pause && exit /b 1)
echo        完成: %ZIP%

REM ---- 3. 上传 Release ----
if "%UPLOAD%"=="0" (
    echo [3/4] 已跳过上传（--local 模式）
    echo [4/4] 全部完成! 本地包: %ZIP%
    pause
    exit /b 0
)
echo [3/4] 上传到 GitHub Release %TAG%...
gh release upload %TAG% "%ZIP%" --clobber
if errorlevel 1 (echo [错误] 上传失败，请检查 Release %TAG% 是否存在 && pause && exit /b 1)
echo [4/4] 全部完成!
echo         在线地址: https://github.com/GW19ddd/pdf2zh-desktop/releases/tag/%TAG%
pause
exit /b 0
