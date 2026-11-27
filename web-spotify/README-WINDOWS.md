# Bloomee Web — Windows par chalana (local)

Is package mein Bloomee Web aap ke **apne PC par** chalta hai — koi
Vercel/server nahi chahiye. Isi liye **YouTube Music (Global) ke gaane
bhi play hote hain**: requests datacenter ki IP se nahi, aap ke ghar
ki IP se jati hain — bilkul Bloomee mobile/desktop app ki tarah.

## Chalana (2 minute)

1. Is folder ko kahin extract/rakhein jahan likhna allowed ho —
   masalan `Desktop` ya `Documents` mein. (`C:\Program Files` mein
   na rakhein, wahan pehli dafa Node download nahi ho sakega.)
2. **`Start-Bloomee.bat`** par double-click karein.
3. Pehli dafa: agar PC par Node.js nahi hai, launcher khud portable
   Node.js (~30 MB) download karke `runtime` folder mein rakh dega —
   internet chahiye, ek hi dafa. (Node pehle se installed hai to
   wahi use ho jayega, download nahi hoga.)
4. Browser khud khul jayega: **http://localhost:8000**
5. **Band karna:** jo kaali (console) window khuli hai, use band
   kar dein. Wahi aap ka local server hai — use khula rakhein jab
   tak sun rahe hain.

## Desktop shortcut

**`Create-Desktop-Shortcut.bat`** ek dafa chalayein — Desktop par
"Bloomee Web" ka shortcut ban jayega. Phir roz wahi double-click.

## Phone se sunna (same Wi-Fi)

Server poore network par sunta hai. PC ka IP dekh kar (masalan
`192.168.1.5`), phone ke browser mein kholein:

```
http://192.168.1.5:8000
```

Pehli dafa Windows Firewall node.exe ke liye poochhe to **Allow**
kar dein (Private network par tick rakhein).

## Masla hal

| Masla | Hal |
|---|---|
| "Port 8000 busy hai" | Bloomee pehle se chal raha hai — launcher browser khol dega. Ya purani console window band karein. |
| Windows ne file roki / warning ayi | Zip internet se ayi hoti hai — `Start-Bloomee.bat` par right-click → Properties → neeche **Unblock** tick karke OK karein, phir chalayein. |
| Node download fail | Internet check karein. Ya khud https://nodejs.org se LTS install kar lein — launcher use pehchan lega. |
| Port badalna ho | Command Prompt mein `set BLOOMEE_PORT=9000` likh kar phir `Start-Bloomee.bat` chalayein. |
| VPN on hai | Free/datacenter VPN par YouTube kabhi "sign in to confirm" bol sakta hai — playback ke waqt VPN off rakhein. |

## Teknik (ek nazar mein)

- `server.js` — zero-dependency Node server: static files + saare
  `/api/*` endpoints (JioSaavn + YouTube Music + lyrics) ek hi
  process mein, port 8000 par.
- Sab kuch local hai: koi data kahin nahi jata, koi account nahi
  chahiye. Internet sirf gaane ke sources (JioSaavn / YouTube /
  LRCLIB) tak jane ke liye chahiye.
- Likes, playlists, recent — browser ke `localStorage` mein rehte
  hain (jaisa web version mein tha).
