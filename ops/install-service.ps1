$ErrorActionPreference = "Stop"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Please run PowerShell as Administrator before installing the Windows Service."
}

Set-Location "C:\Users\poppa\Documents\New project"
npm.cmd run build
npm.cmd run seed:roster
node scripts\install-service.js
