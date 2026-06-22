# Native PowerShell Web Server for VoiceGuard ID
# Serves local HTML/CSS/JS files on port 8000

$port = 8000
$root = "C:\Users\NID-IN-00011\.gemini\antigravity\scratch\voice-identifier"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host "============================================="
Write-Host "AURAVOICE ID NATIVE WEB SERVER STARTED"
Write-Host "Listening on http://localhost:$port/"
Write-Host "Press Ctrl+C or stop the background task to exit."
Write-Host "============================================="

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        $url = $request.Url.LocalPath
        if ($url -eq "/") {
            $url = "/index.html"
        }
        
        # Clean path and join
        $cleanUrl = $url.TrimStart('/')
        $localPath = Join-Path $root $cleanUrl
        
        if (Test-Path $localPath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($localPath).ToLower()
            switch ($ext) {
                ".html" { $response.ContentType = "text/html; charset=utf-8" }
                ".css"  { $response.ContentType = "text/css; charset=utf-8" }
                ".js"   { $response.ContentType = "application/javascript; charset=utf-8" }
                ".png"  { $response.ContentType = "image/png" }
                ".jpg"  { $response.ContentType = "image/jpeg" }
                ".ico"  { $response.ContentType = "image/x-icon" }
                default { $response.ContentType = "application/octet-stream" }
            }
            
            try {
                $bytes = [System.IO.File]::ReadAllBytes($localPath)
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } catch {
                $response.StatusCode = 500
                $errMsg = [System.Text.Encoding]::UTF8.GetBytes("Error reading file: $_")
                $response.OutputStream.Write($errMsg, 0, $errMsg.Length)
            }
        } else {
            $response.StatusCode = 404
            $errMsg = [System.Text.Encoding]::UTF8.GetBytes("File Not Found: $url")
            $response.OutputStream.Write($errMsg, 0, $errMsg.Length)
        }
        
        $response.Close()
    }
} catch {
    Write-Host "Server interrupted: $_"
} finally {
    if ($listener -ne $null) {
        $listener.Stop()
        $listener.Close()
    }
}
