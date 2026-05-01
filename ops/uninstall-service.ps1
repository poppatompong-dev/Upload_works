$ErrorActionPreference = "Stop"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Please run PowerShell as Administrator before uninstalling the Windows Service."
}

Set-Location "C:\Users\poppa\Documents\New project"
node scripts\uninstall-service.js
