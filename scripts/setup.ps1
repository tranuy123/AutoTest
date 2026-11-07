#Requires -Version 5.1
<#
  AutoTest — cài đặt nhanh trên Windows (được SETUP.bat gọi).

  Việc script làm, theo thứ tự:
    1. Kiểm tra Docker (và Docker Compose); thiếu thì cài Docker Desktop
       bằng winget nếu có winget. Docker Desktop vừa cài có thể cần khởi
       động lần đầu / khởi động lại máy — script sẽ dừng và hướng dẫn
       chạy lại SETUP.bat.
    2. Kiểm tra Node.js >= 22; thiếu thì cài bằng winget.
    3. Bật pnpm qua corepack (đúng bản pnpm@11.28.11 mà dự án khai báo).
    4. pnpm install ở thư mục gốc.
    5. Chưa có .env thì tạo từ .env.example và mở Notepad để điền
       (URL UAT, tài khoản 5 vai, tenant test — xem Mục 3 của
       docs/HUONG-DAN-MAY-THAT.md).
    6. docker compose up -d --build, chờ Orchestrator (3101) và
       Control App (3100) trả lời, rồi mở trình duyệt.

  Mã thoát: 0 = xong; 1 = lỗi cứng; 2 = cần thao tác tay rồi chạy lại.
#>

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Noi([string]$Text, [string]$Mau = 'Cyan') {
    Write-Host ""
    Write-Host "== $Text" -ForegroundColor $Mau
}

function Loi([string]$Text) {
    Write-Host ""
    Write-Host "LỖI: $Text" -ForegroundColor Red
}

function Lam-Lai([string]$Text) {
    Write-Host ""
    Write-Host "CẦN LÀM TAY: $Text" -ForegroundColor Yellow
    Write-Host "Làm xong hãy chạy lại SETUP.bat." -ForegroundColor Yellow
    exit 2
}

function Co-Lenh([string]$Ten) {
    return [bool](Get-Command $Ten -ErrorAction SilentlyContinue)
}

function Lam-Moi-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

function Cai-Bang-Winget([string]$Id, [string]$TenHienThi) {
    if (-not (Co-Lenh 'winget')) {
        Loi "Máy chưa có winget (App Installer) nên không tự cài được $TenHienThi."
        Write-Host "Hãy cài $TenHienThi thủ công rồi chạy lại SETUP.bat."
        exit 1
    }
    Noi "Đang cài $TenHienThi bằng winget..."
    winget install -e --id $Id --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        Loi "winget cài $TenHienThi không thành công (mã $LASTEXITCODE)."
        exit 1
    }
    Lam-Moi-Path
}

Write-Host "AutoTest — cài đặt nhanh trên Windows" -ForegroundColor Green
Write-Host "Thư mục dự án: $Root"

# ---------- 1. Docker ----------
Noi "Bước 1/6: Kiểm tra Docker"
if (-not (Co-Lenh 'docker')) {
    Cai-Bang-Winget 'Docker.DockerDesktop' 'Docker Desktop'
    Lam-Lai "Docker Desktop vừa được cài. Hãy mở Docker Desktop một lần để nó khởi động xong (có thể cần khởi động lại máy sau khi cài), chờ biểu tượng Docker báo đã chạy rồi chạy lại SETUP.bat."
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    $DockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (Test-Path $DockerDesktop) {
        Noi "Docker đã cài nhưng chưa chạy — đang mở Docker Desktop..."
        Start-Process $DockerDesktop
    } else {
        Lam-Lai "Docker đã có lệnh nhưng daemon chưa chạy và không tìm thấy Docker Desktop để tự mở. Hãy mở Docker Desktop thủ công."
    }
    $Cho = 0
    while ($Cho -lt 180) {
        Start-Sleep -Seconds 5
        $Cho += 5
        docker info *> $null
        if ($LASTEXITCODE -eq 0) { break }
        Write-Host "  ...đang chờ Docker khởi động ($Cho giây)"
    }
    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        Lam-Lai "Docker vẫn chưa sẵn sàng sau 180 giây. Hãy chờ Docker Desktop báo đã chạy ổn định rồi chạy lại SETUP.bat."
    }
}
Write-Host "Docker sẵn sàng."

