# Experience: Correct Method for Adding Extension Icons

For Chrome extensions, follow this specific approach to ensure icons display correctly in the toolbar, extensions menu, and popup.

## 1. Always Use PNG Format
Chrome extensions have inconsistent support for SVG in the toolbar. Always use **PNG** for the `manifest.json` icons.

## 2. Manifest Configuration
Define icons in both the root `icons` and `action.default_icon` for maximum compatibility:
```json
{
  "icons": {
    "16": "icons/icon.png",
    "48": "icons/icon.png",
    "128": "icons/icon.png"
  },
  "action": {
    "default_icon": {
      "16": "icons/icon.png",
      "48": "icons/icon.png",
      "128": "icons/icon.png"
    }
  }
}
```

## 3. PNG Generation (PowerShell)
If high-quality PNGs are needed and AI generation or Python PIL is unavailable, use this PowerShell command to generate a professional icon:
```powershell
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(128, 128)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# Background & Design
$g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#0F172A"))), 0, 0, 128, 128)
$g.DrawRectangle((New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#4F46E5"), 4)), 12, 12, 104, 104)
$g.FillEllipse((New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#EF4444"))), 32, 32, 64, 64)

$bmp.Save("icons/icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
```

## 4. UI Integration
Use the same PNG asset in `popup.html` to maintain brand consistency:
```html
<img src="../icons/icon.png" alt="Icon" width="32" height="32">
```
