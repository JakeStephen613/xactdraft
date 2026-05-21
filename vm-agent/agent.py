"""
XactDraft VM agent — runs on the Windows Compute Engine VM.
Exposes the screenshot/action/file endpoints that agent.js calls during the Claude loop.

Start with:
    python -m uvicorn agent:app --host 0.0.0.0 --port 8765
"""

import base64
import io
import os
from typing import List, Optional

import mss
import mss.tools
import pyautogui
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI()

# Disable pyautogui safety failsafe and add a small pause between actions
pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0.05


# ── Request models ─────────────────────────────────────────────────────────────

class Action(BaseModel):
    action: str
    coordinate: Optional[List[int]] = None        # [x, y] for click / move / scroll
    start_coordinate: Optional[List[int]] = None  # [x, y] for drag start
    text: Optional[str] = None                     # key combo or typed text
    direction: Optional[str] = None               # "up" | "down" | "left" | "right"
    amount: Optional[int] = 3                     # scroll clicks


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/screenshot")
def screenshot():
    """Capture the primary monitor and return a base64-encoded PNG."""
    with mss.mss() as sct:
        monitor = sct.monitors[1]   # index 0 is the combined virtual monitor
        img = sct.grab(monitor)
        png_bytes = mss.tools.to_png(img.rgb, img.size)
    return {"screenshot": base64.b64encode(png_bytes).decode("utf-8")}


@app.post("/action")
def action(body: Action):
    """Execute a Claude computer-use action using pyautogui."""
    a = body.action

    if a == "screenshot":
        # Caller will take a screenshot separately; nothing to do here
        pass

    elif a == "left_click":
        x, y = body.coordinate
        pyautogui.click(x, y, button="left")

    elif a == "right_click":
        x, y = body.coordinate
        pyautogui.click(x, y, button="right")

    elif a == "middle_click":
        x, y = body.coordinate
        pyautogui.click(x, y, button="middle")

    elif a == "double_click":
        x, y = body.coordinate
        pyautogui.doubleClick(x, y)

    elif a == "mouse_move":
        x, y = body.coordinate
        pyautogui.moveTo(x, y, duration=0.1)

    elif a == "left_click_drag":
        x1, y1 = body.start_coordinate
        x2, y2 = body.coordinate
        pyautogui.mouseDown(x1, y1, button="left")
        pyautogui.moveTo(x2, y2, duration=0.4)
        pyautogui.mouseUp(button="left")

    elif a == "scroll":
        x, y = body.coordinate
        pyautogui.moveTo(x, y)
        if body.direction == "up":
            pyautogui.scroll(body.amount)
        elif body.direction == "down":
            pyautogui.scroll(-body.amount)
        elif body.direction == "left":
            # Shift+scroll for horizontal scroll
            pyautogui.keyDown("shift")
            pyautogui.scroll(body.amount)
            pyautogui.keyUp("shift")
        elif body.direction == "right":
            pyautogui.keyDown("shift")
            pyautogui.scroll(-body.amount)
            pyautogui.keyUp("shift")

    elif a == "key":
        # Claude sends combos like "ctrl+a", "Return", "Escape", "ctrl+shift+z"
        parts = body.text.split("+")
        if len(parts) == 1:
            pyautogui.press(parts[0])
        else:
            pyautogui.hotkey(*parts)

    elif a == "type":
        # pyautogui.write handles printable ASCII; use typewrite for safety
        pyautogui.write(body.text, interval=0.02)

    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {a}")

    return {"status": "ok"}


@app.get("/file")
def get_file(path: str = Query(..., description="Absolute Windows path to download")):
    """
    Return the raw bytes of a file on the VM.
    Used by agent.js to pull C:\\output\\estimate.pdf after the loop completes.
    """
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    with open(path, "rb") as f:
        data = f.read()
    return Response(content=data, media_type="application/octet-stream")
