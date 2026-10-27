<#
.SYNOPSIS
Opens the voice gateway's port in Windows Firewall for one address only, the Lingo server's.

.DESCRIPTION
The voice stack (docker-compose.yml in this folder) publishes the gateway on one port of the
workstation. Windows Firewall blocks inbound connections to it until a rule allows them. This
script adds one inbound rule for TCP on that port whose remote address is the single address you
give, so nothing else on the network can connect. It does not open any other port, does not
change the firewall profiles or any other setting, and does nothing to the voice containers.

Run it yourself, in an elevated PowerShell (Run as administrator), after the voice stack is up.
Use -WhatIf first to see what it would do. Use -Remove to delete the rule again.

.PARAMETER ServerAddress
The address the Lingo server connects from, as seen by the workstation: the server's local
network address, reserved in the router so it does not change. One address only; ranges, masks
and keywords such as Any are refused.

.PARAMETER Port
The gateway's published port. It must match VOICE_PORT in the voice stack's .env file.

.PARAMETER NetworkProfile
The network profile the rule applies to. Private is right for a home network.

.PARAMETER RuleName
The display name of the rule. Running the script again with the same name updates the rule.

.PARAMETER Remove
Deletes the rule instead of adding it.

.EXAMPLE
.\Open-VoiceFirewall.ps1 -ServerAddress 192.0.2.20 -WhatIf

.EXAMPLE
.\Open-VoiceFirewall.ps1 -ServerAddress 192.0.2.20

.EXAMPLE
.\Open-VoiceFirewall.ps1 -Remove
#>
[CmdletBinding(SupportsShouldProcess = $true, DefaultParameterSetName = 'Add')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Add')]
    [string]$ServerAddress,

    [Parameter(ParameterSetName = 'Add')]
    [Parameter(ParameterSetName = 'Remove')]
    [ValidateRange(1024, 65535)]
    [int]$Port = 8443,

    [Parameter(ParameterSetName = 'Add')]
    [ValidateSet('Private', 'Domain', 'Public', 'Any')]
    [string]$NetworkProfile = 'Private',

    [Parameter(ParameterSetName = 'Add')]
    [Parameter(ParameterSetName = 'Remove')]
    [string]$RuleName = 'Lingo voice gateway',

    [Parameter(Mandatory = $true, ParameterSetName = 'Remove')]
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script in an elevated PowerShell (Run as administrator).'
}

$existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue

if ($Remove) {
    if (-not $existing) {
        Write-Host "There is no rule named '$RuleName'. Nothing to remove."
        return
    }
    if ($PSCmdlet.ShouldProcess($RuleName, 'Remove the firewall rule')) {
        $existing | Remove-NetFirewallRule
        Write-Host "Removed the rule '$RuleName'."
    }
    return
}

# One plain address only. A range, a mask, a list or a keyword would open the port wider than intended.
$parsed = $null
if ($ServerAddress -notmatch '^[0-9A-Fa-f:.]+$' -or -not [System.Net.IPAddress]::TryParse($ServerAddress, [ref]$parsed)) {
    throw "ServerAddress must be one IP address such as 192.0.2.20, not '$ServerAddress'."
}
if ($parsed.Equals([System.Net.IPAddress]::Any) -or $parsed.Equals([System.Net.IPAddress]::IPv6Any) -or [System.Net.IPAddress]::IsLoopback($parsed)) {
    throw "ServerAddress must be the Lingo server's own network address, not '$ServerAddress'."
}
$address = $parsed.ToString()

if ($existing) {
    if ($PSCmdlet.ShouldProcess($RuleName, "Update the rule: TCP $Port from $address only")) {
        $existing | Set-NetFirewallRule -Enabled True -Action Allow -Direction Inbound -Profile $NetworkProfile
        $existing | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $Port
        $existing | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress $address
        Write-Host "Updated the rule '$RuleName': TCP $Port is open to $address only."
    }
}
elseif ($PSCmdlet.ShouldProcess($RuleName, "Add an inbound rule: TCP $Port from $address only")) {
    New-NetFirewallRule `
        -DisplayName $RuleName `
        -Description 'Lets the Lingo server reach the voice gateway. Added by Open-VoiceFirewall.ps1.' `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $Port `
        -RemoteAddress $address `
        -Profile $NetworkProfile | Out-Null
    Write-Host "Added the rule '$RuleName': TCP $Port is open to $address only."
}
