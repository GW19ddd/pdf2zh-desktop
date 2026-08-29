"""
PaperFlow 启动器
由 paperflow.vbs 调用，使用 pythonw.exe 运行（无控制台窗口）
错误写入日志文件，并通过 Qt 对话框提示用户
"""
import sys
import os
import traceback
from pathlib import Path
from datetime import datetime

# pythonw.exe 没有控制台，sys.stdout/stderr 为 None，
# 会导致 tqdm 等库写入时崩溃 (AttributeError: 'NoneType' object has no attribute 'write')
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

APP_DIR = Path(__file__).parent
LOG_DIR = APP_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / f"startup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"


def log(msg: str):
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}\n")


def show_error_dialog(title: str, message: str):
    """尝试用 Qt 显示错误，失败则用 Windows 原生对话框"""
    try:
        from PyQt5.QtWidgets import QApplication, QMessageBox
        _app = QApplication.instance() or QApplication(sys.argv)
        msg_box = QMessageBox()
        msg_box.setWindowTitle(title)
        msg_box.setText(message)
        msg_box.setIcon(QMessageBox.Critical)
        msg_box.setDetailedText(f"日志文件: {LOG_FILE}")
        msg_box.exec_()
    except Exception:
        # 后备: 使用 Windows MessageBox via ctypes
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(
                0,
                f"{message}\n\n日志文件: {LOG_FILE}",
                title,
                0x10,  # MB_ICONERROR
            )
        except Exception:
            pass


def preload_onnxruntime():
    """在 PyQt5 之前预加载 OnnxRuntime，避免 DLL 搜索路径冲突。

    PyQt5 会修改 Windows DLL 搜索路径，导致 OnnxRuntime 的
    onnxruntime_pybind11_state.pyd 无法找到 VC++ DLL 而加载失败。
    必须在任何 PyQt5 导入之前完成 OnnxRuntime 的加载。
    """
    import threading

    app_dir = str(APP_DIR)

    if hasattr(os, 'add_dll_directory'):
        runtime_dir = os.path.join(app_dir, 'core', 'runtime')
        if os.path.isdir(runtime_dir):
            os.add_dll_directory(os.path.abspath(runtime_dir))

        onnx_dll_dir = os.path.join(app_dir, 'core', 'site-packages', 'onnxruntime', 'capi')
        if os.path.isdir(onnx_dll_dir):
            os.add_dll_directory(os.path.abspath(onnx_dll_dir))

    result = [None]
    def _load():
        try:
            import onnxruntime
            import onnx
            result[0] = onnxruntime.__version__
        except Exception as e:
            result[0] = f"ERROR: {e}"

    t = threading.Thread(target=_load, daemon=True)
    t.start()
    t.join(timeout=30)  # 等待加载完成（AI布局检测必须）

    if t.is_alive():
        log("OnnxRuntime 预加载超时（30秒），继续启动")
    elif result[0] and not str(result[0]).startswith("ERROR"):
        log(f"OnnxRuntime 预加载成功: {result[0]}")
    else:
        log(f"OnnxRuntime 预加载失败（AI布局检测将不可用）: {result[0]}")


def ensure_window_visible(window, app):
    """确保窗口在可见屏幕范围内并居中显示（兼容 DPI 缩放）。"""
    screen = app.primaryScreen().availableGeometry()
    # availableGeometry 已经是逻辑像素，直接用
    sw, sh = screen.width(), screen.height()
    w = min(int(sw * 0.85), 1400)
    h = min(int(sh * 0.85), 900)
    # 低分辨率/高缩放时降低最小值
    w = max(w, min(860, sw - 40))
    h = max(h, min(560, sh - 40))
    window.resize(w, h)
    x = screen.x() + (sw - w) // 2
    y = screen.y() + (sh - h) // 2
    window.move(x, y)
    log(f"屏幕逻辑分辨率: {sw}x{sh}, 窗口: {w}x{h}")


