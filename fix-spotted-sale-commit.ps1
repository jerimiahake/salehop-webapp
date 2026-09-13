# Fixes the failed commit from spotted-sale-reporting.ps1.
#
# What went wrong: that script's commit message subject line had literal
# double quotes in it (Add crowdsourced "spotted a sale" reporting...).
# When PowerShell hands a string like that to git.exe as a plain -m
# argument, its argument-escaping can mis-split it at the embedded quotes
# -- which is exactly what happened: git ended up receiving "a", "sale
# reporting...", and other fragments as separate arguments instead of one
# commit message, so it tried to treat them as file paths and errored
# with "pathspec ... did not match any file(s)". This never touched your
# actual files -- every file the first script wrote is correct and still
# sitting there (confirmed by your own `git status` output showing
# exactly the expected changes) -- only the commit step itself failed.
#
# This script only redoes that last step, and does it in a way that can't
# hit the same bug again: instead of passing the message directly as a
# command-line argument, it writes the message to a temp file and points
# git at that file with `-F`, which sidesteps the quoting problem
# entirely (and is the pattern future delivery scripts will use from now
# on for any commit message).

if (-not (Test-Path "package.json")) {
    Write-Host "ERROR: package.json not found. Run this script from inside your salehop project folder." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path ".git")) {
    Write-Host "ERROR: .git folder not found. Run this script from inside your salehop project folder." -ForegroundColor Red
    exit 1
}

git status

Write-Host ""
$answer = Read-Host "Commit and push these changes now? (Y/N)"
if ($answer -eq "Y" -or $answer -eq "y") {
    git add -A
    if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: git add failed." -ForegroundColor Red; exit 1 }

    $commitMessage = @"
Add crowdsourced spotted-a-sale reporting with visit-confirmation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01146L7oDTraxR2XyGhaGyrm
"@

    $commitMsgFile = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($commitMsgFile, $commitMessage)
    git commit -F $commitMsgFile
    $commitExitCode = $LASTEXITCODE
    Remove-Item $commitMsgFile -ErrorAction SilentlyContinue
    if ($commitExitCode -ne 0) { Write-Host "ERROR: git commit failed." -ForegroundColor Red; exit 1 }

    git push
    if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: git push failed." -ForegroundColor Red; exit 1 }

    Write-Host ""
    Write-Host "Done! Changes committed and pushed. Vercel should start deploying shortly." -ForegroundColor Green
    Write-Host "Don't forget to run the SQL migration in Supabase if you haven't yet." -ForegroundColor Yellow
} else {
    Write-Host "Skipped commit/push. Your files were updated locally but not committed." -ForegroundColor Yellow
}
