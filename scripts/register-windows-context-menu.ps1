# Run beside the extracted app directory. Registration is per user and needs no administrator rights.
param([switch]$Unregister)

$extensions = @(
    '.infdoc', '.idoc', '.md', '.markdown', '.mdown', '.mkd', '.txt',
    '.doc', '.docx', '.docm', '.ppt', '.pps', '.pot', '.pptx', '.pptm',
    '.ppsx', '.ppsm', '.xls', '.xlsx', '.xlsm', '.xlsb', '.odt', '.ods',
    '.odp', '.rtf', '.epub', '.csv', '.pdf'
)
$exe = Join-Path $PSScriptRoot 'app\infinite-editor.exe'
if (-not $Unregister -and -not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw "Cannot find $exe. Keep this script beside the extracted app folder."
}

foreach ($extension in $extensions) {
    $verb = "HKCU:\Software\Classes\SystemFileAssociations\$extension\shell\InfiniteEditor"
    if ($Unregister) {
        Remove-Item -LiteralPath $verb -Recurse -Force -ErrorAction SilentlyContinue
        continue
    }

    New-Item -Path $verb -Force | Out-Null
    Set-Item -Path $verb -Value '使用 Infinite Editor 打开'
    New-ItemProperty -LiteralPath $verb -Name 'Icon' -Value "`"$exe`",0" -PropertyType String -Force | Out-Null
    $command = Join-Path $verb 'command'
    New-Item -Path $command -Force | Out-Null
    Set-Item -Path $command -Value "`"$exe`" `"%1`""
}

if ($Unregister) {
    Write-Host 'Infinite Editor context-menu entries removed.'
} else {
    Write-Host 'Infinite Editor context-menu entries registered for this user.'
    Write-Host 'On Windows 11, the entry may appear under Show more options.'
}
