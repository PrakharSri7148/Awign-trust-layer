// The sensor-fusion flags the server can attach (backend/fusion/), in plain language for the dashboard. They state what was
// MEASURED; none of them is a verdict (only the classifier produces a probability). `kind` follows lib/format.js:
//   integrity - evidence that the location story and the phone's own readings disagree, or that a trail was reused
//   info      - context a reviewer may want; weak on its own
export const FUSION_FLAG_META = {
  gps_jump: { label: 'GPS jump', kind: 'integrity', help: 'The position moved faster or farther between two fixes than any real device could.' },
  gps_jump_flat_motion: { label: 'GPS jump, phone still', kind: 'integrity', help: 'The GPS jumped and the phone\'s motion sensors showed it staying still around that moment: the typical signature of a spoofed location.' },
  gps_jump_with_motion: { label: 'GPS jump (phone moving)', kind: 'info', help: 'The GPS jumped, but the phone was moving at the time (a signal glitch is more likely than a spoof).' },
  flat_motion_while_moving: { label: 'GPS moving, phone still', kind: 'integrity', help: 'The GPS says the phone was travelling but its accelerometer / gyroscope showed no matching movement.' },
  arrival_without_approach: { label: 'Arrived without approach', kind: 'integrity', help: 'The trail starts far from the site and ends inside it, with almost no movement recorded in between.' },
  gps_outside_site: { label: 'Outside the site', kind: 'integrity', help: 'The GPS position at submission is well outside the site\'s registered radius.' },
  gps_too_perfect: { label: 'GPS too perfect', kind: 'info', help: 'Positions with no natural jitter, constant accuracy or a ruler-straight path: typical of a fake location provider (weak on its own).' },
  gps_speed_mismatch: { label: 'Speed mismatch', kind: 'info', help: 'The speed the device reports disagrees with the speed its own positions imply.' },
  window_raw_mismatch: { label: 'Motion summary mismatch', kind: 'integrity', help: 'The motion summary the app sent does not match the raw motion sample it also sent.' },
  trail_invalid: { label: 'Trail invalid', kind: 'integrity', help: 'The location trail was malformed, too large, or its clock claims do not fit this server\'s clock. It was ignored.' },
  trail_replayed: { label: 'Trail reused', kind: 'integrity', help: 'This trail (or this visit session) was already used, or it claims to start before the visit began: a recorded trail replayed.' },
  visit_unverified: { label: 'No visit session', kind: 'info', help: 'The submission did not come with a valid server-issued visit, so the trail\'s timing could not be checked against the server.' },
  fusion_insufficient_evidence: { label: 'Not enough sensor data', kind: 'info', help: 'Nothing could be compared (no motion sensor, no GPS trail, a trail that was too short, or an older app). This is a note, not an accusation.' },
  fusion_required_missing: { label: 'Required sensor data missing', kind: 'integrity', help: 'This task requires sensor evidence and none arrived. Sent to review, not blocked.' },
  network_unseen_at_site: { label: 'New network profile', kind: 'info', help: 'The network speed class has not been seen at this site before (weak: link quality varies).' },
  network_provider_unseen_at_site: { label: 'New internet provider', kind: 'info', help: 'This internet provider has not been seen at this site before.' },
  anonymizing_network: { label: 'Hosting / VPN network', kind: 'info', help: 'The request came from a hosting or VPN provider (heuristic, by the provider\'s name).' },
  ip_country_mismatch: { label: 'Network in another country', kind: 'integrity', help: 'The request\'s IP address is in a different country than the site.' },
  ip_region_mismatch: { label: 'Network far from the site', kind: 'info', help: 'The IP address resolves hundreds of km from the site. Mobile carriers often resolve far away, so this is weak.' },
  ip_far_from_gps: { label: 'Network far from the phone\'s GPS', kind: 'info', help: 'No site is registered, so the network was compared with the phone\'s own GPS position: they are hundreds of km apart. Weak (the GPS is device-reported and mobile carriers resolve far away).' },
  tz_mismatch: { label: 'Time zone mismatch', kind: 'info', help: 'The device\'s time zone does not fit the site\'s longitude (very weak).' },
  wifi_not_seen_at_site: { label: 'WiFi not known here', kind: 'integrity', help: 'None of the WiFi networks around the device have been seen at this site before (native app only).' },
  cell_not_seen_at_site: { label: 'Cell tower not known here', kind: 'integrity', help: 'None of the cell towers the device sees have been seen at this site before (native app only).' },
}

export const isFusionFlag = (f) => f in FUSION_FLAG_META
