# 裁掉桌宠立绘四周的透明留白。
# 每个角色的三态（默认/微笑/眯眼）必须用**同一个**裁剪矩形，否则切换表情会跳位；
# 两个角色之间互不影响（各自算各自的并集）。

Add-Type -AssemblyName System.Drawing

$assets = (Resolve-Path (Join-Path $PSScriptRoot '..\assets')).Path
$threshold = 16
$groups = @(
  @{ name = '豆包'; files = @('doubao.png', 'doubao-smile.png', 'doubao-squint.png') },
  @{ name = 'sd娘'; files = @('sdniang.png', 'sdniang-smile.png', 'sdniang-squint.png') }
)

foreach ($grp in $groups) {
  $files = @()
  $missing = $false
  foreach ($n in $grp.files) {
    $p = Join-Path $assets $n
    if (-not (Test-Path $p)) { Write-Output "跳过 $($grp.name)：缺 $n"; $missing = $true; break }
    $files += (Resolve-Path $p).Path
  }
  if ($missing) { continue }

  $union = $null
  $fullW = 0; $fullH = 0
  foreach ($f in $files) {
    $bmp = New-Object System.Drawing.Bitmap $f
    $fullW = $bmp.Width; $fullH = $bmp.Height
    $rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $bytes = New-Object byte[] ($data.Stride * $bmp.Height)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
    $bmp.UnlockBits($data); $bmp.Dispose()

    $minX = $bmp.Width; $minY = $bmp.Height; $maxX = -1; $maxY = -1
    for ($y = 0; $y -lt $fullH; $y++) {
      $row = $y * $data.Stride
      for ($x = 0; $x -lt $fullW; $x++) {
        if ($bytes[$row + $x * 4 + 3] -gt $threshold) {
          if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
          if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
        }
      }
    }
    if ($maxX -lt 0) { Write-Output "跳过 $($grp.name)：$([System.IO.Path]::GetFileName($f)) 全透明"; $union = $null; break }
    if ($null -eq $union) { $union = [pscustomobject]@{ minX = $minX; minY = $minY; maxX = $maxX; maxY = $maxY } }
    else {
      if ($minX -lt $union.minX) { $union.minX = $minX }
      if ($minY -lt $union.minY) { $union.minY = $minY }
      if ($maxX -gt $union.maxX) { $union.maxX = $maxX }
      if ($maxY -gt $union.maxY) { $union.maxY = $maxY }
    }
  }
  if ($null -eq $union) { continue }

  $w = ($union.maxX - $union.minX + 1)
  $h = ($union.maxY - $union.minY + 1)
  $cropRect = New-Object System.Drawing.Rectangle $union.minX, $union.minY, $w, $h
  Write-Output ("[{0}] union {1}x{2} @({3},{4}) 宽高比 {5}" -f $grp.name, $w, $h, $union.minX, $union.minY, [math]::Round($w / $h, 4))

  foreach ($f in $files) {
    $src = New-Object System.Drawing.Bitmap $f
    $dst = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dst)
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), $cropRect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose(); $src.Dispose()
    $dst.Save($f, [System.Drawing.Imaging.ImageFormat]::Png)
    $dst.Dispose()
    Write-Output ("  {0} → {1}x{2} {3}KB" -f [System.IO.Path]::GetFileName($f), $w, $h, [math]::Round((Get-Item $f).Length / 1024, 1))
  }
}
Write-Output 'done'
