#Requires -Version 5.1
<#
.SYNOPSIS
管理 Windows 防火墙中的 Adobe 域名拦截规则。
.DESCRIPTION
右键选择「使用 PowerShell 运行」，从菜单启用、撤销或查看规则。
在管理员 PowerShell 中也可以使用 -Action Enable、Disable 或 Status。
规则针对所有程序访问 *.adobe.io 和 *.adobestats.io 的出站连接。
Microsoft Defender 网络保护须处于审核或阻止模式，并使用系统 DNS（关闭 DNS over HTTPS）。
#>
[CmdletBinding()]
param(
    [ValidateSet('Enable', 'Disable', 'Status')]
    [string]$Action,
    [switch]$KeepOpen
)

$ErrorActionPreference = 'Stop'
$ruleName = 'PixelRunner.AdobeDomainBlock'
$policyStore = 'PersistentStore'
$domains = [ordered]@{
    '{f9654c9c-43c5-4206-a499-2f99874ff57b}' = '*.adobe.io'
    '{41fa2704-cd88-45fe-84d9-44c80bdab96a}' = '*.adobestats.io'
}

function Enable-AdobeDomainBlock {
    try {
        $defender = Get-MpComputerStatus
        $networkProtection = (Get-MpPreference).EnableNetworkProtection
    } catch {
        throw "无法读取 Microsoft Defender 状态。Windows 防火墙的域名规则需要 Defender 网络保护。$($_.Exception.Message)"
    }
    if (-not $defender.AntivirusEnabled -or [version]$defender.AMProductVersion -lt [version]'4.18.2209.7' -or $networkProtection -notin @(1, 2)) {
        throw '请确认 Microsoft Defender 防病毒已开启、平台版本不低于 4.18.2209.7，且网络保护为审核或阻止模式。'
    }

    foreach ($entry in $domains.GetEnumerator()) {
        $keyword = Get-NetFirewallDynamicKeywordAddress -PolicyStore $policyStore -Id $entry.Key -ErrorAction SilentlyContinue
        if (-not $keyword) {
            New-NetFirewallDynamicKeywordAddress -PolicyStore $policyStore -Id $entry.Key -Keyword $entry.Value -AutoResolve $true | Out-Null
        }
    }
    if (Get-NetFirewallRule -PolicyStore $policyStore -Name $ruleName -ErrorAction SilentlyContinue) {
        Enable-NetFirewallRule -PolicyStore $policyStore -Name $ruleName
    } else {
        New-NetFirewallRule -PolicyStore $policyStore -Name $ruleName -DisplayName '像素起子：Adobe 域名出站拦截' `
            -Direction Outbound -Action Block -Profile Any -RemoteDynamicKeywordAddresses ([string[]]$domains.Keys) | Out-Null
    }
    Write-Host '规则已启用。匹配的系统 DNS 查询解析到 IP 后生效。' -ForegroundColor Green
}

function Disable-AdobeDomainBlock {
    if (Get-NetFirewallRule -PolicyStore $policyStore -Name $ruleName -ErrorAction SilentlyContinue) {
        Remove-NetFirewallRule -PolicyStore $policyStore -Name $ruleName
    }
    foreach ($id in $domains.Keys) {
        if (Get-NetFirewallDynamicKeywordAddress -PolicyStore $policyStore -Id $id -ErrorAction SilentlyContinue) {
            Remove-NetFirewallDynamicKeywordAddress -PolicyStore $policyStore -Id $id
        }
    }
    Write-Host '本脚本创建的拦截规则已撤销。' -ForegroundColor Green
}

function Show-AdobeDomainBlockStatus {
    $rule = Get-NetFirewallRule -PolicyStore ActiveStore -Name $ruleName -ErrorAction SilentlyContinue
    if ($rule -and $rule.Enabled -eq 'True') {
        Write-Host '规则状态：已启用'
    } else {
        Write-Host '规则状态：未启用'
    }
    foreach ($entry in $domains.GetEnumerator()) {
        $keyword = Get-NetFirewallDynamicKeywordAddress -PolicyStore $policyStore -Id $entry.Key -ErrorAction SilentlyContinue
        $addresses = if ($keyword.Addresses) { $keyword.Addresses -join ', ' } else { '尚未解析' }
        Write-Host ("{0}  {1}" -f $entry.Value, $addresses)
    }
}

$showMenu = -not $Action
if ($showMenu) {
    Write-Host 'Adobe 域名出站拦截'
    Write-Host '匹配 *.adobe.io 和 *.adobestats.io，可能影响 Adobe 登录、授权及云服务。'
    Write-Host '1. 启用    2. 撤销    3. 查看状态    0. 退出'
    $Action = switch (Read-Host '请选择') {
        '1' { 'Enable' }
        '2' { 'Disable' }
        '3' { 'Status' }
    }
    if (-not $Action) { return }
}

$exitCode = 0
try {
    if (-not (Get-Command New-NetFirewallDynamicKeywordAddress -ErrorAction SilentlyContinue)) {
        throw '当前 Windows 防火墙不支持动态域名规则。'
    }
    if ($Action -eq 'Status') {
        Show-AdobeDomainBlockStatus
    } else {
        $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
        if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
            if ($Action -eq 'Enable') { Enable-AdobeDomainBlock } else { Disable-AdobeDomainBlock }
        } elseif ($showMenu) {
            $powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
            $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Action {1} -KeepOpen' -f $PSCommandPath, $Action
            $child = Start-Process -FilePath $powershell -ArgumentList $arguments -Verb RunAs -WindowStyle Normal -Wait -PassThru
            exit $child.ExitCode
        } else {
            throw '请在以管理员身份运行的 PowerShell 中执行启用或撤销操作。'
        }
    }
} catch {
    Write-Host "操作失败：$($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
}
if ($showMenu -or $KeepOpen) { [void](Read-Host '按回车退出') }
exit $exitCode
