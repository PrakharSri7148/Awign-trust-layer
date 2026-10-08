"""Compare what the device claimed about its photo with what the server measured."""
from .config import FAIL, PASS, SKIP, V_BLOCK, V_PASS

BLOCKING_CHECKS = ("blur", "exposure", "resolution", "obstruction", "face", "liveness")
DIMENSION_TOLERANCE = 0.02


def compare_reports(client: dict | None, server: dict) -> list[str]:
    if not client:
        return ["client_report_missing"]
    flags = []

    cm, sm = client.get("metrics") or {}, server["metrics"]
    for key in ("width", "height"):
        c, s = cm.get(key), sm[key]
        if c is None or abs(c - s) > DIMENSION_TOLERANCE * s:
            flags.append("client_dimensions_mismatch")
            break

    # Only a clear contradiction counts: the device said "pass" where the server
    # measured a failure. Borderline numbers legitimately differ by browser.
    for cid in BLOCKING_CHECKS:
        c = (client.get("checks") or {}).get(cid, {}).get("status")
        s = server["checks"].get(cid, {}).get("status")
        if s == FAIL and c in (PASS, None, SKIP):
            flags.append(f"client_missed_{cid}")

    if client.get("verdict") == V_PASS and server["verdict"] == V_BLOCK:
        flags.append("client_verdict_mismatch")
    return flags