def _parse_cli_args(argv):
    """v2.3.4: 解析 Zotero 右键唤起的命令行参数
    支持: paperflow.exe [--format=side_by_side|dual|mono|all] [--auto] [--silent]
                    [--zotero-key=XXXXXXXX] [--zotero-link-mode=0|1|2|3] <file.pdf>
    --zotero-key / --zotero-link-mode: v1.0.20 起由插件传入, 用于对 zotmoov 等移动过的链接附件做 Zotero 回写
    """
    result = {"file": None, "format": None, "auto": False, "silent": False,
              "zotero_key": None, "zotero_link_mode": None}
    try:
        for arg in argv[1:]:
            if arg.startswith("--format="):
                fmt = arg.split("=", 1)[1].strip()
                if fmt in ("mono", "dual", "side_by_side", "all"):
                    result["format"] = fmt
            elif arg == "--auto":
                result["auto"] = True
            elif arg == "--silent":
                result["silent"] = True
            elif arg.startswith("--zotero-key="):
                result["zotero_key"] = arg.split("=", 1)[1].strip()
            elif arg.startswith("--zotero-link-mode="):
                mode = arg.split("=", 1)[1].strip()
                result["zotero_link_mode"] = int(mode) if mode.isdigit() else None
            elif arg.lower().endswith(".pdf") and os.path.isfile(arg):
                result["file"] = arg
    except Exception:
        pass
    return result


