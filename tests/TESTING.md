# Beam ⚡ — manual test checklist

Run these in order, on two real devices (phone + laptop). Tick each
one only when you actually see the result.

- [ ] 1. Same Wi-Fi: phone beams one text snippet → laptop shows it
      with a Copy button. Time it: ______ seconds.
- [ ] 2. Same Wi-Fi: phone beams one ~5 MB photo → laptop downloads
      it and the photo opens correctly. Time: ______ seconds.
- [ ] 3. Reverse: laptop beams text → phone receives it.
- [ ] 4. Phone on mobile data (different network): does it connect?
      Result: ________________ (this finds the NAT failure boundary).
- [ ] 5. Close one tab mid-session: the other side shows "Peer left",
      no hang.
- [ ] 6. Reload the page: previously received texts are still listed
      (local history only).
- [ ] 7. Desktop Chrome/Edge/Firefox + mobile Chrome/Safari: page
      loads and QR code displays on each.

If step 4 fails, that is a known v1 limit (strict networks can block
P2P) — record it honestly in the README instead of hiding it.
A TURN relay fallback is the planned v2 fix.
