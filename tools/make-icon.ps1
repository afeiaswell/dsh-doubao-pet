# 从立绘生成市场用的方图图标（180x180，带透明通道）
# 用途：awesome-dsh-plugin 目录的 icon 字段要求 GitHub 托管的 png/jpg/webp，SVG 会被拒
Add-Type -AssemblyName System.Drawing

$src = Join-Path $PSScriptRoot '..\assets\doubao.png'
$dst = Join-Path $PSScriptRoot '..\assets\icon-180.png'
$side = 180

$img = [System.Drawing.Image]::FromFile((Resolve-Path $src).Path)
$w = $img.Width; $h = $img.Height
# 居中裁成正方形（保留 alpha）
$edge = [Math]::Min($w, $h)
$srcRect = New-Object System.Drawing.Rectangle ([int](($w - $edge) / 2)), ([int](($h - $edge) / 2)), $edge, $edge

$bmp = New-Object System.Drawing.Bitmap $side, $side, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
$g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $side, $side), $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose(); $img.Dispose()
$bmp.Save((Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\assets')).Path 'icon-180.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$kb = [math]::Round((Get-Item $dst).Length / 1024, 1)
Write-Output "icon-180.png 已生成：${side}x${side}，${kb}KB"
