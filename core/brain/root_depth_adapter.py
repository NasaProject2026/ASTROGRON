"""Opt-in repair: new-crop soil rooting limit matches pinned native root dynamics.

No crop parameter or soil layer is changed. Never apply to legacy profiles.
"""
import math
VERSION="ROOT_SOIL_LIMIT_SETUP_V1"

def effective_depth(parameters,soil_profile):
    initial,crop,soil=(float(parameters[k]) for k in ("RDI","RDMCR","RDMSOL"))
    if any(not math.isfinite(v) or v<=0 for v in (initial,crop,soil)):raise ValueError("FINITE_POSITIVE_ROOT_DEPTHS_REQUIRED")
    depth=max(initial,min(crop,soil))
    if not math.isfinite(depth) or depth>soil_profile.get_max_rootable_depth():
        raise ValueError("ROOT_SOIL_GEOMETRY_INCOMPATIBLE")
    soil_profile.validate_max_rooting_depth(depth)
    return depth

def setup_new_crop(self):
    depth=effective_depth(self.parameter_provider,self.soil_profile)
    self._RDM=depth
    self.soil_profile.determine_rooting_status(self._default_RD,depth)