def main():
    log("=== PaperFlow 启动 ===")
    log(f"Python: {sys.version}")
    log(f"工作目录: {os.getcwd()}")

    # 设置 Qt 插件路径，避免与系统中其他 Qt 安装冲突
    qt_plugin_path = str(APP_DIR / "core" / "site-packages" / "PyQt5" / "Qt5" / "plugins")
    os.environ["QT_PLUGIN_PATH"] = qt_plugin_path
    log(f"QT_PLUGIN_PATH: {qt_plugin_path}")

    # DPI 感知: v2.3.17 改为仅用下方 QApplication.setAttribute(AA_EnableHighDpiScaling)。
    # 移除 QT_AUTO_SCREEN_SCALE_FACTOR —— 两者叠加在部分高分屏(125%/150%)上会产生双重缩放,
    # 导致窗口尺寸错乱、鼠标命中测试错位(下半部分按钮点不动 / 点击后窗口变小)。

    # 关键：必须在 PyQt5 之前预加载 OnnxRuntime
    log("预加载 OnnxRuntime...")
    preload_onnxruntime()

    try:
        log("导入 PaperFlow GUI...")
        from PyQt5.QtCore import Qt
        from PyQt5.QtWidgets import QApplication
        QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
        QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps, True)
        from pdf2zh.gui_pyqt5 import PaperFlowMainWindow
        log("导入成功，启动 GUI...")

        app = QApplication(sys.argv)
        app.setStyle('Fusion')

        # v2.3.4: 解析 Zotero 右键传来的 CLI 参数
        _cli = _parse_cli_args(sys.argv)
        log(f"[cli] parsed = {_cli}")

        # ── 单实例检测 + CLI 参数转发（Zotero 右键唤起）──
        from PyQt5.QtNetwork import QLocalServer, QLocalSocket
        import json as _json
        _instance_key = "paperflow-desktop-singleton-lock"
        _socket = QLocalSocket()
        _socket.connectToServer(_instance_key)
        if _socket.waitForConnected(500):
            # 已有实例：把文件+参数发过去让它翻译，本进程退出
            log("检测到已有实例，转发参数后退出")
            if _cli.get("file"):
                try:
                    _socket.write(_json.dumps(_cli).encode("utf-8"))
                    _socket.waitForBytesWritten(1000)
                except Exception:
                    pass
            _socket.disconnectFromServer()
            _socket.close()
            sys.exit(0)
        _socket.close()
        _server = QLocalServer()
        _server.removeServer(_instance_key)
        _server.listen(_instance_key)
        log("单实例锁已创建")

        # ── DPI 感知样式表生成 ──
        dpr = app.primaryScreen().devicePixelRatio()
        log(f"DPI ratio: {dpr}")

        # DPR 补偿系数：高分屏上 Qt 会把逻辑像素放大到物理像素，
        # 导致同样 12px 在 4K@200% 屏显示为 24px 物理，视觉偏大。
        # 补偿公式：dpr>1 时缩小基准字号，使各屏幕物理显示大小接近。
        import builtins
        builtins._paperflow_dpr = dpr
        builtins._paperflow_dpr_scale = 1.0 / max(1.0, dpr ** 0.6)  # 高分屏更强补偿

        def build_stylesheet(base_font=14):
            """根据基准字号生成完整样式表（macOS 浅色风，所有尺寸等比联动，DPR 自动补偿）"""
            dpr_scale = getattr(builtins, '_paperflow_dpr_scale', 1.0)
            f = max(8, round(base_font * dpr_scale))  # DPR 补偿后的实际字号（下限 8px）
            f1 = f + 1             # 卡片标题
            ft = f + 2             # Tooltip
            pad_v = max(4, f // 3) # 垂直内边距
            pad_h = max(8, f // 2) # 水平内边距
            r = max(6, f // 2)     # 控件圆角（胶囊感）
            rc = max(10, f * 3 // 4)  # 卡片圆角
            ind = max(15, f)       # checkbox indicator
            bw = max(1, f // 14)   # 边框宽度
            sp = max(5, f // 3)    # checkbox spacing
            check_img = (APP_DIR / "assets" / "pf-check.png").as_posix()
            radio_img = (APP_DIR / "assets" / "pf-radio.png").as_posix()
            chevron_img = (APP_DIR / "assets" / "pf-chevron-down.png").as_posix()
            return f"""
            * {{ font-family: "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif; font-size: {f}px; color: #1D1D1F; }}
            QMainWindow {{ background: transparent; }}
            QDialog {{ background: #F5F5F7; }}
            #rootCard {{ background: #F5F5F7; border-radius: {rc}px; }}
            #rootCard[maximized="true"] {{ border-radius: 0px; }}
            QGroupBox {{ background: #FFFFFF; border: {bw}px solid #E8E8ED; border-radius: {rc}px;
                margin-top: {sp+6}px; padding: {f}px {pad_h}px {pad_v}px {pad_h}px; font-weight: 600; color: #1D1D1F; }}
            QGroupBox::title {{ subcontrol-origin: margin; left: {pad_h+4}px; padding: 0 {sp}px; color: #1D1D1F; font-size: {f1}px; }}
            QPushButton {{ background: #FFFFFF; color: #1D1D1F; border: {bw}px solid #D7D7DC; border-radius: {r}px;
                padding: {pad_v}px {pad_h}px; }}
            QPushButton:hover {{ background: #F2F2F4; border-color: #C7C7CC; }}
            QPushButton:pressed {{ background: #E8E8ED; }}
            QPushButton:disabled {{ background: #F5F5F7; color: #AEAEB2; border-color: #EBEBEE; }}
            QPushButton#translateBtn {{ background: #0071E3; color: #FFFFFF; border: none; border-radius: {r}px;
                padding: {pad_v+1}px {pad_h+4}px; font-weight: 600; }}
            QPushButton#translateBtn:hover {{ background: #0077ED; }}
            QPushButton#translateBtn:pressed {{ background: #006EDB; }}
            QPushButton#translateBtn:disabled {{ background: #C7C7CC; color: #FFFFFF; }}
            QComboBox {{ background: #FFFFFF; border: {bw}px solid #D7D7DC; border-radius: {r}px; padding: {pad_v-1}px {pad_h}px; }}
            QComboBox:hover {{ border-color: #B0B0B6; }}
            QComboBox:focus {{ border-color: #0071E3; }}
            QComboBox::drop-down {{ border: none; width: {pad_h+8}px; }}
            QComboBox::down-arrow {{ image: url("{chevron_img}"); width: {max(10, f-2)}px; height: {max(10, f-2)}px; }}
            QComboBox QAbstractItemView {{ background: #FFFFFF; border: {bw}px solid #E3E3E8; border-radius: {r+2}px;
                padding: 4px; selection-background-color: #E8F1FD; selection-color: #1D1D1F; outline: 0; }}
            QLineEdit {{ background: #FFFFFF; border: {bw}px solid #D7D7DC; border-radius: {r}px; padding: {pad_v-1}px {pad_h}px; }}
            QLineEdit:hover {{ border-color: #B0B0B6; }}
            QLineEdit:focus {{ border-color: #0071E3; }}
            QSpinBox {{ background: #FFFFFF; border: {bw}px solid #D7D7DC; border-radius: {r}px; padding: {pad_v-2}px {sp}px; }}
            QSpinBox:focus {{ border-color: #0071E3; }}
            QTextEdit {{ background: #FFFFFF; border: {bw}px solid #D7D7DC; border-radius: {r+2}px; padding: 2px; }}
            QTextEdit:focus {{ border-color: #0071E3; }}
            QCheckBox {{ spacing: {sp}px; }}
            QCheckBox::indicator {{ width: {ind}px; height: {ind}px; border: {bw}px solid #B8B8BD; border-radius: {max(5, ind // 3)}px; background: #FFFFFF; }}
            QCheckBox::indicator:hover {{ border-color: #0071E3; }}
            QCheckBox::indicator:checked {{ background: #0071E3; border-color: #0071E3; image: url("{check_img}"); }}
            QCheckBox::indicator:checked:hover {{ background: #0077ED; }}
            QRadioButton {{ spacing: {sp}px; }}
            QRadioButton::indicator {{ width: {ind}px; height: {ind}px; border: {bw}px solid #B8B8BD; border-radius: {ind // 2}px; background: #FFFFFF; }}
            QRadioButton::indicator:hover {{ border-color: #0071E3; }}
            QRadioButton::indicator:checked {{ border: none; image: url("{radio_img}"); }}
            QListWidget {{ background: #FFFFFF; border: {bw}px solid #E8E8ED; border-radius: {rc-2}px; padding: 4px; }}
            QListWidget::item {{ padding: {pad_v}px {pad_h-2}px; border-radius: {r-2}px; margin: 1px 2px; }}
            QListWidget::item:hover {{ background: #F2F2F4; }}
            QListWidget::item:selected {{ background: #E8F1FD; color: #1D1D1F; }}
            QListWidget::item:selected:active {{ background: #E8F1FD; }}
            QProgressBar {{ background: #E8E8ED; border: none; border-radius: {max(3, ind // 5)}px; }}
            QProgressBar::chunk {{ background: #0071E3; border-radius: {max(3, ind // 5)}px; }}
            QTabBar::tab {{ font-size: {f}px; padding: {pad_h}px {sp}px; border: none; color: #6E6E73; }}
            QTabBar::tab:selected {{ color: #1D1D1F; font-weight: 600; }}
            QTabWidget::pane {{ background: #FFFFFF; border: {bw}px solid #E8E8ED; border-radius: {rc-2}px; }}
            QScrollArea {{ border: none; background: transparent; }}
            QScrollArea > QWidget > QWidget {{ background: transparent; }}
            QScrollBar:vertical {{ background: transparent; width: {max(8, f-2)}px; margin: 2px; }}
            QScrollBar::handle:vertical {{ background: rgba(120,120,128,0.45); min-height: 28px; border-radius: {max(3, f // 4)}px; }}
            QScrollBar::handle:vertical:hover {{ background: rgba(120,120,128,0.7); }}
            QScrollBar:horizontal {{ background: transparent; height: {max(8, f-2)}px; margin: 2px; }}
            QScrollBar::handle:horizontal {{ background: rgba(120,120,128,0.45); min-width: 28px; border-radius: {max(3, f // 4)}px; }}
            QScrollBar::handle:horizontal:hover {{ background: rgba(120,120,128,0.7); }}
            QScrollBar::add-line, QScrollBar::sub-line {{ width: 0; height: 0; }}
            QScrollBar::add-page, QScrollBar::sub-page {{ background: transparent; }}
            QToolTip {{ background: #2C2C2E; color: #FFFFFF; border: {bw}px solid #3A3A3C; border-radius: {r}px;
                padding: {pad_v}px {pad_h}px; font-size: {ft}px; }}
            QMenu {{ background: #FFFFFF; border: {bw}px solid #E3E3E8; border-radius: {r+2}px; padding: 6px; }}
            QMenu::item {{ padding: {pad_v+1}px {pad_h+10}px; border-radius: {r-2}px; }}
            QMenu::item:selected {{ background: #E8F1FD; color: #1D1D1F; }}
            QMenu::separator {{ height: 1px; background: #E8E8ED; margin: 4px 8px; }}
            QSplitter::handle {{ background: transparent; width: 6px; }}
            QWidget#macTitleBar {{ background: transparent; }}
            QLabel#macTitle {{ background: transparent; color: #1D1D1F; font-size: 13px; font-weight: 600; }}
            QLabel#macVersion {{ background: transparent; color: #8E8E93; font-size: 11px; }}
            QWidget#sidebarNav {{ background: transparent; }}
            QPushButton#navBtn {{ background: transparent; border: none; }}
            QLabel#navVersion {{ background: transparent; color: #AEAEB2; font-size: 10px; }}
            """

        # 存为全局函数供字号切换时调用
        import builtins
        builtins._paperflow_build_stylesheet = build_stylesheet

        # 从用户配置读取上次字号，默认极小(10)
        _saved_font = 10
        try:
            import json as _json
            _cfg_path = os.path.join(os.path.expanduser("~"), "pdf2zh_gui_config.json")
            if os.path.exists(_cfg_path):
                with open(_cfg_path, 'r', encoding='utf-8') as _f:
                    _cfg = _json.load(_f)
                _level = _cfg.get('font_size_level', '极小')
                _saved_font = {'极小': 10, '小': 12, '中': 14, '大': 16, '极大': 18}.get(_level, 10)
        except Exception:
            pass
        log(f"初始字号: {_saved_font}px")
        app.setStyleSheet(build_stylesheet(_saved_font))
        window = PaperFlowMainWindow()
        ensure_window_visible(window, app)
        window.show()
        window.raise_()
        window.activateWindow()
        log("GUI 窗口已显示")

        # v2.3.4: Zotero 右键唤起处理 —— 加文件 + 设格式 + 自动翻译
        from PyQt5.QtCore import QTimer as _QTimer

        def _handle_cli(payload):
            try:
                log(f"[cli] _handle_cli payload={payload}")
                file_path = payload.get("file")
                if not file_path or not os.path.isfile(file_path):
                    log(f"[cli] file invalid: {file_path}")
                    return
                if hasattr(window, "batch_files"):
                    if file_path not in window.batch_files:
                        window.batch_files.append(file_path)
                    if hasattr(window, "current_file") and not window.current_file:
                        window.current_file = file_path
                    if hasattr(window, "file_list_widget"):
                        try:
                            window.file_list_widget.addItem(os.path.basename(file_path))
                        except Exception:
                            pass
                fmt = payload.get("format")
                if fmt:
                    window._cli_output_format = fmt
                # v1.0.20: Zotero 附件元数据(链接附件回写用)
                zkey = payload.get("zotero_key")
                if zkey:
                    window._cli_zotero_key = zkey
                if payload.get("zotero_link_mode") is not None:
                    window._cli_zotero_link_mode = payload["zotero_link_mode"]
                # v2.3.4: 后台静默模式 —— 最小化窗口不抢焦点, 完成后自动关闭
                silent = bool(payload.get("silent"))
                if silent:
                    window._cli_silent = True
                if payload.get("auto"):
                    window._cli_auto = True
                    log(f"[cli] auto=True silent={silent}, 600ms后触发 start_translation")
                    _QTimer.singleShot(600,
                        lambda: (log("[cli] 调用 start_translation"), window.start_translation()) if hasattr(window, "start_translation") else log("[cli] 无 start_translation 方法"))
                try:
                    if silent:
                        window.showMinimized()
                    else:
                        # v2.3.4: showNormal 确保被上次静默最小化/隐藏的窗口能重现
                        window.showNormal(); window.raise_(); window.activateWindow()
                except Exception:
                    pass
            except Exception as _e:
                log(f"[cli handle] {_e}")

        def _on_new_conn():
            conn = _server.nextPendingConnection()
            if conn:
                conn.waitForReadyRead(1000)
                data = conn.readAll().data().decode("utf-8", errors="ignore")
                conn.close()
                try:
                    payload = _json.loads(data) if data.startswith("{") else {"file": data, "format": None, "auto": False}
                    _handle_cli(payload)
                except Exception:
                    pass
        try:
            _server.newConnection.connect(_on_new_conn)
        except Exception:
            pass

        if _cli.get("file"):
            _QTimer.singleShot(400, lambda: _handle_cli(_cli))

        sys.exit(app.exec_())
    except ImportError as e:
        msg = f"模块导入失败: {e}\n\n请检查 core\\site-packages 是否完整。"
        log(f"[ERROR] {msg}\n{traceback.format_exc()}")
        show_error_dialog("PaperFlow - 启动失败", msg)
        sys.exit(1)
    except Exception as e:
        msg = f"程序启动失败: {e}"
        log(f"[ERROR] {msg}\n{traceback.format_exc()}")
        show_error_dialog("PaperFlow - 运行错误", msg)
        sys.exit(1)


if __name__ == "__main__":
    main()
