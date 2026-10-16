# Yerel OSRM sunucusu için Türkiye verisini indirir ve profilleri işler.
# Bir kez çalıştırılır; sonra sunucu
#   docker compose -f docker-compose.osrm.yml up -d
# ile başlatılır.
#
# Varsayılan yalnızca araba profilidir (otobüs eşleştirmesi + araba rotaları;
# ~7 GB bellek, ~4 GB disk, ~10 dk). Türkiye'nin tamamı için yürüme profili
# 8 GB Docker belleğine sığmıyor; daha fazla bellek varsa:
#   ./scripts/setup-osrm.ps1 -Profiles car,foot
# ve sunucuyu "--profile foot" ile başlat. Yürüme yoksa açık sunucu kullanılır.

param([string[]]$Profiles = @("car"))

$ErrorActionPreference = "Stop"
$Image = "ghcr.io/project-osrm/osrm-backend:v5.27.1"
$Threads = 4
$Root = Join-Path $PSScriptRoot "..\data\osrm" | Resolve-Path -ErrorAction SilentlyContinue
if (-not $Root) {
    New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot "..\data\osrm") | Out-Null
    $Root = Join-Path $PSScriptRoot "..\data\osrm" | Resolve-Path
}
$Pbf = Join-Path $Root "turkey-latest.osm.pbf"

# Docker uyarılarını stderr'e yazar; Windows PowerShell 5.1 bunları hata sayıp
# betiği keser. Başarıyı yalnızca çıkış koduyla kontrol et.
function Invoke-Osrm([string]$Mount, [string[]]$Arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & docker run --rm -v $Mount $Image @Arguments 2>&1 | ForEach-Object { "$_" } | Out-Host
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($code -ne 0) { throw "$($Arguments[0]) başarısız (çıkış kodu $code)" }
}

if (-not (Test-Path $Pbf)) {
    Write-Host "Türkiye OSM verisi indiriliyor (~620 MB)..."
    curl.exe -L -C - --fail --retry 5 -o $Pbf https://download.geofabrik.de/europe/turkey-latest.osm.pbf
    if ($LASTEXITCODE -ne 0) { throw "İndirme başarısız" }
}

foreach ($profile in $Profiles) {
    $dir = Join-Path $Root $profile
    New-Item -ItemType Directory -Force $dir | Out-Null
    $link = Join-Path $dir "turkey-latest.osm.pbf"
    # Veriyi kopyalamadan paylaş (aynı diskte sabit bağlantı)
    if (-not (Test-Path $link)) { New-Item -ItemType HardLink -Path $link -Target $Pbf | Out-Null }

    if (Test-Path (Join-Path $dir "turkey-latest.osrm.mldgr")) {
        Write-Host "[$profile] zaten işlenmiş, atlanıyor"
        continue
    }
    Write-Host "[$profile] işleniyor..."
    # Yarıda kalmış önceki denemenin çıktılarını temizle (veri bağlantısı kalır)
    Get-ChildItem $dir -Filter "turkey-latest.osrm*" | Remove-Item -Force
    $mount = "${dir}:/data"
    # 16 iş parçacığıyla yürüme profili 8 GB'ı aşıp bellek yetersizliğinden
    # öldürülüyor; az iş parçacığı daha yavaş ama daha az bellek kullanır
    Invoke-Osrm $mount @("osrm-extract", "-t", "$Threads", "-p", "/opt/$profile.lua", "/data/turkey-latest.osm.pbf")
    Invoke-Osrm $mount @("osrm-partition", "/data/turkey-latest.osrm")
    Invoke-Osrm $mount @("osrm-customize", "/data/turkey-latest.osrm")
    Write-Host "[$profile] tamamlandı"
}

Write-Host "Tamam. Sunucuyu başlat: docker compose -f docker-compose.osrm.yml up -d"
Write-Host ".env.local içine ekle: OSRM_CAR_URL=http://localhost:5000"
if ($Profiles -contains "foot") {
    Write-Host "Yürüme için: docker compose -f docker-compose.osrm.yml --profile foot up -d ve OSRM_FOOT_URL=http://localhost:5001"
}
