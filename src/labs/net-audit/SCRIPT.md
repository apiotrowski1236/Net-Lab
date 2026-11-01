# The Network Audit (`net-audit`) — lesson script

The full lesson as students see it. An implementer turns this into `index.ts`,
`scenario.ts`, `solution.ts`, and the sim and UI features listed at the end.

## Changes made while building

The lesson text, goals, and questions are as scripted below, except where the
simulation forced a change:

1. **Step 1 drops the `scope` goal**, as the script allows. The three inspects stay.
2. **Scanner state and action names.** The action is `audit-scan` (`scan` is
   taken by the port-scan primitive). State is `Device.audit` (`src/sim/audit.ts`):
   the last few `reports` (each with `findings` that are present, the `hosts` map,
   and times) plus the `register`. A finding is either in a report or not, so
   there is no `present` flag. `scan-complete` also carries the report number.
3. **Telnet and SSH are services, not a new `login` app.** They are entries in
   `Device.services`, so the port scan finds them and the login is a
   `connectService` request carrying the user and password. No new `AppData`.
4. **SSH starts on**, not off, so step 3's **Log in over SSH** gets an answer.
   The step 6 goal still requires it on.
5. **One `authServer` setting** replaces `localAccounts` and `authServer`:
   turning on the authentication server removes the local account. The
   toggle is a two-way choice, "Local account" or "Authentication server".
6. **No `blockInboundIcmp` flag.** "Drop pings from the internet" adds or
   removes a real inbound deny rule on the router's firewall, and the step 6
   goal checks the firewall itself. Step 6 also lists the `firewall-rules`
   card for the router, so students can see the rule the switch wrote.
7. **The outside probe reuses the port-scan primitive:** `internet` runs a
   ping-only scan (no ports) of `198.51.100.2`. The router firewall gained
   `guardSelf` so its inbound rules also cover traffic to the router itself.
8. **Home network:** a **Home switch** (`homesw`) joins the bookkeeper laptop,
   the shared home laptop, and the home router, since a router port takes one
   cable. The bookkeeper's laptop is labeled "Bookkeeper laptop" and the shared
   one "Shared home laptop".
9. **The VPN tunnel is a `Link` with `tunnel: true`**, drawn dashed and labeled
   "VPN tunnel". It is how packets reach the router; it is not a cable.
10. **`wap` has no management IP.** It is a switch-kind device in the
    `wireless` lab's model, so the scanner judges it by its settings
    (`wifi-weak`, `wifi-beacon`), not by a port scan.
11. **Wi-Fi reuses the `wireless` lab:** its `wifi-security` action (field
    `security`, not `mode`) and its `wifi-config` card. No `wifi-settings` kind.
