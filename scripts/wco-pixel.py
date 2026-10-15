"""Windows 窗口控制区(WCO)像素读取验证。

GetPixel(GetWindowDC) 读不到 DWM 合成后的标题栏颜色（恒为白），
必须用 PrintWindow(PW_RENDERFULLCONTENT=2) 把窗口渲染到内存 DC 再取样。

用法: python wco-pixel.py [窗口标题子串]
输出: 控制按钮区（右上角）与内容区的 RGB 采样
"""
import ctypes
import ctypes.wintypes as wt
import sys

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

PW_RENDERFULLCONTENT = 2
SRCCOPY = 0x00CC0020
DIB_RGB_COLORS = 0


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG),
        ("biPlanes", wt.WORD), ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
        ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", wt.LONG),
        ("biYPelsPerMeter", wt.LONG), ("biClrUsed", wt.DWORD), ("biClrImportant", wt.DWORD),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wt.DWORD * 3)]


def find_window(substr: str):
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def cb(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        n = user32.GetWindowTextLengthW(hwnd)
        if n == 0:
            return True
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        if substr.lower() in buf.value.lower():
            found.append((hwnd, buf.value))
        return True

    user32.EnumWindows(cb, 0)
    return found


def sample(hwnd):
    rect = wt.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    w = rect.right - rect.left
    h = rect.bottom - rect.top

    hdc = user32.GetWindowDC(hwnd)
    memdc = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
    gdi32.SelectObject(memdc, bmp)

    ok = user32.PrintWindow(hwnd, memdc, PW_RENDERFULLCONTENT)
    if not ok:
        user32.PrintWindow(hwnd, memdc, 0)

    bmi = BITMAPINFO()
    bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmi.bmiHeader.biWidth = w
    bmi.bmiHeader.biHeight = -h  # 自顶向下
    bmi.bmiHeader.biPlanes = 1
    bmi.bmiHeader.biBitCount = 32
    bmi.bmiHeader.biCompression = 0  # BI_RGB

    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits(memdc, bmp, 0, h, buf, ctypes.byref(bmi), DIB_RGB_COLORS)
    data = buf.raw

    def px(x, y):
        i = (y * w + x) * 4
        b, g, r = data[i], data[i + 1], data[i + 2]
        return f"#{r:02x}{g:02x}{b:02x}"

    # 采样点：
    #  - 控制按钮区：右上角标题栏条带（Windows 按钮在最右约 138px 宽）
    #  - 内容区：窗口中下部
    samples = {
        "标题栏左(拖拽区)": px(w // 3, 18),
        "控制按钮区(右上)": px(w - 60, 18),
        "控制按钮区(最右)": px(w - 10, 18),
        "内容区": px(w // 2, h // 2),
    }

    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(memdc)
    user32.ReleaseDC(hwnd, hdc)
    return w, h, samples


def main():
    substr = sys.argv[1] if len(sys.argv) > 1 else "InstaDownloader"
    wins = find_window(substr)
    if not wins:
        print(f"未找到窗口: {substr}")
        sys.exit(1)
    for hwnd, title in wins[:3]:
        w, h, samples = sample(hwnd)
        print(f"窗口 {title!r} ({w}x{h}) hwnd={hwnd}")
        for k, v in samples.items():
            print(f"  {k}: {v}")


main()
