# Signals Past the Walls (`wireless`)

Status: built. Follow `docs/unit3/ARCHITECTURE.md`.

Tagline: Secure an emergency shelter's Wi-Fi against snoopers in the parking lot and a rogue box on a wall jack.

CodeHS: `3.7 Locking Down the Airwaves`. CED LOs: 3.1.B, 3.1.C, 3.2.A, 3.2.B. (3.5.E, the evil twin and jamming, moved to `watch-the-air`.)

## What students learn

- Radio doesn't stop at walls (3.1.B.4). A **wireless access point (WAP)** sends **beacon frames** that announce its **SSID** and security settings to anyone nearby.
- Turning down **signal strength** or aiming the antenna keeps the signal inside the space (3.2.B.2). Turning off **beacon broadcasting** hides the network from casual scans (3.2.B.1), a low risk on its own (3.1.C.6).
- **Encryption** (3.2.B.3, 3.1.B.7): open Wi-Fi lets anyone in range read traffic. WEP, WPS, and the original WPA are broken. WPA2 holds with a strong passphrase. WPA3 is strongest.
- **Who may join** (3.1.B.5, 3.2.B.4): MAC filtering helps but can be spoofed. Requiring each user to authenticate (EAP to an authentication server) is stronger.
- **Rogue access point** (3.1.B.6): a WAP plugged into an open wall jack gives a back door into the LAN that skips every setting above.
- The evil twin (3.5.E.1) and jamming (3.5.E.2) are taught in `watch-the-air` (Watch the Air), which follows this shelter two weeks later.
- A **wireless security policy** (3.2.A.4): EAP to an approved server, AES encryption with a minimum key length, beacons disabled.

## Scenario and map

CED unit scenario 3B. After a storm, the Ridgeview High gym is an emergency shelter. A satellite link gives internet. You are a National Guard network technician setting up Wi-Fi for families. Map: the gym as a building zone, a parking lot outside it, the WAP inside with a dashed circle showing its signal's reach (it should start large enough to cover part of the lot), families' phones and laptops inside, the volunteer desk laptop, a hallway wall jack, and a car in the lot with Mallory's laptop.

Reach is distance on the map. Keep the radio model simple and say so: a device is in range if it is inside the circle, and signal strength falls off with distance.

## Step outline

1. **The shelter network**: tour. Inspect the WAP's settings: SSID, broadcast on, security open, power high.
2. **What a car can hear**: Mallory runs a Wi-Fi scanner from the lot: she sees the beacon (SSID, open, signal). She joins and captures a family's plain-HTTP traffic. Goal: Mallory joined from outside. Question: why walls didn't help.
3. **Keep it inside**: lower the power (and or aim it) until the circle covers the gym but not the lot. Goal: every family device still in range, Mallory out of range. Question about what else could still reach (a stronger antenna).
4. **Hide the name**: turn off beacon broadcasting. Families can still join a saved network. Question: why this is weak protection on its own (devices still ask for the network by name; a patient scanner sees it), and why the CED rates it low risk.
5. **Lock the air**: try WEP. Mallory (with a strong antenna, back in range) cracks it in seconds. Try WPA2 with a short passphrase, cracked by guessing; WPA2 with a long passphrase holds; WPA3 holds. Turn off WPS (a PIN that can be guessed). Goal: WPA3 (or WPA2 with a strong passphrase) and WPS off. Question: rank the protocols.
6. **Who gets in**: turn on MAC filtering with the families' devices. Mallory reads an allowed MAC from the air and copies it. She gets in. Switch to user authentication (EAP to an authentication server: each family gets its own login). Goal: Mallory can't join with a copied MAC. Question: why per-user logins beat a shared password and a MAC list.
7. **A box in the hallway**: someone plugs a cheap WAP into the hallway jack: an open SSID that bridges straight into the LAN. Find it with the scanner (an SSID you didn't set up, on your wired network) and shut the jack's port. Goal: rogue WAP gone.
   It ends with a pointer to the next lab: "Next: keeping watch."
8. **The wireless policy**: multi-select which rules belong in the shelter's wireless security policy.
9. **Reflect**: written, the shelter's configuration in a few sentences (the scenario's deliverable), naming each setting and the attack it stops.
10. **Submit**.

## Core features this lab owns

- WAP state (`Device.wifi`): SSID, beacon broadcast, security mode (`open`, `wep`, `wpa`, `wpa2`, `wpa3`), passphrase strength, WPS, transmit power and direction, MAC filter, authentication (`psk` or `eap`), channel. Association: a wireless host joins if it's in range and passes security; hosts out of range drop off. Keep `on-path`'s café Wi-Fi (a hub or switch with wireless links) working unchanged.
- The signal's reach as a `MapZone` that follows the power setting.
- Wi-Fi scanner (SSID, BSSID, security, signal, channel by location), cracking with time estimates by mode and passphrase, rogue WAP, evil twin, jamming, and triangulation from readings. (The twin, jamming, and triangulation are still in the sim and the scenario; `watch-the-air` uses them.) Log lines from the WAP (`source: 'wifi'`): joins, rejected joins, new SSIDs seen.
- Inspector section for WAP settings. Toolkit cards for the scanner, cracker, and triangulation.

## Acceptance

- Walkthrough test passes. Lab tests: the power setting changes who is in range; WEP cracks and WPA3 doesn't; a copied MAC passes MAC filtering and fails EAP; replay gives the same associations. (The evil-twin and jamming tests moved with those steps to `watch-the-air`.)

## Built (reconciliation with the plan)

Shipped as 12 steps. Version 2 (split for `watch-the-air`) removed steps 8 and 9 (`twin`, `jam`), their answer-key entries, and their tests, leaving the 10 steps above at 45 minutes. Deltas worth noting:

- **Radio model.** `src/sim/wifi.ts` uses a linear signal model, not a hard circle: `signalAt = txPower(power) + rxBoost - 0.15 * distance` (clamped 0–100), and a device associates when its best heard signal clears `JOIN_THRESHOLD` (20) and it passes security. The dashed `MapZone` circle is the radius where a plain client (no antenna) would cross that threshold, so the visual still reads as "inside = in range." The lesson says in step 1 that the model is simplified and walls don't block. An attacker's `wifiClient.antennaBoost` (a high-gain antenna) raises `rxBoost`, which is how Mallory gets back in range after the power is lowered.
- **Step 2 goal.** Mallory does not "join" the open network; an open AP (a `hub`) floods every frame to everyone in range, so she captures the family's plain-HTTP login from the lot with packet capture. Goals: scan from the lot, turn on capture, catch the login.
- **Keeping families connected through upgrades.** When the AP's security/passphrase changes, non-attacker clients on the same SSID silently receive the new key (`Sim.shareWifiKey`), so tightening security never knocks the families off. Mallory is handed the key explicitly in step 6's setup (she is a sheltering guest), which is why MAC/EAP, not the passphrase, is what finally stops her.
- **New shared APIs.** `Device.wifi` (`WifiAp`) and `Device.wifiClient` (`WifiClient`); Wi-Fi `SimEvent`/`SimAction` variants; `WebSite.account` (optional themed signed-in page text, added so the shelter portal doesn't show on-path's bank copy). These are additive and documented for the net-audit and logs labs to reuse.
- **Verified in a real browser** at 1366×768: all 15 goals, 25 auto-checked points, and the reflection complete end to end with no console errors (screenshots under `/tmp/netlab-wireless/`).
