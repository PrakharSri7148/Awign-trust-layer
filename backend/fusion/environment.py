"""F4: environment consistency. Is the network around the phone plausible for the claimed area?

    environment_consistency in [0, 1]   1 = nothing contradicts the claim, low = the network looks like somewhere else
    environment_known                   False when nothing could be compared

What a WEB page can know is limited: browsers expose no WiFi names or cell towers. So the evidence, weakest to strongest:
  link profile   the network's speed class (effectiveType / downlink / rtt buckets) vs what this site's accepted visits
                 usually show. Weak (link quality varies a lot) and only used once the site has `profileMin` visits.
  IP context     country / region / ASN of the request IP (ipctx.py, optional database): far from the site, a different
                 country, or a hosting/VPN network. Coarse and lenient (mobile carriers resolve far away).
  time zone      device offset vs the offset of the claimed longitude. Very weak.
  native radio   hashed WiFi BSSIDs / cell IDs vs the site's known set. Strong, but only a native app can send them.
No rule here decides anything; the score is one input of the classifier.
"""
import math

from . import config as C
from . import geo


def link_key(network_info):
    """Same buckets as signals.py (so the same network gives the same key despite browser jitter)."""
    info = network_info or {}
    get = info.get if isinstance(info, dict) else lambda k: getattr(info, k, None)
    dl, rtt = get("downlink"), get("rtt")
    dlb = "none" if dl is None else ("0" if float(dl) <= 0 else str(int(math.floor(math.log2(float(dl))))))
    if rtt is None:
        rb = "none"
    else:
        rb = ">=1000"
        for limit in (50, 150, 400, 1000):
            if float(rtt) < limit:
                rb = f"<{limit}"
                break
    et = get("effectiveType")
    if not et and dl is None and rtt is None:
        return None  # this browser exposes nothing (Safari/Firefox): no key, rather than a fake shared one
    return f"{et or 'none'}|{dlb}|{rb}"


def _noisy_or(ps):
    keep = 1.0
    for p in ps:
        keep *= 1.0 - max(0.0, min(1.0, p))
    return 1.0 - keep


def is_hosting(org):
    if not org:
        return False
    o = org.lower()
    return any(k in o for k in C.ENVIRONMENT["hostingKeywords"])


def keys_for(network_info, ip, radio):
    """The observations this submission would add to its site's profile."""
    keys = {}
    lk = link_key(network_info)
    if lk:
        keys["link"] = [lk]
    if ip and ip.get("asn"):
        keys["asn"] = [f"AS{ip['asn']}"]
    if radio:
        wifi = [w.get("bssid_h") for w in radio.get("wifi") or [] if isinstance(w, dict) and w.get("bssid_h")]
        cell = [f"{c.get('mcc')}-{c.get('mnc')}-{c.get('tac')}-{c.get('cid')}" for c in radio.get("cell") or [] if isinstance(c, dict) and c.get("cid") is not None]
        if wifi:
            keys["wifi"] = wifi[:64]
        if cell:
            keys["cell"] = cell[:16]
    return keys


def _profile_known(profile, kind):
    return sum((profile or {}).get(kind, {}).values()) >= C.ENVIRONMENT["profileMin"]


