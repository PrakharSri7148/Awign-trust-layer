"""Sensor fusion: GPS trajectory vs accelerometer/gyroscope (motion consistency) and network environment vs the claimed
area (environment consistency). Pure functions; nothing here decides a verdict, the classifier does (classifier.py).

  geo.py          F1  trail cleaning, jumps, speed, "too perfect" GPS signatures, site relations
  windows.py      F2  per-window motion features and activity (port of client/src/lib/sensorFusion/windows.js)
  consistency.py  F3  GPS speed vs phone activity -> motion_consistency + evidence
  environment.py  F4  network profile / IP context / time zone / native radio -> environment_consistency
  ipctx.py        F4  IP -> country, region, ASN (DB-IP lite files, optional)
  trail.py        F5  payload parsing and validation
  pipeline.py     F5  glue used by main.py
  simulate.py     F7  trail simulator for the training data
"""
