"""Writes orientation_test.ies, a profile with three lobes that show which way a light faces.

On an unrotated point light facing +X with +Z up, the expected result is:
- Big lobe: toward -Z, 30 degrees off the +X axis.
- Small lobe: toward -Y, 30 degrees off the +X axis.
- Dim lobe: toward -Y, 45 degrees off the -X axis. Spot lights can't show this one.
"""
import math
import os

V = [float(a) for a in range(0, 181)]
H = [float(a) for a in range(0, 360, 5)] + [360.0]


def blob(h, v, ch, cv, radius, peak):
    # Angular distance on the sphere keeps the blob round in the map view.
    a = math.radians(v)
    b = math.radians(cv)
    d = math.radians(h - ch)
    cos_d = math.sin(a) * math.sin(b) * math.cos(d) + math.cos(a) * math.cos(b)
    dist = math.degrees(math.acos(max(-1.0, min(1.0, cos_d))))
    return peak * max(0.0, 1.0 - dist / radius)


def candela(h, v):
    return max(
        blob(h, v, 90.0, 30.0, 14.0, 1000.0),  # big front lobe, H=90
        blob(h, v, 0.0, 30.0, 7.0, 500.0),     # small front lobe, H=0
        blob(h, v, 0.0, 135.0, 14.0, 250.0),   # back lobe, only a point light can show it
    )


def write_ies(path):
    with open(path, "w", newline="\r\n") as f:
        f.write("IESNA:LM-63-2002\n[TEST]IES orientation test\n[MANUFAC]Penumbra\nTILT=NONE\n")
        f.write(f"1 -1 1 {len(V)} {len(H)} 1 2 0 0 0\n1 1 0\n")
        f.write(" ".join(f"{a:g}" for a in V) + "\n")
        f.write(" ".join(f"{a:g}" for a in H) + "\n")
        for h in H:
            f.write(" ".join(f"{candela(h, v):.3f}" for v in V) + "\n")


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "orientation_test.ies")
    write_ies(out)
    print("wrote", out, os.path.getsize(out), "bytes")
