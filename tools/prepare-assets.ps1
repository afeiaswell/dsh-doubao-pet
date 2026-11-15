# 把两套桌宠立绘处理成素材：缩到 384×384 + 白底转透明（带羽化）
# 角色：豆包（豆包*.png）、sd娘（sd娘*.png）；输出到 plugins/dsh-doubao-pet/assets/
# 裁剪透明边由 trim-assets.ps1 负责，两步分开跑。

Add-Type -AssemblyName System.Drawing

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path   # 工作区根目录（tools → 包 → plugins → 根）
$outDir = Join-Path $PSScriptRoot '..\assets'
$outDir = (Resolve-Path $outDir).Path
$size = 384

$jobs = @(
  @{ in = '豆包.png';         out = 'doubao.png' },
  @{ in = '豆包微笑.png';     out = 'doubao-smile.png' },
  @{ in = '豆包眯眼微笑.png'; out = 'doubao-squint.png' },
  @{ in = 'sd娘.png';         out = 'sdniang.png' },
  @{ in = 'sd娘微笑.png';     out = 'sdniang-smile.png' },
  @{ in = 'sd娘眯眼微笑.png'; out = 'sdniang-squint.png' }
)

foreach ($j in $jobs) {
  $src = Join-Path $root $j.in
  if (-not (Test-Path $src)) { Write-Output "跳过（缺失）: $($j.in)"; continue }

  $srcImg = [System.Drawing.Image]::FromFile($src)
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::White)
  $g.DrawImage($srcImg, 0, 0, $size, $size)
  $g.Dispose(); $srcImg.Dispose()

  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $size)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)

  for ($y = 0; $y -lt $size; $y++) {
    $row = $y * $data.Stride
    for ($x = 0; $x -lt $size; $x++) {
      $i = $row + $x * 4
      $b = $bytes[$i]; $gc = $bytes[$i + 1]; $r = $bytes[$i + 2]
      $min = [Math]::Min($r, [Math]::Min($gc, $b))
      if ($min -ge 244) { $bytes[$i + 3] = 0 }
      elseif ($min -ge 226) {
        $a = [int](255 * (244 - $min) / 18)
        if ($a -lt $bytes[$i + 3]) { $bytes[$i + 3] = [byte]$a }
      }
    }
  }
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  $bmp.UnlockBits($data)

  $out = Join-Path $outDir $j.out
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("{0} → {1}  {2}x{2}  {3}KB" -f $j.in, $j.out, $size, [math]::Round((Get-Item $out).Length / 1024, 1))
}
