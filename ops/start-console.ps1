$ErrorActionPreference = "Stop"
Set-Location "C:\Users\poppa\Documents\New project"
$env:NODE_ENV = "production"
$env:PORT = "8080"
$env:HOST = "0.0.0.0"
npm.cmd run build
npm.cmd run seed:roster
npm.cmd start
