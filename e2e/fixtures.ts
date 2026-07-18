/** Designated real-world test targets. Scenarios must take targets from here. */
export const fixtures = {
  sonosRoom: 'Living Room',
  sonosSecondRoom: 'Bathroom',
  graphiteTrunk: 'main',
  githubRepo: 'uptonm/home',
  discordAlertsChannelId: '1453195143833321546', // #alerts
} as const

// Manual environment fixtures (no CLI create exists; mark honest-unresolveds as passes when implemented):
// HA Local Calendar integration (assistant `calendars get`)
// One saved Sonos playlist + one disabled Sonos alarm
// Optional: UniFi hotspot voucher / firewall group / static route / RADIUS user
// Optional: pinned GitHub issue in uptonm/home