# ---------- 2. Node.js >= 22 ----------
Noi "Bước 2/6: Kiểm tra Node.js >= 22"
$NodeOK = $false
if (Co-Lenh 'node') {
    $Ban = (node --version)
    if ($Ban -match '^v(\d+)\.') {
        if ([int]$Matches[1] -ge 22) { $NodeOK = $true }
    }
}
if (-not $NodeOK) {
    Cai-Bang-Winget 'OpenJS.NodeJS.LTS' 'Node.js LTS'
    Lam-Moi-Path
    if (-not (Co-Lenh 'node')) {
        Lam-Lai "Node.js vừa cài nhưng phiên PowerShell này chưa nhận lệnh node. Hãy đóng cửa sổ này và chạy lại SETUP.bat."
    }
}
Write-Host "Node.js: $(node --version)"

# ---------- 3. pnpm qua corepack ----------
Noi "Bước 3/6: Bật pnpm qua corepack"
corepack enable
if ($LASTEXITCODE -ne 0) { Loi "corepack enable thất bại."; exit 1 }
corepack prepare pnpm@11.28.11 --activate
if ($LASTEXITCODE -ne 0) { Loi "corepack prepare pnpm@11.28.11 thất bại."; exit 1 }
Write-Host "pnpm: $(pnpm --version)"

# ---------- 4. pnpm install ----------
Noi "Bước 4/6: Cài dependencies (pnpm install)"
pnpm install
if ($LASTEXITCODE -ne 0) { Loi "pnpm install thất bại — xem lỗi ở trên."; exit 1 }

# ---------- 5. File .env ----------
Noi "Bước 5/6: Kiểm tra file .env"
if (-not (Test-Path '.env')) {
    Copy-Item '.env.example' '.env'
    Write-Host "Đã tạo .env từ .env.example."
    Write-Host "Cần điền giá trị thật của UAT vào .env: TARGET_BASE_URL, TARGET_ALLOWLIST,"
    Write-Host "tài khoản 5 vai (ROLE_*) và TEST_TENANT — xem Mục 3 trong docs/HUONG-DAN-MAY-THAT.md."
    Write-Host "Đang mở Notepad để điền... (điền xong, lưu và đóng Notepad để tiếp tục)"
    Start-Process notepad '.env' -Wait
} else {
    Write-Host ".env đã có sẵn — giữ nguyên."
}

# ---------- 6. Docker Compose up + chờ healthy ----------
Noi "Bước 6/6: Dựng hệ thống (docker compose up -d --build)"
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Loi "docker compose up thất bại — xem lỗi ở trên."; exit 1 }

Write-Host "Đang chờ các service sẵn sàng (tối đa 240 giây)..."
$Han = 240
$DaCho = 0
$OrchOK = $false
$ControlOK = $false
while ($DaCho -lt $Han -and (-not ($OrchOK -and $ControlOK))) {
    Start-Sleep -Seconds 5
    $DaCho += 5
    if (-not $OrchOK) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3101/health' -TimeoutSec 5
            if ($r.StatusCode -eq 200) { $OrchOK = $true; Write-Host "  Orchestrator (3101): sẵn sàng" }
        } catch { }
    }
    if (-not $ControlOK) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3100' -TimeoutSec 5
            if ($r.StatusCode -eq 200) { $ControlOK = $true; Write-Host "  Control App (3100): sẵn sàng" }
        } catch { }
    }
}

Write-Host ""
docker compose ps
if (-not ($OrchOK -and $ControlOK)) {
    Loi "Hết 240 giây mà service chưa sẵn sàng hết (Orchestrator: $OrchOK, Control: $ControlOK)."
    Write-Host "Xem log bằng: docker compose logs -f   (chi tiết ở Mục 7 — Xử lý sự cố của tài liệu hướng dẫn)"
    exit 1
}

Write-Host ""
Write-Host "CÀI ĐẶT HOÀN TẤT." -ForegroundColor Green
Write-Host "Mở Control App: http://localhost:3100"
Write-Host "Bước tiếp theo: chạy kịch bản mẫu đầu tiên (Mục 5) và Checklist nghiệm thu 9 khoản (Mục 6)"
Write-Host "trong docs/HUONG-DAN-MAY-THAT.md."
Start-Process 'http://localhost:3100'
exit 0
