# Fixes a missing file from admin-panel.ps1: the folder
# app\api\admin\sales\[id]\route.js never got created, because its name
# contains square brackets and PowerShell's normal file cmdlets (even with
# -LiteralPath, it turns out) can trip over that on some setups. This is
# the piece that handles the Approve/Reject/Edit/Delete buttons in /admin --
# without it those buttons fail with "Unexpected token '<' ... is not valid
# JSON" because they're hitting a page that doesn't exist instead of real
# code.
#
# This version sidesteps PowerShell's path parsing completely by using
# .NET's file APIs directly, which treat the folder/file name as plain text
# no matter what characters are in it.
#
# Safe to re-run if something fails partway through.

$projectPath = "C:\Users\Bastian\Documents\WebDesign\SaleHop-app\salehopproject\salehop"

Write-Host "Moving into $projectPath ..." -ForegroundColor Cyan
if (-not (Test-Path $projectPath)) {
    Write-Host "ERROR: That folder doesn't exist. Double-check the path and edit it at the top of this script." -ForegroundColor Red
    exit 1
}
Set-Location $projectPath

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: git isn't installed (or not on PATH)." -ForegroundColor Red
    exit 1
}

$idDir = Join-Path $projectPath "app\api\admin\sales\[id]"
$idFile = Join-Path $idDir "route.js"

Write-Host "Creating app\api\admin\sales\[id] ..." -ForegroundColor Cyan
[System.IO.Directory]::CreateDirectory($idDir) | Out-Null

Write-Host "Writing app\api\admin\sales\[id]\route.js ..." -ForegroundColor Cyan
$routeContent = @'
import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Whatever the client sends, only these columns are ever written -- this
// keeps a request from writing to something like user_id even if it tried.
const EDITABLE_FIELDS = [
  'title',
  'address',
  'lat',
  'lng',
  'sale_date',
  'start_time',
  'end_time',
  'tags',
  'description',
  'photo_urls',
  'status',
];

export async function PATCH(request, { params }) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const updates = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) updates[field] = body[field];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }
  if ('status' in updates && !['pending', 'approved', 'rejected'].includes(updates.status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('sales')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(request, { params }) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  // Look up photo URLs first so we can also clean those up from storage --
  // deleting the row doesn't automatically delete its uploaded files.
  const { data: existing } = await supabaseAdmin
    .from('sales')
    .select('photo_urls')
    .eq('id', params.id)
    .single();

  const { error } = await supabaseAdmin.from('sales').delete().eq('id', params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (existing?.photo_urls?.length > 0) {
    const paths = existing.photo_urls.map((url) => url.split('/sale-photos/')[1]).filter(Boolean);
    if (paths.length > 0) {
      supabaseAdmin.storage.from('sale-photos').remove(paths).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
'@

# .NET's UTF8 encoding here writes the file with the same UTF-8-with-BOM
# format Set-Content -Encoding UTF8 uses elsewhere in this project, so it's
# consistent with every other file -- and unlike Set-Content, WriteAllText
# takes $idFile as pure literal text with no wildcard interpretation at all.
[System.IO.File]::WriteAllText($idFile, $routeContent, [System.Text.Encoding]::UTF8)

if (Test-Path -LiteralPath $idFile) {
    Write-Host "Confirmed: route.js now exists at app\api\admin\sales\[id]\route.js" -ForegroundColor Green
} else {
    Write-Host "ERROR: the file still doesn't exist after writing it. Something unusual is going on -- send me a screenshot of this whole output." -ForegroundColor Red
    exit 1
}

Write-Host "Staging, committing, and pushing ..." -ForegroundColor Cyan
git add .
git commit -m "Fix missing dynamic API route for admin approve/reject/edit/delete"

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "If that failed with 'Please tell me who you are', run these two lines (with your info) then re-run this script:" -ForegroundColor Yellow
    Write-Host '  git config --global user.email "you@example.com"' -ForegroundColor Yellow
    Write-Host '  git config --global user.name "Your Name"' -ForegroundColor Yellow
    exit 1
}

git push

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Done! Wait for Vercel to finish redeploying (a minute or two), then refresh /admin and try Approve again." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "The push didn't finish cleanly -- scroll up for git's error message and send it to me." -ForegroundColor Red
}
