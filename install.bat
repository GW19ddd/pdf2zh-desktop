@echo off
chcp 65001>nul 2>&1
setlocal enabledelayedexpansion

:: pdf2zh 翻译工具 - 安装配置脚本
title pdf2zh 翻译工具 - 安装配置

echo ================================================================
echo   pdf2zh 翻译工具 v2.3.19 - 安装配置脚本
echo   PDF 翻译工作台（桌面版）
echo ================================================================
echo.

:: 检查管理员权限（仅提示，不强制）
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [信息] 当前以管理员权限运行
) else (
    echo [提示] 当前非管理员权限，如安装 VC++ 运行库失败请右键以管理员运行
)

:: 获取安装目录（当前脚本所在目录）
set "INSTALL_DIR=%~dp0"
echo [信息] 安装目录: %INSTALL_DIR%

:: 检查系统版本
echo.
echo [1/6] 检查系统版本...
ver | find "10.0" >nul
if %errorlevel% == 0 (
    echo [OK] Windows 10/11 64 位系统
) else (
    echo [错误] 不支持当前系统版本
    echo 请使用 Windows 10/11 64 位系统
    pause
    exit /b 1
)

:: 安装 VC++ Redistributable
echo.
echo [2/6] 检查 Visual C++ 运行库...
reg query "HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" >nul 2>&1
if %errorlevel% == 0 (
    echo [OK] Visual C++ Redistributable 已安装
) else (
    echo [!] 未检测到 Visual C++ Redistributable
    if exist "%INSTALL_DIR%VC_redist.x64.exe" (
        echo 正在安装 VC++ 运行库...
        "%INSTALL_DIR%VC_redist.x64.exe" /quiet /norestart
        if %errorlevel% == 0 (
            echo [OK] VC++ 运行库安装完成
        ) else (
            echo [错误] VC++ 运行库安装失败，请右键以管理员身份重新运行
            pause
            exit /b 1
        )
    ) else (
        echo [错误] 未找到 VC_redist.x64.exe 文件
        echo 请下载 https://aka.ms/vs/17/release/vc_redist.x64.exe 后重试
        pause
        exit /b 1
    )
)

:: 创建运行所需目录
echo.
echo [3/6] 创建运行目录...
mkdir "%INSTALL_DIR%pdf2zh_files" 2>nul
mkdir "%INSTALL_DIR%logs" 2>nul
echo [OK] 运行目录已就绪

:: 检查 Python 运行时
echo.
echo [4/6] 检查 Python 运行时...
if exist "%INSTALL_DIR%core\runtime\pythonw.exe" (
    echo [OK] Python 运行时已就绪
) else (
    echo [错误] Python 运行时缺失，请重新解压完整安装包
    pause
    exit /b 1
)

:: 检查主程序
echo.
echo [5/6] 检查主程序...
if exist "%INSTALL_DIR%core\site-packages\pdf2zh\gui_pyqt5.py" (
    echo [OK] 主程序文件完整
) else (
    echo [错误] 主程序文件缺失，请重新解压完整安装包
    pause
    exit /b 1
)

:: 创建桌面快捷方式
echo.
echo [6/6] 创建桌面快捷方式...
set "SHORTCUT_NAME=pdf2zh 翻译工具.lnk"

powershell -NoProfile -Command "try { $ws = New-Object -ComObject WScript.Shell; $desktop = [Environment]::GetFolderPath('Desktop'); $lnk = Join-Path $desktop $env:SHORTCUT_NAME; $s = $ws.CreateShortcut($lnk); $s.TargetPath = Join-Path $env:INSTALL_DIR 'pdf2zh.bat'; $s.WorkingDirectory = $env:INSTALL_DIR; $s.Description = 'pdf2zh 翻译工具 - PDF 翻译工作台'; $s.Save(); if (Test-Path $lnk) { Write-Host 'shortcut created'; exit 0 } else { exit 1 } } catch { Write-Host $_.Exception.Message; exit 1 }"

if %errorlevel% == 0 (
    echo [OK] 桌面快捷方式已创建
) else (
    echo [!] 桌面快捷方式创建失败，可直接双击运行 pdf2zh.bat
)

:: 安装完成提示
echo.
echo ================================================================
echo   安装配置完成
echo ================================================================
echo.
echo 安装信息:
echo   - 安装目录: %INSTALL_DIR%
echo   - 启动方式: 双击桌面快捷方式 或 运行 pdf2zh.bat
echo   - 输出目录: pdf2zh_files\
echo.
echo 使用说明:
echo   1. 双击桌面快捷方式启动 pdf2zh 翻译工具
echo   2. 选择 PDF 文件并设置翻译选项
echo   3. 翻译完成后自动保存到 pdf2zh_files 目录
echo   4. 支持 Zotero 联动翻译，可在设置页启用
echo.
echo 项目地址:
echo   - 主页: https://github.com/GW19ddd/pdf2zh-desktop
echo   - 反馈: https://github.com/GW19ddd/pdf2zh-desktop/issues
echo.

choice /c YN /m "是否立即启动 pdf2zh 翻译工具?"
if %errorlevel% == 1 (
    echo 正在启动...
    start "" "%INSTALL_DIR%pdf2zh.bat"
)

echo 安装配置完成，感谢使用 pdf2zh 翻译工具
pause