12. **Switch policy as bulk toggles.** The switch's Security settings set port
    security (one MAC, shut on violation) on every desk port, MAC filtering
    (each port's current MAC), and "Shut ports nobody uses". The `switch-ports`
    inspector from `mac-flood` stays read-only here.
13. **Two empty ports, p7 (lobby wall jack) and p8 (spare)**, both shut by the
    policy. The scenario has eight ports and only six cables.
14. **VPN settings unlock in step 9.** Step 6 unlocks the router's Security
    settings, but the VPN part stays read-only until step 9 re-lists the tool
    with `vpn: true`. Otherwise a student could turn split tunneling off early
    and never see the risk in step 9.
15. **`pingTimeoutMs: 20000`.** The home probe takes about 12 seconds through the
    tunnel at 1x, longer than the default timeout.
16. **Own frames in the capture.** The audit laptop sets `captureOwn`, so its own
    Telnet and SSH logins show in its capture, as Wireshark shows them.

## What changed from PLAN.md

The plan is followed, with these changes (PLAN.md updated to match):

1. **Added a short Wi-Fi step (step 8, "Close the Wi-Fi").** The CED's high-risk
   example is weak Wi-Fi encryption on a flat network with a key server (3.1.C.4).
   The plan rated it but never cleared it, so step 9's re-scan goal ("no high or
   moderate findings") could not pass. Step 8 sets the access point from WEP to
   WPA3, reusing the `wireless` lab's WAP settings (already a listed reuse). This
   makes the lab 12 steps instead of 11, inside the 9 to 13 range.
2. **The file server's "old web admin page" is folded into the high finding**
   instead of being a separate finding. The file server is the "server running
   its proprietary web-application" from the CED's high example, so its donor
   web app is the evidence that makes the WEP finding high. This keeps the risk
   register to seven rows instead of eight.
3. **Step 3 ("See it for yourself") has the auditor run the Telnet login**,
   not the office manager. The office is switched, so the auditor could not sniff
   someone else's unicast session without a mirror port. An authorized auditor
   logging in with the default credentials confirms the Telnet finding (plaintext
   password) and the default-password finding at the same time.

**Orchestrator edit:** the scanner's severities use the course's words (high, moderate, low) instead of Critical and Medium, so students see one vocabulary for risk.

## CED coverage by step

- Authorization and legality: step 1.
- 3.1.C.2 (automated scanner, report with severity and fixes), 3.1.B.1 (mapping): step 2.
- 3.2.A.1 Telnet rationale, 3.1.C.1 confidentiality: step 3.
- 3.1.C.3 (exploit difficulty raises likelihood): step 4.
- 3.1.C.1 (CIA), 3.1.C.4 / 3.1.C.5 / 3.1.C.6 (high, moderate, low examples): step 5.
- 3.2.A.1 (router policy): step 6.
- 3.2.A.2 (switch policy): step 7.
- 3.1.C.4 (the high example cleared): step 8.
- 3.2.A.3 (VPN policy, no split tunneling): step 9.
- Risk acceptance of residual low risk: step 10.
- Audit summary (risk assessment documentation): step 11.

`ced: ['3.1.B', '3.1.C', '3.2.A']`. `codehs: []` (none confirmed in the plan).
`version: 1`. `minutes: 45`. `clock: '09:00'`. `captureDevice: 'auditor'`.
`labelMacs: true`.

`objectives`:
- Run an automated vulnerability scanner and read its report of findings, severity, and fixes.
- Rate each risk by likelihood and impact, using exploit difficulty and the CIA triad.
- Write router, switch, and VPN security policies and apply them as device settings.
- Explain why some low risks are accepted while high and moderate risks are fixed.

---

## Scenario and map

Harbor Food Bank's office, 09:00 on a weekday. You are an outside auditor with a
signed scope letter and an audit laptop plugged into the office switch. The
office is one flat network, `192.168.50.0/24`, behind an edge router with a
firewall. A bookkeeper works from home over a VPN.

Canvas is 1000 x 600. Centers are at least 130 apart.

| id | label | kind | icon | x | y | addresses | services / ports | settings |
|---|---|---|---|---|---|---|---|---|
| `auditor` | Audit laptop | host | laptop | 150 | 320 | `192.168.50.40/24`, gw `192.168.50.1` | none | the student; owns the scanner and risk register |
| `pc1` | Intake PC (Priya) | host | desktop | 150 | 120 | `192.168.50.21/24`, gw `.1` | none | — |
| `pc2` | Manager PC | host | desktop | 150 | 510 | `192.168.50.22/24`, gw `.1` | none | — |
| `fileserver` | Donor records server | host | server | 380 | 120 | `192.168.50.10/24`, gw `.1` | HTTP 80 (donor web app), SMB 445 (file share), SSH 22 | the "key server"; donor records |
| `sw` | Office switch | switch | switch | 380 | 320 | — | 8 ports; port 7 is an open lobby wall jack | `portSecurity` off |
| `wap` | Office Wi-Fi | hub | wifi | 380 | 510 | `192.168.50.5/24` (management) | wired uplink to `sw` | `wifi`: SSID `HarborFoodBank`, `security: 'wep'`, `beacon: true`, power reaches the lot |
| `router` | Edge router | router | router | 610 | 320 | lan `192.168.50.1/24`, wan `198.51.100.2/30` | Telnet 23, SSH 22 (management) | `hardening`: `telnet` on, `ssh` off, `localAccounts` on (`admin`/`foodbank`), `authServer` off; `firewall` allows inbound ICMP; `vpn`: `splitTunneling` on, `auth: 'password'` |
| `internet` | The Internet | router | cloud | 820 | 170 | office side `198.51.100.1/30`, home side `203.0.113.1/30` | — | used as the "outside" vantage for the external ICMP probe |
| `bookkeeper` | Bookkeeper (home) | host | laptop | 820 | 430 | `10.0.0.5/24`, gw `10.0.0.1` | none | holds the VPN tunnel to `router` |
| `homenet` | Home router | router | router | 920 | 540 | lan `10.0.0.1/24`, wan `203.0.113.2/30` | — | the bookkeeper's home gateway |
| `homedev` | Home laptop (shared) | host | desktop | 700 | 540 | `10.0.0.6/24`, gw `10.0.0.1` | none | stands in for a compromised home device |

Cables (physical links): `pc1`-`sw`, `pc2`-`sw`, `fileserver`-`sw`,
`auditor`-`sw`, `wap`-`sw`, `router`-`sw` (lan), `router`-`internet` (wan),
`bookkeeper`-`homenet`, `homedev`-`homenet`, `homenet`-`internet`.

The VPN tunnel from `bookkeeper` to `router` is drawn as a dashed line, not a
cable. Office port 7 on `sw` has no device (the lobby jack).

`map.zones(sim)`:
- `office`: rect around `pc1`, `pc2`, `fileserver`, `sw`, `wap`, `auditor`, `router`, tone `neutral`, label "Food bank office".
- `lot`: rect to the lower right of the office (the parking lot), tone `warn`, label "Parking lot".
- `wifi`: dashed circle centered on `wap`, radius reaching into `lot` while WEP/weak power, tone `warn`. (If step 8 or the wireless lab lets power change, the radius follows it; in this lab it stays put, so say so.)
- `home`: rect around `bookkeeper`, `homenet`, `homedev`, tone `neutral`, label "Bookkeeper's home".

---

## The findings catalog

Seven findings. The scanner seeds all seven on the first scan. Each clears from a
re-scan when its setting changes. The scanner assigns a starting severity
(3.1.C.2). The student assigns likelihood and impact in step 5; the three CED
examples must land high, moderate, and low.

| id | finding text | scanner severity | evidence | recommended fix | setting that clears it |
|---|---|---|---|---|---|
| `telnet` | `[[router]]` has Telnet (port 23) open. Logins cross the network in plaintext. | High | Port 23 answered; the step 3 capture shows the password in the clear. | Disable Telnet. Use SSH for management. | `router.hardening.telnet === false` and `router.hardening.ssh === true` |
| `default-admin` | `[[router]]` has a local `admin` account with the factory password. | High | The scanner logged in with `admin` / `foodbank`. | Remove local accounts. Require logins through the authentication server. | `router.hardening.localAccounts === false` and `router.hardening.authServer === true` |
| `edge-icmp` | The edge firewall answers pings from the internet. **(CED moderate, 3.1.C.5)** | Moderate | An ICMP echo from the internet to `198.51.100.2` got a reply. | Configure the firewall to drop inbound ICMP from the internet. | an inbound-deny ICMP rule exists on `router` (via the firewall engine); modeled by `router.hardening.blockInboundIcmp === true` |
| `switch-open` | `[[sw]]` has no port security, and port 7 is a live wall jack in the lobby. | Moderate | Port 7 is up with no device; the switch accepts any MAC on any port. | Turn on port security. Shut unused ports. | `sw` port security on for access ports and port 7 shut (via mac-flood's port-security API) |
| `wifi-weak` | `[[wap]]` uses WEP on the office network, which also holds the donor records server. **(CED high, 3.1.C.4)** | High | The beacon advertises WEP; the donor web app is reachable from the Wi-Fi subnet. | Use strong encryption (WPA2 or WPA3). Segment the donor server off the flat network. | `wap.wifi.security` is `wpa2` or `wpa3` |
| `wifi-beacon` | `[[wap]]` broadcasts a beacon frame with its SSID and encryption type. **(CED low, 3.1.C.6)** | Low | The scanner read the beacon from the parking lot. | Optional: disable beacon broadcast. Low risk; often accepted. | `wap.wifi.beacon === false` (the lab does **not** require this; it is the accepted low risk) |
| `vpn-split` | The bookkeeper's VPN allows split tunneling, and the VPN uses a password only. | Moderate | The VPN config shows split tunneling on; a home device can reach the office through her laptop. | Prohibit split tunneling. Require keys or MFA. | `router.vpn.splitTunneling === false` and `router.vpn.auth` is `'key'` or `'mfa'` |

**Risk matrix** (the register computes the rating from likelihood and impact):

| | impact low | impact moderate | impact high |
|---|---|---|---|
| **likelihood low** | low | low | moderate |
| **likelihood moderate** | low | moderate | high |
| **likelihood high** | moderate | high | high |

Answer-key ratings (the student's own assessment, step 5):

| finding | likelihood | impact | rating |
|---|---|---|---|
| `telnet` | high | moderate | high |
| `default-admin` | high | high | high |
| `edge-icmp` | high | low | **moderate** (CED) |
| `switch-open` | moderate | moderate | moderate |
| `wifi-weak` | high | high | **high** (CED) |
| `wifi-beacon` | low | low | **low** (CED) |
| `vpn-split` | moderate | high | high |

The step 5 goal checks only that the three CED anchors compute high, moderate,
and low, and that every finding has both fields set. The student may reason to a
different likelihood or impact for a non-anchor finding as long as both are set.

---

## Steps

Voice throughout: short sentences, imperatives, bold the first use of a term,
`[[deviceId]]` chips, button names in bold exactly as labeled. No em dashes, no
emoji.

### Step 1 — `engagement` "The engagement"

**Body:**

> Harbor Food Bank hired you to audit its office network. Before you touch
> anything, read the **scope letter**: the written permission that says what you
> may test, and when.
>
> - **Who:** you, the outside auditor.
> - **What:** every device on the office network, `192.168.50.0/24`, and the
>   bookkeeper's VPN.
> - **When:** today, 09:00 to 17:00.
> - **Not allowed:** changing donor records, or testing anything outside the list.
>
> Your audit laptop, [[auditor]], is already plugged into the office switch.
> Look around first. Click [[router]], then [[fileserver]], then [[wap]]. Note
> what each one is and what it runs.
>
> > Everything in this lab happens inside a simulation. Running a vulnerability
> > scanner against a network you do not own or have written permission to test
> > is illegal.

**Action buttons:** none.

**Tools:** none (the map and inspector are always available).

**Goals:**
- `scope` — "Read the scope letter" — completes when the student has opened the lesson and the scope callout is on screen. Implement as entering the step (`ui:enter-step`), or make it a trivial inspect goal; simplest is to drop this goal and keep the three inspects.
- `router` — "Open [[router]]" — `inspected('router')`.
- `fileserver` — "Open [[fileserver]]" — `inspected('fileserver')`. Hint: "Look at its open services: a donor web app on port 80, file sharing on 445, and SSH on 22."
- `wap` — "Open [[wap]]" — `inspected('wap')`.

**Questions:**

1. `why-scope` (choice). Prompt: "The food bank signed a scope letter before you plugged in. Why does that signature matter?"
   - ✓ "Without permission, running a scanner on someone's network is a crime."
   - "It proves the food bank will pay your invoice." — feedback: "A scope letter is about permission, not payment."
   - "It makes the scan find more vulnerabilities." — feedback: "Permission does not change what the scan finds. It changes whether you are allowed to run it."
   - "It lets you skip the parts of the network you dislike." — feedback: "The scope says what you may test. It is a limit, not a shortcut."
   - explain: "A scan probes other people's systems. Doing that without written authorization is illegal, even when you mean well. The scope letter sets what you may test and when."

**Answer-key moves:** `{ inspect: 'router' }`, `{ inspect: 'fileserver' }`, `{ inspect: 'wap' }`. Choice from the lab.

---

### Step 2 — `scan` "Run the scan"

**Body:**

> An **automated vulnerability scanner** probes a network for known weaknesses.
> It checks which devices answer, which services each one runs, and whether their
> settings are safe. Then it writes a **report**: each weakness, how severe it is,
> and a suggested fix.
>
> 1. Open the **Toolkit** tab and press **Run scan** on the scanner.
> 2. Watch the probes cross the map from [[auditor]] to each device.
> 3. Read the report below the scanner. Click a finding to see its evidence and
>    fix.
>
> One probe goes out to the internet and back, to test what the edge router shows
> the outside world.

**Action buttons:** none (the scanner card has its own **Run scan** button).

**Tools:** `{ kind: 'scanner', device: 'auditor' }` (new, this lab). The card has
**Run scan** and renders the report.

**Goals:**
- `scanned` — "Run the scan and get a report" — completes when a `scan-complete` event fired since the step started with at least one finding. Hint: "Press **Run scan** in the Toolkit tab."
- `read` — "Open a finding in the report" — completes on a `ui:open-finding` event (the student clicked a report row). Hint: "Click any row in the report to read its evidence."

**Questions:**

1. `report-contents` (choice). Prompt: "The scanner's report lists three things about each weakness. Which three?"
   - ✓ "The finding, how severe it is, and a suggested fix."
   - "The attacker's name, their location, and their motive." — feedback: "A scanner checks settings and services. It cannot name a person."
   - "The finding, the exact date it will be exploited, and by whom." — feedback: "No scanner predicts the future. It reports what is weak now."
   - "A bill, a contract, and a signature." — feedback: "That is paperwork, not a scan report."
   - explain: "An automated scanner reports each weakness with a severity and a mitigation (3.1.C.2). Severity is a starting point. You still judge the real risk yourself."

2. `mapping` (choice, `afterGoals: true`). Prompt: "The scan did more than flag weak settings. What else did it show an attacker could do?"
   - ✓ "Map the office: which devices exist and what each one runs."
   - "Decrypt the donor records on the file server." — feedback: "The scanner reads open ports and settings. It broke no encryption."
   - "Delete the findings so no one else sees them." — feedback: "A scanner reports what it finds. It does not change the target."
   - "Install a firewall by itself." — feedback: "A scanner recommends fixes. A person still applies them."
   - explain: "The same probing that finds weak settings also maps the network: every device and service (3.1.B.1). That map is the first thing an adversary builds."

**Answer-key moves:** `{ tool: { type: 'scan', device: 'auditor' } }`, then open a finding (new move, see implementer notes: `{ openFinding: 'telnet' }`). Choices from the lab.

---

### Step 3 — `telnet` "See it for yourself"

**Body:**

> The report says [[router]] still runs **Telnet**, an old way to log in to a
> device over the network. The scope letter lets you confirm it. The scanner
> already found the password: the factory default `admin` / `foodbank`.
>
> 1. Make sure the scanner's **packet capture** is on.
> 2. Press **Log in over Telnet**. You sign in to the router.
> 3. Open the **Capture** tab and click the Telnet packet. Read the password.
> 4. Press **Log in over SSH** and open that packet. Compare the two.
>
> **SSH** does the same job as Telnet, but it encrypts the session.

**Action buttons:**
- `telnet-login` "Log in over Telnet" — `auditor` opens a Telnet session to `192.168.50.1:23` with `admin` / `foodbank`. The login frame is plaintext (`encrypted: false`).
- `ssh-login` "Log in over SSH" — `auditor` opens an SSH session to `192.168.50.1:22`. The login frame is encrypted (`encrypted: true`).

**Tools:** `{ kind: 'sniffer', device: 'auditor' }` (reused from `on-path`).

**Goals:**
- `capture-on` — "Turn on packet capture for [[auditor]]" — `sim.dev('auditor').sniffing`.
- `telnet-caught` — "Capture the Telnet login" — a captured frame on `auditor` since step start whose app is a plaintext Telnet login (new predicate `isTelnetLogin`). Hint: "Turn capture on, then press **Log in over Telnet**."
- `telnet-open` — "Open the Telnet packet and read the password" — `openedFrame('auditor', isTelnetLogin)`. Hint: "In the Capture tab, click the row marked **Telnet**."
- `ssh-open` — "Open the SSH packet and see that it is scrambled" — `openedFrame('auditor', isEncrypted)`. Hint: "Press **Log in over SSH** first, then click the row marked **SSH**."

**Questions:**

1. `telnet-why` (choice). Prompt: "You read the admin password straight out of the Telnet capture. SSH showed only scrambled text. Why does the router policy ban Telnet?"
   - ✓ "Telnet sends the login in plaintext, so anyone on the path can read the password."
   - "Telnet is slower than SSH." — feedback: "Speed is not the issue. Compare what you could read in each capture."
   - "Telnet uses the wrong port number." — feedback: "A port number is not a weakness. What crossed the wire in the clear?"
   - "SSH hides the router from scanners." — feedback: "SSH still shows as an open port. It protects the contents, not the fact that the service exists."
   - explain: "Telnet carries everything, including passwords, as readable text. SSH encrypts the session. The router policy disables unneeded, insecure services like Telnet (3.2.A.1)."

2. `default-pw` (text, teacher-graded, `minWords: 15`, `lines: 2`). Prompt: "You logged in with `admin` / `foodbank`, the factory default. In a sentence or two, say why a default password is a finding even after Telnet is turned off."
   - Sample answer: "Default passwords are printed in manuals and posted online, so anyone can try them. Even over SSH, an attacker who knows the default can log in as admin, so the account needs a unique password or, better, logins through the authentication server."

**Answer-key moves:** `{ tool: { type: 'sniff', device: 'auditor', on: true } }`, `{ press: 'telnet-login' }`, `{ openFrame: 'auditor', match: 'telnet' }`, `{ press: 'ssh-login' }`, `{ openFrame: 'auditor', match: 'encrypted' }`. Add `'telnet'` to the capture-match map.

---

### Step 4 — `likelihood` "How likely?"

**Body:**

> Every finding is a risk. **Risk** has two parts: how **likely** the weakness is
> to be used, and how much **impact** it would have.
>
> Likelihood depends on skill. A weakness with an easy, well-known exploit gets
> used more often, because more people can pull it off. A weakness that needs
> rare skill is less likely, even when the impact would be large.
>
> Sort this office's findings by how hard they are to exploit.

**Action buttons:** none.

**Tools:** the scanner and its report stay available.

**Goals:** none (a question-only step, like on-path's "Why that worked"). The step
completes when both questions are answered.

**Questions:**

1. `easy` (choice, `multi: true`). Prompt: "Which of these needs the least skill to exploit? Choose all that apply."
   - ✓ "Reading the Telnet password with a free sniffer."
   - ✓ "Logging in with the default admin password."
   - ✓ "Picking up the Wi-Fi beacon from the parking lot."
   - "Breaking strong encryption to read an HTTPS session." — feedback: "No known shortcut exists for that. It needs rare skill, so its likelihood is low."
   - explain: "Exploit difficulty changes likelihood (3.1.C.3). Easy, well-documented attacks are more likely, so they push a risk up."

2. `combine` (choice). Prompt: "A finding is easy to exploit but, if exploited, barely affects the food bank. How should that shape its rating?"
   - ✓ "High likelihood, low impact, so a middling risk."
   - "Easy to exploit always means high risk." — feedback: "Likelihood is only half of it. A harmless weakness is still low impact."
   - "Low impact means the risk is zero." — feedback: "Low is not zero. You still record it."
   - "Once you know the likelihood, impact stops mattering." — feedback: "Risk needs both. The register combines them."
   - explain: "Risk combines likelihood and impact. Easy but harmless lands in the middle. The open-ping finding is exactly this case."

**Answer-key moves:** none. Choices from the lab.

---

### Step 5 — `register` "Rate the risks"

**Body:**

> Open the **risk register** in the Toolkit. It lists every finding. For each one,
> set the **likelihood** and the **impact**. The register combines them into a
> rating: low, moderate, or high.
>
> Three of these findings match examples from the course framework. Rate them to
> match:
>
> - The **WEP Wi-Fi** on the flat network with the donor server: this is the high
>   example.
> - The **edge firewall answering pings**: this is the moderate example.
> - The **beacon broadcast**: this is the low example.
>
> Rate the other four with your own judgment from the last step.

**Action buttons:** none.

**Tools:** `{ kind: 'risk-register', device: 'auditor' }` (new, this lab). Each row
has two dropdowns (likelihood, impact) and shows the computed rating.

**Goals:**
- `anchors` — "Rate the three framework examples high, moderate, and low" — completes when the register's computed rating for `wifi-weak` is high, for `edge-icmp` is moderate, and for `wifi-beacon` is low. Hint: "WEP is trivial to crack and the records are sensitive. A ping reveals the device but little else. A beacon leaks only the network name and its encryption type."
- `all-rated` — "Rate every finding" — completes when all seven findings have both a likelihood and an impact set.

**Questions:**

1. `cia` (choice, `afterGoals: true`). Prompt: "You rated the WEP Wi-Fi finding high. An attacker who cracks it can read the donor records as they cross the network. Which part of the CIA triad does that break first?"
   - ✓ "Confidentiality."
   - "Integrity." — feedback: "Integrity is about changing data. Reading it breaks confidentiality first."
   - "Availability." — feedback: "Availability is about keeping the service up. Reading records does not take it down."
   - "None. Reading data is not a security problem." — feedback: "Donor records are private. Reading them is a confidentiality breach." — `last: true`
   - explain: "Network vulnerabilities threaten confidentiality, integrity, and availability (3.1.C.1). Eavesdropping breaks confidentiality, altering records breaks integrity, and a DoS breaks availability."

**Answer-key moves:** one `rate-risk` move per finding, using the answer-key ratings table above. Choice from the lab.

---

### Step 6 — `router-policy` "Write the router policy"

**Body:**

> A **managerial control** is a written policy that sets a minimum standard for
> how devices are configured. Start with [[router]].
>
> First, pick the statements that belong in a **router security policy**. Then
> apply them in the router's **Security settings** and run the scanner again.

**Action buttons:** none (settings are applied in the inspector; re-scan from the
scanner card).

**Tools:** the scanner stays; `{ kind: 'hardening', device: 'router' }` unlocks the
Security settings section in the router's inspector (new, this lab). Toggles:
Telnet, SSH, local accounts vs. authentication server, block inbound ICMP from the
internet.

**Goals:**
- `apply` — "Apply the router policy: Telnet off, SSH on, no local accounts, and block pings from the internet" — completes when `telnet === false`, `ssh === true`, `localAccounts === false`, `authServer === true`, and `blockInboundIcmp === true`. Hint: "Open [[router]] and use the Security settings section."
- `rescan` — "Re-scan and clear the router's findings" — completes when a `scan-complete` event since step start has none of `telnet`, `default-admin`, or `edge-icmp`. Hint: "Apply the settings first, then press **Run scan**."

**Questions:**

1. `policy-pick` (choice, `multi: true`). Prompt: "Which statements belong in the router security policy?"
   - ✓ "Ban local accounts. All router logins go through the approved authentication server."
   - ✓ "Disable services the router does not need, such as Telnet."
   - ✓ "Require a firewall, and set it to drop traffic that should not reach the router."
   - "Share the admin password with every staff member so they can help." — feedback: "A shared password is the opposite of a policy, and the policy bans local accounts anyway."
   - "Turn off logging to save disk space." — feedback: "Logs are how you detect attacks. A policy never turns them off."
   - "Keep Telnet, but pick a longer password." — feedback: "Telnet sends the password in the clear whatever its length. Disable it."
   - explain: "A router security policy may ban local accounts, disable unneeded services like Telnet, and require a firewall (3.2.A.1). It sets the minimum every router must meet."

2. `where-logins` (choice, `afterGoals: true`). Prompt: "After the re-scan, the local admin finding is gone. Where do router logins go now?"
   - ✓ "To the approved authentication server."
   - "Nowhere. The router cannot be managed anymore." — feedback: "You can still log in, through the authentication server instead of a local account."
   - "To a local account with a longer password." — feedback: "The policy removed local accounts entirely."
   - "To the firewall." — feedback: "A firewall filters traffic. It does not hold logins."
   - explain: "Central authentication means one place to add, remove, and audit accounts, instead of a local password on every device."

**Answer-key moves:** `{ inspect: 'router' }`, then `harden` moves setting `telnet` off, `ssh` on, `localAccounts` off, `authServer` on, `blockInboundIcmp` on, then `{ tool: { type: 'scan', device: 'auditor' } }`. Choices from the lab.

---

### Step 7 — `switch-policy` "Write the switch policy"

**Body:**

> Now [[sw]]. The report found no **port security** and a live wall jack in the
> lobby, port 7. Anyone could plug a laptop into it and join the office network.
>
> Pick the statements that belong in a **switch security policy**, then apply them
> and re-scan.

**Action buttons:** none.

**Tools:** the scanner stays; `{ kind: 'hardening', device: 'sw' }` unlocks the
switch's Security settings (new, this lab; wraps `mac-flood`'s port-security API).
Toggles: port security on access ports, MAC filtering, authentication server, and
shut the lobby jack (port 7).

**Goals:**
- `apply` — "Turn on port security, shut the lobby jack, and switch logins to the authentication server" — completes when `sw` port security is on for access ports, port 7 is shut, and `authServer === true`. Hint: "Open [[sw]] and use the Security settings section."
- `rescan` — "Re-scan and clear the switch finding" — completes when a `scan-complete` event since step start has no `switch-open`. Hint: "Apply the settings first, then press **Run scan**."

**Questions:**

1. `policy-pick` (choice, `multi: true`). Prompt: "Which statements belong in the switch security policy?"
   - ✓ "Ban local accounts. Switch logins go through the authentication server."
   - ✓ "Turn on port security so each port accepts only a limited set of MAC addresses."
   - ✓ "Use MAC filtering to allow only known devices."
   - "Unplug the switch overnight." — feedback: "That stops the office, not an attacker during the day."
   - "Hide the switch in a locked closet instead of setting port security." — feedback: "A locked closet does not help against the open jack out in the lobby. Do both."
   - "Give the switch a public internet address so admins can manage it from home." — feedback: "That exposes management to the whole internet. Hardening points the other way."
   - explain: "A switch security policy may ban local accounts, require port security, and use MAC filtering (3.2.A.2)."

2. `mac-weak` (choice). Prompt: "The policy lists MAC filtering. A MAC address can be copied. Why keep MAC filtering in the policy anyway?"
   - ✓ "It raises the effort and blocks casual devices, as one layer among several."
   - "A MAC address cannot actually be copied." — feedback: "It can. It is sent in the clear and easy to change, which is why filtering is not enough on its own."
   - "MAC filtering encrypts the network." — feedback: "It decides who may connect. It does not encrypt anything."
   - "It is the only control a switch needs." — feedback: "On its own it is weak. Port security and authentication back it up."
   - explain: "No single control is enough. MAC filtering stops casual devices and adds a layer; port security and user authentication cover what it misses."

**Answer-key moves:** `{ inspect: 'sw' }`, `harden` moves (port security on, port 7 shut, MAC filtering on, authServer on), then `{ tool: { type: 'scan', device: 'auditor' } }`. Choices from the lab.

---

### Step 8 — `wifi` "Close the Wi-Fi"

**Body:**

> The highest-rated finding is the Wi-Fi. [[wap]] uses **WEP**, an encryption that
> takes seconds to crack. The office is one flat network, so once someone is on
> the Wi-Fi they can reach [[fileserver]] and its donor records.
>
> 1. Open [[wap]] and change its security from WEP to **WPA3**, the strongest
>    setting.
> 2. Re-scan.
>
> WPA3 closes the easy way in. The network is still flat, so a break-in could
> still spread. Splitting it into zones is a separate project: that is network
> segmentation, a later lab.

**Action buttons:** none.

**Tools:** the scanner stays; `{ kind: 'wifi-settings', device: 'wap' }` unlocks the
WAP's Wi-Fi settings (reused from `wireless`; this lab exposes only the security
mode). If the `wireless` feature is not present at build time, build the smallest
stand-in: a `security` field on `wap.wifi` with the mode dropdown.

**Goals:**
- `wpa3` — "Set [[wap]] to WPA2 or WPA3" — completes when `wap.wifi.security` is `wpa2` or `wpa3`. Hint: "Open [[wap]] and change the security mode. WEP is broken; pick WPA3."
- `rescan` — "Re-scan and clear the high finding" — completes when a `scan-complete` event since step start has no `wifi-weak`. Hint: "Change the setting first, then press **Run scan**."

**Questions:**

1. `still-flat` (choice, `afterGoals: true`). Prompt: "You switched the Wi-Fi to WPA3. The office is still one flat network with the donor server on it. Why did the high finding clear anyway?"
   - ✓ "Strong encryption closes the easy way in, so the leftover risk is no longer high."
   - "The flat network was never a problem." — feedback: "A flat network still lets a break-in spread. That is why segmentation is a separate project."
   - "WPA3 split the network into zones." — feedback: "Encryption does not segment a network. It protects the radio link."
   - "Beacons carry the encryption, so WPA3 turned the beacons off." — feedback: "Beacons still broadcast. That is the low finding you will accept."
   - explain: "The high rating came from weak encryption plus a sensitive server on an open network (3.1.C.4). Strong encryption removes the weak-encryption part, so the residual risk drops below high. Segmentation would lower it further."

**Answer-key moves:** `{ inspect: 'wap' }`, `{ tool: { type: 'wifi-security', device: 'wap', mode: 'wpa3' } }`, `{ tool: { type: 'scan', device: 'auditor' } }`. Choice from the lab.

---

### Step 9 — `vpn` "Working from home"

**Body:**

> The bookkeeper, [[bookkeeper]], works from home over a **VPN**, an encrypted
> tunnel into the office network. Her VPN allows **split tunneling**: office
> traffic goes through the tunnel, and everything else goes straight to the
> internet from her home network.
>
> Her home laptop, [[homedev]], is shared with the family and may be infected.
>
> 1. Press **Home device probes the office**. Follow the path with split
>    tunneling on.
> 2. In the router's **VPN settings**, turn split tunneling off and require
>    **MFA** (a second login step beyond the password).
> 3. Press **Home device probes the office** again.
>
> This simulation keeps the VPN simple: with split tunneling on, devices on the
> bookkeeper's home network can ride her laptop into the office. With it off, only
> her laptop's own office traffic uses the tunnel.

**Action buttons:**
- `home-probe` "Home device probes the office" — `homedev` sends a probe toward `fileserver` (`192.168.50.10`). With `splitTunneling === true`, it reaches the file server through `bookkeeper`'s tunnel. With `splitTunneling === false`, it is dropped before the office.

**Tools:** the scanner stays; `{ kind: 'hardening', device: 'router' }` already
unlocked, now also showing VPN settings (split tunneling, authentication: password,
key, or MFA). (Keep VPN settings in the same `hardening` section on `router`, or a
`{ kind: 'vpn-settings', device: 'router' }` card; implementer's choice.)

**Goals:**
- `see-risk` — "Watch a home device reach [[fileserver]] through the tunnel" — completes when, with split tunneling on, a probe from `homedev` reached `fileserver` since step start (a `ping-reply` on `homedev` from `192.168.50.10`, or an equivalent reach event). Hint: "Press **Home device probes the office** while split tunneling is still on."
- `fix` — "Turn split tunneling off and require MFA" — completes when `router.vpn.splitTunneling === false` and `router.vpn.auth` is `'mfa'` (or `'key'`). Hint: "Open [[router]] and find VPN settings."
- `blocked` — "Press the probe again and watch it fail to reach the office" — completes when, since the fix, a probe from `homedev` to `192.168.50.10` was dropped before the office. Hint: "Change the VPN settings first, then press **Home device probes the office** again."

**Questions:**

1. `vpn-policy` (choice, `multi: true`). Prompt: "Which items belong in the VPN security policy?"
   - ✓ "List which roles may use the VPN."
   - ✓ "Require strong authentication, such as keys or MFA."
   - ✓ "Prohibit split tunneling."
   - "Allow split tunneling so the bookkeeper's home streaming stays fast." — feedback: "You just watched split tunneling open a path from a home device into the office. Speed is not worth that."
   - "Let anyone with the office Wi-Fi password dial in." — feedback: "A VPN policy names roles and requires strong authentication, not a shared password."
   - explain: "A VPN policy may list the roles allowed to use it, require strong authentication like keys or MFA, and prohibit split tunneling (3.2.A.3)."

2. `split-why` (text, teacher-graded, `minWords: 20`, `lines: 4`). Prompt: "Explain in your own words why split tunneling raised the risk, using what the home device did."
   - Sample answer: "With split tunneling, the bookkeeper's laptop was connected to both her home network and the office at once, and it did not keep them apart. A possibly infected home device used her tunnel to reach the donor server, so a problem on her home network became a problem for the office. Turning split tunneling off forces all her traffic through the office gateway and stops the home network from piggybacking in."

**Answer-key moves:** `{ press: 'home-probe' }`, `{ inspect: 'router' }`, `{ tool: { type: 'vpn-config', device: 'router', splitTunneling: false, auth: 'mfa' } }`, `{ press: 'home-probe' }`. Choice from the lab; text sample above.

---

### Step 10 — `rescan` "The final re-scan"

**Body:**

> Run the scanner one last time. The high and moderate findings are gone. One low
> finding remains: the Wi-Fi still broadcasts its beacon.
>
> You do not have to fix every finding. A **low risk** that costs more to fix than
> it would ever cause can be **accepted**: written down, and lived with on
> purpose.

**Action buttons:** none.

**Tools:** the scanner.

**Goals:**
- `clean` — "Re-scan and show no high or moderate findings" — completes when a `scan-complete` event since step start contains no finding whose current rating or scanner severity is high or moderate. (Only `wifi-beacon`, low, should remain.) Hint: "Press **Run scan**. If a high or moderate finding is still listed, go back and apply its fix."

**Questions:**

1. `accept-low` (choice). Prompt: "The re-scan still lists the beacon finding. Why accept it instead of fixing it?"
   - ✓ "It is low risk, and hiding the Wi-Fi name costs more hassle than it saves."
   - "A scanner cannot detect beacons, so there is nothing to fix." — feedback: "The scanner did detect it. That is why it is on the report."
   - "Low risks are not real, so you ignore them." — feedback: "Low is not zero. Accepting a risk means recording it and choosing to live with it, not ignoring it."
   - "Fixing it would break the router." — feedback: "A beacon is a Wi-Fi setting, not a router one, and the network would keep working either way."
   - explain: "Residual low risks are often accepted when the fix costs more than the risk. Accepting is a decision you record, which is different from missing it."

**Answer-key moves:** `{ tool: { type: 'scan', device: 'auditor' } }`. Choice from the lab.

---

### Step 11 — `reflect` "Write the summary"

**Body:**

> Write the audit summary for the food bank's director, who is not technical.
>
> - Name the **top risk** you found.
> - Give its **rating** and why it earned that rating (likelihood and impact).
> - Name the one **control** that fixes it.
>
> Keep it to a few plain sentences the director can act on.

**Action buttons:** none.

**Tools:** none.

**Goals:** none (written reflection, like build-network's reflect step).

**Questions:**

1. `summary` (text, teacher-graded, `minWords: 40`, `lines: 6`). Prompt as in the body.
   - Sample answer: "The biggest risk is the office Wi-Fi. It used WEP encryption, which an attacker in the parking lot can crack in seconds, and the whole office sits on one network with the donor records server. I rated it high: the attack is easy, so the likelihood is high, and exposed donor records would be a serious breach of confidentiality, so the impact is high. The fix is to switch the Wi-Fi to WPA3 encryption, which we did. As a longer-term project, splitting the donor server onto its own network segment would lower the risk further."

**Answer-key moves:** none; sample above.

---

### Step 12 — `submit` "Review and submit"

`kind: 'submit'`. Body copied from build-network and on-path:

> Look over your summary on the right. You can go back to any step and change an
> answer, then hand in your work again.

---

## Simulator and interface behaviors for the implementer

Grouped by owner. "Own" = build it in this lab (and, where noted, as a shared
API). "Reused" = built by a wave-1 lab; if it has not merged yet, build the
smallest stand-in inside `src/labs/net-audit/` and say so in the report.

### This lab's own features

**Scanner and report (own).**
- A scanner that, on **Run scan**, probes each office host and its services and
  reads device settings against the findings catalog, then produces a report.
  Model probes as a few aggregated frames, not hundreds (see ARCHITECTURE). Keep
  `runUntilIdle` fast.
- One probe is an external exposure check: an ICMP echo originating at `internet`
  toward `198.51.100.2`. It gets a reply while `edge-icmp` is unfixed; it is
  dropped once `blockInboundIcmp` is on.
- Report data on `auditor`: `scanReport = { at: number; findings: Finding[] }`,
  where each `Finding` has `id`, `device`, `severity`, `evidenceText`, `fixText`,
  and `present: boolean`. A re-scan recomputes `present` from current settings.
- New `SimEvent`: `{ type: 'scan-complete'; device: string; findings: string[] }`
  (ids of findings still present). Goals use `happened(...)`.
- New `SimAction`: `{ type: 'scan'; device: string }`. Add an `applyAction` case.
  No typed input, so `assertTypable` returns `{ ok: true }`.
- New `UiEvent`: `{ type: 'ui:open-finding'; device: string; finding: string }`
  for the "open a finding" goal, plus a `{ openFinding: string }` solution move.
- Toolkit card `{ kind: 'scanner', device }`: a **Run scan** button and the report
  list. Register the kind in `ToolSpec`, write `src/ui/tools/Scanner.tsx`, list it
  in `TOOL_CARDS`, add its name to `TOOL_NAME` in `Guide.tsx`.

**Risk register (own).**
- Toolkit card `{ kind: 'risk-register', device }`: one row per present finding,
  with likelihood and impact dropdowns (`low` / `moderate` / `high`) and the
  computed rating from the risk matrix above.
- State on `auditor`: `riskRegister: Record<findingId, { likelihood?, impact? }>`.
- New `SimAction`: `{ type: 'rate-risk'; finding: string; likelihood: Level; impact: Level }`.
  Replace the row's values. Add `applyAction` and `assertTypable` cases (the input
  is from dropdowns, so a light check that the finding id and levels are valid).
- Pure function `riskRating(likelihood, impact): Level` from the matrix, used by
  both the card and the step 5 goal. Unit-test it.
- Write `src/ui/tools/RiskRegister.tsx`; register as for the scanner.

**Telnet and SSH (own).**
- A management login modeled as an `IpPacket` with `proto: 'tcp'`, `dstPort: 23`
  (Telnet) or `22` (SSH), carrying a username and password. Telnet is
  `encrypted: false`; SSH is `encrypted: true`. Add an `AppData` variant (for
  example `{ kind: 'login'; service: 'telnet' | 'ssh'; user: string; pass: string }`)
  or reuse the HTTP app shape with ports; whichever keeps `describe.ts` simple.
- `describe.ts`: a Telnet layer showing the readable user and password, and an
  SSH layer shown as encrypted gibberish (mirror the existing TLS layer).
- Helper predicate `isTelnetLogin(frame)` in `src/labs/helpers.ts` (additive).
- Step actions `telnet-login` and `ssh-login` call a new `Sim` method, for example
  `sim.login(device, targetIp, service, user, pass)`, that builds and sends the
  frame. Reuse the existing capture path so `auditor`'s sniffer records it.
- Add `'telnet'` to the solution `openFrame` match map in `src/labs/solution.ts`.

**Router, switch, and VPN hardening settings (own).**
- `router.hardening`: `{ telnet, ssh, localAccounts, authServer, blockInboundIcmp }`
  (all booleans). Seed: `telnet` on, `ssh` off, `localAccounts` on, `authServer`
  off, `blockInboundIcmp` off. The local account is `admin` / `foodbank`.
- `router.vpn`: `{ splitTunneling: boolean; auth: 'password' | 'key' | 'mfa'; allowedRoles?: string[] }`.
  Seed: `splitTunneling` on, `auth: 'password'`.
- `sw` port security and the shut lobby jack use `mac-flood`'s port-security API
  (see below). The switch also has an `authServer` boolean, part of this lab.
- New `SimAction`s: `{ type: 'harden'; device; setting; on }` and
  `{ type: 'vpn-config'; device; splitTunneling?; auth? }`. Add `applyAction` and
  `assertTypable` cases. The `blockInboundIcmp` toggle adds or removes an inbound
  deny-ICMP rule via the firewall engine (see below), so the state stays a real
  firewall rule, not a one-off flag.
- Inspector section `{ kind: 'hardening', device }` in `src/ui/inspector/Hardening.tsx`,
  listed in `INSPECTOR_SECTIONS`, slot `'settings'`. Returns null for devices with
  no `hardening`/`vpn`. Use `Toggle` from `src/ui/tools/parts.tsx`. No editing while
  `replaying`.

**VPN tunnel and split tunneling (own).**
- A tunnel from `bookkeeper` to `router`, drawn as a dashed line (not a `Link`).
  Office-bound traffic from `bookkeeper` is treated as entering at `router`.
- With `splitTunneling === true`, a packet from `homedev` (on the home network)
  toward the office is delivered through `bookkeeper`'s tunnel. With it `false`,
  such a packet is dropped before the office (new or reused `DropReason`, for
  example `'vpn-split-off'`, with student text in `describe.ts`).
- Keep it deterministic and simple; the body already tells students this is a
  simplified VPN.
- Step action `home-probe`: `homedev` pings `192.168.50.10`.

**Map zones (own, using the shared `MapZone` API):** office, parking lot, Wi-Fi
signal circle, and home, as listed in the scenario.

### Reused features (from wave-1 labs)

**Services and ports; the port scan (from `firewall`).**
- `Device.services` on `router`, `fileserver`, and `wap` as in the scenario.
- The scanner's port-scan probe reuses `firewall`'s port-scan primitive and the
  client-connection (request and reply with ports) model.

**Firewall engine (from `firewall`).**
- The edge firewall on `router`. The `blockInboundIcmp` toggle adds an ordered
  inbound deny rule for ICMP from the internet-facing interface. The external
  ICMP probe is allowed or denied by that rule. Reuse the engine's "which rule
  matched" path for the evidence text.

**Switch port security (from `mac-flood`).**
- Port security on `sw` (max MACs per port, violation action, shut a port). The
  switch Security settings toggles call this API. `switch-open` clears when port
  security is on for access ports and the lobby jack (port 7) is shut.

**Wi-Fi access point settings (from `wireless`).**
- `wap.wifi`: `{ ssid, security: 'open' | 'wep' | 'wpa' | 'wpa2' | 'wpa3', beacon, ... }`.
  This lab exposes only the security mode (step 8). New `SimAction`
  `{ type: 'wifi-security'; device; mode }` sets it; if `wireless` already defines
  a WAP-settings action, reuse that instead of adding one.
- If `wireless` has not merged, build a minimal `wap.wifi` with `security` and
  `beacon` fields inside this lab and note the stand-in in the report.

### Shared-file edits (all additive)

- `src/labs/types.ts`: add `ToolSpec` kinds `scanner`, `risk-register`,
  `hardening`, `wifi-settings` (unless `wireless` already added a Wi-Fi tool kind).
- `src/labs/helpers.ts`: add `isTelnetLogin`.
- `src/runtime/actions.ts`: add `scan`, `rate-risk`, `harden`, `vpn-config`, and
  `wifi-security` (if not reused) to `SimAction`, with `applyAction` cases.
- `src/labs/solution.ts`: add `assertTypable` cases for the new typed actions, the
  `telnet` entry to the `openFrame` match map, and the `openFinding` move.
- `src/sim/types.ts`: add the `scan-complete` `SimEvent`, the `login` `AppData`
  variant, the `ui:open-finding` `UiEvent` (in `src/labs/types.ts`), and any new
  `DropReason`, each with student text in `src/ui/describe.ts`.
- `src/ui/tools/registry.ts`, `src/ui/inspector/registry.ts`, `src/ui/Guide.tsx`:
  register the new cards and section.
- `src/labs/index.ts`: import `netAuditLab`, place it in `LABS` after
  `route-hijack` (home-page order from ARCHITECTURE), and remove its `STUBS` entry.
- Put new CSS under a `/* net-audit */` comment in `src/features.css`.

Keep every edit additive. Do not touch `README.md`, `COVERAGE.md`, `ARCHITECTURE.md`,
`scripts/e2e.mjs`, or other labs' folders; put anything they should say in the
final report.

### Acceptance (lab tests)

- The first scan reports all seven findings.
- Each fix removes exactly its finding from a re-scan.
- The Telnet login is plaintext in the capture; the SSH login is encrypted.
- The risk matrix computes high, moderate, and low for the three CED anchors.
- With split tunneling on, the home device reaches the file server; with it off,
  the probe is dropped before the office.
- Reload and replay rebuild the same network, report, and register.
- The walkthrough test plays every step from the solution with no changes to
  `walkthrough.test.ts`.