def evaluate(*, site=None, network_info=None, profile=None, ip=None, tz_offset_min=None, radio=None):
    """site: {lat, lng, radius_m, country?}; profile: {kind: {key: count}}; ip: IpContext.as_dict() or None;
    radio: {"wifi": [...], "cell": [...]} or None. -> dict (see module docstring)."""
    E, Wt = C.ENVIRONMENT, C.ENVIRONMENT["weights"]
    pen, flags, comps, notes = {}, [], [], []
    keys = keys_for(network_info, ip, radio)

    # link profile
    lk = (keys.get("link") or [None])[0]
    if lk is None:
        comps.append({"id": "link", "status": "unavailable", "detail": "this browser does not expose network information"})
    elif not _profile_known(profile, "link"):
        comps.append({"id": "link", "status": "unknown", "detail": f"site has fewer than {E['profileMin']} accepted visits to compare with"})
    elif lk in (profile or {}).get("link", {}):
        comps.append({"id": "link", "status": "match", "detail": lk})
    else:
        pen["linkUnseen"] = Wt["linkUnseen"]
        flags.append("network_unseen_at_site")
        comps.append({"id": "link", "status": "unseen", "detail": lk})
        notes.append((pen["linkUnseen"], "The network speed profile is new for this site"))

    # IP context
    ip_known = False
    if ip and not ip.get("private"):
        asn = ip.get("asn")
        if asn and _profile_known(profile, "asn"):
            ip_known = True
            if f"AS{asn}" in (profile or {}).get("asn", {}):
                comps.append({"id": "asn", "status": "match", "detail": f"AS{asn} {ip.get('org') or ''}".strip()})
            else:
                pen["asnUnseen"] = Wt["asnUnseen"]
                flags.append("network_provider_unseen_at_site")
                comps.append({"id": "asn", "status": "unseen", "detail": f"AS{asn} {ip.get('org') or ''}".strip()})
                notes.append((pen["asnUnseen"], "The internet provider is new for this site"))
        if ip.get("org"):
            ip_known = True
            if is_hosting(ip["org"]):
                pen["hosting"] = Wt["hosting"]
                flags.append("anonymizing_network")
                comps.append({"id": "hosting", "status": "hosting_or_vpn", "detail": ip["org"]})
                notes.append((pen["hosting"], f"The request comes from a hosting/VPN network ({ip['org']})"))
        if site and ip.get("lat") is not None and ip.get("lng") is not None:
            ip_known = True
            km = geo.haversine_m(ip["lat"], ip["lng"], site["lat"], site["lng"]) / 1000.0
            same_country = (not site.get("country")) or (not ip.get("country")) or site["country"].upper() == ip["country"].upper()
            if not same_country:
                pen["ipCountry"] = Wt["ipCountry"]
                flags.append("ip_country_mismatch")
                comps.append({"id": "ip_location", "status": "other_country", "detail": f"{ip.get('country')} vs site {site['country']}"})
                notes.append((pen["ipCountry"], f"The network is in {ip.get('country')}, the site is in {site['country']}"))
            elif km > E["ipFarKm"]:
                pen["ipFar"] = Wt["ipFar"]
                flags.append("ip_region_mismatch")
                comps.append({"id": "ip_location", "status": "far", "detail": f"{km:.0f} km from the site"})
                notes.append((pen["ipFar"], f"The network resolves {km:.0f} km from the site"))
            else:
                comps.append({"id": "ip_location", "status": "near", "detail": f"{km:.0f} km from the site"})
    else:
        comps.append({"id": "ip", "status": "unavailable", "detail": "private address or no IP database"})

    # time zone (never makes a result 'known' on its own)
    if tz_offset_min is not None and site:
        expect_h = site["lng"] / 15.0
        if abs(tz_offset_min / 60.0 - expect_h) > E["tzToleranceH"]:
            pen["tz"] = Wt["tz"]
            flags.append("tz_mismatch")
            comps.append({"id": "timezone", "status": "mismatch", "detail": f"device UTC{tz_offset_min / 60:+.1f}h, site longitude implies about UTC{expect_h:+.1f}h"})

    # native radio
    radio_known = False
    for kind in ("wifi", "cell"):
        seen = keys.get(kind)
        if seen and _profile_known(profile, kind):
            radio_known = True
            overlap = [k for k in seen if k in (profile or {}).get(kind, {})]
            if overlap:
                comps.append({"id": kind, "status": "match", "detail": f"{len(overlap)} of {len(seen)} known"})
            else:
                pen["radioNoOverlap"] = Wt["radioNoOverlap"]
                flags.append(f"{kind}_not_seen_at_site")
                comps.append({"id": kind, "status": "no_overlap", "detail": f"none of {len(seen)} seen at this site before"})
                notes.append((pen["radioNoOverlap"], f"None of the {kind.upper()} identifiers have been seen at this site"))

    known = bool((lk is not None and _profile_known(profile, "link")) or ip_known or radio_known)
    score = 1.0 - _noisy_or(pen.values()) if known else E["unknownValue"]
    notes.sort(key=lambda n: -n[0])
    return {
        "environment_consistency": round(max(0.0, min(1.0, score)), 4),
        "environment_known": known,
        "flags": list(dict.fromkeys(flags)),
        "penalties": {k: round(v, 4) for k, v in pen.items()},
        "reason": notes[0][1] if notes else None,
        "components": comps,
        "keys": keys,
    }
