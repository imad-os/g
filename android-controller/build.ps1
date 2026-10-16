# Builds the My PC APK (the whole My PC app): android-controller\My-PC.apk (and the same file as My-PC-Controller.apk, the
# old name, for links shared before). It also bumps "build" in app-manifest.json: the desktop's Get the app link carries
# the build, so a new APK always gets a new address and no browser or CDN hands out the old one.
#   powershell -ExecutionPolicy Bypass -File android-controller\build.ps1
# Needs JDK 17 and the Android SDK (platform 35, build-tools 35). By default they are looked for in
# %USERPROFILE%\.tooling (jdk17, android-sdk); JAVA_HOME / ANDROID_HOME win when they are set.
# The first run creates the signing key (%USERPROFILE%\.tooling\keys\mypc-controller.jks) and keystore.properties.
# Keep that key: phones install an update over the old app only when it is signed with the same key.
# OWNER RULE: this APK is always the WHOLE My PC app (MainActivity opens the My PC desktop), never a controller-only app,
# and every rebuild bumps the app-manifest build so the desktop's Get the app link serves this new APK (done below).
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$tool = Join-Path $env:USERPROFILE '.tooling'
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = Join-Path $tool 'jdk17' }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $tool 'android-sdk' }
if (-not (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) { throw "No JDK at $env:JAVA_HOME (set JAVA_HOME to a JDK 17)" }
if (-not (Test-Path (Join-Path $env:ANDROID_HOME 'platforms\android-35'))) { throw "No Android SDK platform 35 at $env:ANDROID_HOME" }

# the SDK location for Gradle (local to this computer, not committed)
Set-Content -Encoding ascii (Join-Path $here 'local.properties') ('sdk.dir=' + ($env:ANDROID_HOME -replace '\\', '/'))

# signing key, made once
$props = Join-Path $here 'keystore.properties'
if (-not (Test-Path $props)) {
    $keys = Join-Path $tool 'keys'
    New-Item -ItemType Directory -Force $keys | Out-Null
    $jks = Join-Path $keys 'mypc-controller.jks'
    $pw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
    if (-not (Test-Path $jks)) {
        & (Join-Path $env:JAVA_HOME 'bin\keytool.exe') -genkeypair -keystore $jks -alias mypc -keyalg RSA -keysize 2048 -validity 10000 `
            -storepass $pw -keypass $pw -dname 'CN=My PC Controller' | Out-Null
        if ($LASTEXITCODE) { throw 'keytool failed' }
    } else { throw "$jks exists but keystore.properties is missing: restore keystore.properties (it holds the password)" }
    Set-Content -Encoding ascii $props @("storeFile=$($jks -replace '\\', '/')", "storePassword=$pw", 'keyAlias=mypc', "keyPassword=$pw")
    Copy-Item $props (Join-Path $keys 'keystore.properties')
}

Push-Location $here
try {
    & .\gradlew.bat --no-daemon -q assembleRelease
    if ($LASTEXITCODE) { throw 'Gradle build failed' }
    Copy-Item 'app\build\outputs\apk\release\app-release.apk' 'My-PC.apk' -Force
    Copy-Item 'My-PC.apk' 'My-PC-Controller.apk' -Force
    $man = Join-Path $here '..\app-manifest.json'
    $txt = Get-Content -Raw $man
    $n = [int]([regex]::Match($txt, '"build":\s*(\d+)').Groups[1].Value) + 1
    Set-Content -NoNewline -Encoding utf8 $man ([regex]::Replace($txt, '"build":\s*\d+', '"build": ' + $n, 1))
    Write-Host ('APK: ' + (Resolve-Path 'My-PC.apk') + '  (app-manifest build ' + $n + ')')
} finally { Pop-Location }
