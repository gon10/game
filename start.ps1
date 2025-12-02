# Start both server and frontend for Element Arena
Write-Host "Starting Element Arena..." -ForegroundColor Cyan

# Start server in background
Write-Host "Starting game server on port 3001..." -ForegroundColor Yellow
$serverJob = Start-Process -FilePath "powershell" -ArgumentList "-Command", "cd '$PWD'; npm run server" -PassThru -WindowStyle Normal

Start-Sleep -Seconds 2

# Start frontend
Write-Host "Starting frontend on http://localhost:5173..." -ForegroundColor Yellow
$frontendJob = Start-Process -FilePath "powershell" -ArgumentList "-Command", "cd '$PWD'; npm run dev" -PassThru -WindowStyle Normal

Write-Host ""
Write-Host "==================================" -ForegroundColor Green
Write-Host "  Element Arena is starting!" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Green
Write-Host ""
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Cyan
Write-Host "Server:   ws://localhost:3001" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Enter to stop both servers..." -ForegroundColor Yellow

Read-Host

# Stop processes
Write-Host "Stopping servers..." -ForegroundColor Yellow
Stop-Process -Id $serverJob.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $frontendJob.Id -Force -ErrorAction SilentlyContinue

Write-Host "Servers stopped." -ForegroundColor Green
