from .blur import check_blur
from .exposure import check_exposure
from .glare import check_glare
from .noise import check_noise
from .obstruction import check_obstruction
from .resolution import check_resolution
from .shake import check_shake

# Same order as client/src/lib/photoQuality/checks/index.js. The face check is
# client-only for now (needs an on-device detector).
CHECKS = {
    "blur": check_blur,
    "resolution": check_resolution,
    "exposure": check_exposure,
    "obstruction": check_obstruction,
    "glare": check_glare,
    "shake": check_shake,
    "noise": check_noise,
}
